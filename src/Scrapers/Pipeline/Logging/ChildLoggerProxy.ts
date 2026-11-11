/**
 * Deferred-resolve child-logger proxy.
 *
 * Capturing `const LOG = getDebug(import.meta.url)` at module-load is
 * safe: no pino instance is built until the first method access on
 * `LOG`. By then `executePipeline` has called `setActiveBank` and
 * `getLogFile()` returns a real path, so the lazy root logger gets the
 * file transport.
 *
 * Extracted from the legacy `Types/Debug.ts` blob during
 * Phase 12c.
 */

import type { Bindings, ChildLoggerOptions, Logger } from 'pino';

import {
  captureBindingsFormatter,
  captureChindings,
  type IDeferredChildEntry,
  type IDeferredChildSpec,
  instantiateChild,
} from './ChildLoggerState.js';
import { getRootLogger, getRootLoggerGeneration } from './RootLogger.js';

/** Key/value pair passed to the proxy `set` trap. */
interface IPropertyWrite {
  readonly key: string | symbol;
  readonly value: LoggerProperty;
}

/** Reflected value off a pino Logger — narrowed to the keyof-union shape. */
type LoggerProperty = Logger[keyof Logger];

/**
 * Lazy-resolve handler for the JS Proxy used by `getDebug`. On first
 * property access, builds the real pino child (which by then has the
 * file transport wired in via setActiveBank) and forwards every method
 * call there. Exported so callers wiring custom diagnostics into the
 * same proxy shape can re-use the type instead of re-deriving it.
 */
export interface IProxyHandler {
  get: (target: object, prop: string | symbol) => LoggerProperty;
  set?: (target: object, prop: string | symbol, value: LoggerProperty) => boolean;
}

/**
 * Resolve (and memoise) the child logger for `spec` against the current
 * root generation, rebuilding whenever the root itself was replaced.
 * @param spec - Parent resolver plus child bindings and options.
 * @param entry - Mutable cache slot for the resolved child.
 * @returns The child logger to read the requested property from.
 */
function resolveChild(spec: IDeferredChildSpec, entry: IDeferredChildEntry): Logger {
  getRootLogger();
  const generation = getRootLoggerGeneration();
  if (entry.resolved && entry.generation === generation) return entry.resolved;
  entry.resolved = instantiateChild(spec, entry);
  entry.generation = generation;
  return entry.resolved;
}

/**
 * Build a pre-resolved cache entry from an eagerly constructed Pino sub-child
 * so custom serializers run on the original caller values at `.child()` time.
 * @param initial - Pino child built from the caller's original bindings.
 * @returns Populated cache entry carrying the immutable serialized chindings.
 */
function makeResolvedEntry(initial: Logger): IDeferredChildEntry {
  return {
    resolved: initial,
    generation: getRootLoggerGeneration(),
    chindings: captureChindings(initial),
    bindingsFormatter: captureBindingsFormatter(initial),
    levelOverride: false,
  };
}

/**
 * Construct a sub-child immediately against the current parent (preserving
 * prototypes, `Buffer` instances, and non-cloneable serializer inputs) and
 * wrap its serialized chindings in a generation-invalidated proxy.
 * @param resolveParent - Parent logger resolver for the derived sub-child.
 * @param bindings - Caller-supplied child bindings.
 * @param options - Optional Pino child logger options.
 * @returns Deferred proxy wrapping the sub-child.
 */
function createSubChildProxy(
  resolveParent: () => Logger,
  bindings: Bindings,
  options?: ChildLoggerOptions,
): Logger {
  const initial = resolveParent().child(bindings, options);
  const entry = makeResolvedEntry(initial);
  return wrapEntryInProxy({ resolveParent, bindings: {}, options }, entry);
}

/**
 * Build a deferred `.child(bindings, options)` factory so retained sub-loggers
 * also re-resolve against the active root generation after bank switches.
 * @param resolveParent - Parent logger resolver for the derived sub-child.
 * @returns Child factory returning a deferred proxy.
 */
function makeDeferredSubChild(
  resolveParent: () => Logger,
): (bindings: Bindings, options?: ChildLoggerOptions) => Logger {
  return (bindings: Bindings, options?: ChildLoggerOptions): Logger =>
    createSubChildProxy(resolveParent, bindings, options);
}

/**
 * Build a deferred `.child(...)` method whose parent resolves `spec` + `entry`.
 * @param spec - Parent resolver plus child bindings and options.
 * @param entry - Mutable cache slot for the parent child.
 * @returns Deferred `.child` factory cast to `LoggerProperty`.
 */
function childMethodFor(spec: IDeferredChildSpec, entry: IDeferredChildEntry): LoggerProperty {
  return makeDeferredSubChild((): Logger => resolveChild(spec, entry)) as LoggerProperty;
}

/**
 * Apply `bindings` via Pino's own `setBindings` and capture the resulting
 * immutable chindings string for replay across future root rebuilds.
 * @param spec - Parent resolver plus initial child bindings and options.
 * @param entry - Mutable cache slot holding replayed child state.
 * @param bindings - Caller-supplied bindings payload.
 * @returns True after applying and recording.
 */
function applySetBindings(
  spec: IDeferredChildSpec,
  entry: IDeferredChildEntry,
  bindings: Bindings,
): true {
  const current = resolveChild(spec, entry);
  current.setBindings(bindings);
  entry.chindings = captureChindings(current);
  return true;
}

