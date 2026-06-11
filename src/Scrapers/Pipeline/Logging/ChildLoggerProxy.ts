/**
 * Deferred-resolve child-logger proxy.
 *
 * Capturing `const LOG = getDebug(import.meta.url)` at module-load is
 * safe: no pino instance is built until the first method access on
 * `LOG`. By then `executePipeline` has called `setActiveBank` and
 * `getLogFile()` returns a real path, so the lazy root logger gets the
 * file transport.
 *
 * Extracted from the legacy {@link ../Types/Debug.ts} blob during
 * Phase 12c.
 */

import type { Logger } from 'pino';

import { getRootLogger, isRootLoggerCached } from './RootLogger.js';

/** Per-name cached deferred-child entry. */
interface IDeferredChildEntry {
  resolved: Logger | false;
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
}

/**
 * Property-access handler for the lazy logger Proxy — first access builds
 * a child logger from the current root. The child is cached only once the
 * root itself is cached (which only happens when `getLogFile()` resolved a
 * real destination, i.e. `setActiveBank` has fired). Pre-`setActiveBank`
 * calls keep rebuilding the child each access (cheap, microseconds) so the
 * first post-`setActiveBank` access automatically picks up the file
 * transport without a manual refresh.
 * @param name - Module name attached to the resolved child.
 * @param entry - Mutable cache slot for the resolved child.
 * @param prop - Property name being read on the proxy.
 * @returns Whatever pino Logger exposes at that key.
 */
function reflectChildProperty(
  name: string,
  entry: IDeferredChildEntry,
  prop: string | symbol,
): LoggerProperty {
  if (entry.resolved) return Reflect.get(entry.resolved, prop) as LoggerProperty;
  const child = getRootLogger().child({ module: name });
  if (isRootLoggerCached()) entry.resolved = child;
  return Reflect.get(child, prop) as LoggerProperty;
}

/**
 * Pure forwarder used as the proxy `get` trap. Extracted so
 * `makeChildProxyHandler` stays trivially short and the trap logic has
 * its own ≤10-LoC test target.
 * @param name - Module name attached to the resolved child.
 * @param entry - Mutable cache slot for the resolved child.
 * @param prop - Property name being read on the proxy.
 * @returns Whatever pino Logger exposes at that key.
 */
function handleGetTrap(
  name: string,
  entry: IDeferredChildEntry,
  prop: string | symbol,
): LoggerProperty {
  return reflectChildProperty(name, entry, prop);
}

/**
 * Build the proxy handler that lazily resolves a pino child for `name`.
 * @param name - The module name for the child logger.
 * @param entry - Mutable cache slot for the resolved child.
 * @returns Proxy handler whose `get` trap delegates to {@link handleGetTrap}.
 */
function makeChildProxyHandler(name: string, entry: IDeferredChildEntry): IProxyHandler {
  return {
    /**
     * Proxy `get` trap — delegates to {@link handleGetTrap}.
     * @param _target - Unused proxy target placeholder.
     * @param prop - Property name being accessed.
     * @returns Reflected pino logger property value.
     */
    get: (_target, prop): LoggerProperty => handleGetTrap(name, entry, prop),
  };
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
  const entry: IDeferredChildEntry = { resolved: false };
  const target: object = {};
  const handler = makeChildProxyHandler(name, entry);
  return Reflect.construct(Proxy, [target, handler]) as Logger;
}