/**
 * Build a `setBindings(bindings)` wrapper that delegates to {@link applySetBindings}.
 * @param spec - Parent resolver plus initial child bindings and options.
 * @param entry - Mutable cache slot holding replayed child state.
 * @returns Wrapped `setBindings` method cast to `LoggerProperty`.
 */
function setBindingsMethodFor(
  spec: IDeferredChildSpec,
  entry: IDeferredChildEntry,
): LoggerProperty {
  return (bindings: Bindings): true => applySetBindings(spec, entry, bindings);
}

/**
 * Property-access handler for the lazy logger Proxy — delegates to
 * {@link resolveChild}, which memoises the child against the root's
 * generation. Intercepts `.child(...)` and `.setBindings(...)` so retained
 * sub-loggers stay deferred proxies and preserve dynamic bindings.
 * @param spec - Parent resolver plus child bindings and options.
 * @param entry - Mutable cache slot for the resolved child.
 * @param prop - Property name being read on the proxy.
 * @returns Whatever pino Logger exposes at that key.
 */
function reflectChildProperty(
  spec: IDeferredChildSpec,
  entry: IDeferredChildEntry,
  prop: string | symbol,
): LoggerProperty {
  if (prop === 'child') return childMethodFor(spec, entry);
  if (prop === 'setBindings') return setBindingsMethodFor(spec, entry);
  const child = resolveChild(spec, entry);
  return Reflect.get(child, prop) as LoggerProperty;
}

/**
 * Property-write handler for the lazy logger Proxy — records `level` overrides
 * so they survive root rebuilds and forwards mutations to the active child.
 * @param spec - Parent resolver plus child bindings and options.
 * @param entry - Mutable cache slot for the resolved child.
 * @param props - Property key and assigned value.
 * @returns True when the assignment succeeded.
 */
function assignChildProperty(
  spec: IDeferredChildSpec,
  entry: IDeferredChildEntry,
  props: IPropertyWrite,
): boolean {
  const child = resolveChild(spec, entry);
  const didAssign = Reflect.set(child, props.key, props.value);
  if (didAssign && props.key === 'level') entry.levelOverride = child.level;
  return didAssign;
}

/**
 * Pure forwarder used as the proxy `get` trap. Extracted so
 * `makeChildProxyHandler` stays trivially short and the trap logic has
 * its own ≤10-LoC test target.
 * @param spec - Parent resolver plus child bindings and options.
 * @param entry - Mutable cache slot for the resolved child.
 * @param prop - Property name being read on the proxy.
 * @returns Whatever pino Logger exposes at that key.
 */
function handleGetTrap(
  spec: IDeferredChildSpec,
  entry: IDeferredChildEntry,
  prop: string | symbol,
): LoggerProperty {
  return reflectChildProperty(spec, entry, prop);
}

/**
 * Build the proxy handler that lazily resolves a pino child for `spec`.
 * @param spec - Parent resolver plus child bindings and options.
 * @param entry - Mutable cache slot for the resolved child.
 * @returns Proxy handler whose `get` trap delegates to {@link handleGetTrap}.
 */
function makeChildProxyHandler(
  spec: IDeferredChildSpec,
  entry: IDeferredChildEntry,
): IProxyHandler {
  return {
    /**
     * Proxy `get` trap — delegates to {@link handleGetTrap}.
     * @param _target - Unused proxy target placeholder.
     * @param prop - Property name being accessed.
     * @returns Reflected pino logger property value.
     */
    get: (_target, prop): LoggerProperty => handleGetTrap(spec, entry, prop),
    /**
     * Proxy `set` trap — delegates to {@link assignChildProperty}.
     * @param _target - Unused proxy target placeholder.
     * @param key - Property name being written.
     * @param value - Assigned value.
     * @returns True when the write succeeded.
     */
    set: (_target, key, value): boolean => assignChildProperty(spec, entry, { key, value }),
  };
}

/**
 * Create a fresh unresolved cache entry for a deferred child proxy.
 * @returns Initialized deferred-child cache entry.
 */
function makeInitialEntry(): IDeferredChildEntry {
  return {
    resolved: false,
    generation: -1,
    chindings: false,
    bindingsFormatter: false,
    levelOverride: false,
  };
}

/**
 * Wrap `spec` and `entry` in a lazy-resolve Proxy.
 * @param spec - Parent resolver plus child bindings and options.
 * @param entry - Mutable cache slot for the proxy.
 * @returns Deferred pino-shaped logger proxy.
 */
function wrapEntryInProxy(spec: IDeferredChildSpec, entry: IDeferredChildEntry): Logger {
  const target: object = {};
  const handler = makeChildProxyHandler(spec, entry);
  return Reflect.construct(Proxy, [target, handler]) as Logger;
}

/**
 * Assemble a lazy-resolve Proxy around `spec` for a module-level logger.
 * @param spec - Parent resolver plus child bindings and options.
 * @returns Deferred pino-shaped logger proxy.
 */
function createDeferredProxy(spec: IDeferredChildSpec): Logger {
  const entry = makeInitialEntry();
  return wrapEntryInProxy(spec, entry);
}

/**
 * Shared proxy/deferred-resolve assembly used by both `getDebug` and
 * `getDebugByName` (see {@link ./Debug.ts}). Extracted so adding a third
 * caller-shape adapter in the future stays trivial.
 * @param name - Logger module name (either kebab-derived from a URL or
 *   the verbatim legacy string passed by Common-side callers).
 * @returns A pino-shaped logger that defers child creation.
 */
export function buildDeferredLogger(name: string): Logger {
  return createDeferredProxy({ resolveParent: getRootLogger, bindings: { module: name } });
}
