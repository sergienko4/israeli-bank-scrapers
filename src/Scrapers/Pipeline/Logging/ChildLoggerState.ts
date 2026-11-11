/**
 * Pino child-logger state preservation across root-logger rebuilds.
 *
 * Captures Pino's own immutable serialized `Symbol(pino.chindings)` string and
 * explicit `level` overrides, and strips/restores `options.formatters.bindings`
 * during reconstruction so custom serializers, `Buffer` values, prototypes, and
 * field-requiring bindings formatters preserve exact Pino semantics across
 * bank switches.
 */

import type { Bindings, ChildLoggerOptions, Logger } from 'pino';

/** Pino `formatters.bindings` function signature. */
export type BindingsFormatter = NonNullable<
  NonNullable<ChildLoggerOptions['formatters']>['bindings']
>;

/** Deferred child specification — parent resolver + bindings + optional options. */
export interface IDeferredChildSpec {
  readonly resolveParent: () => Logger;
  readonly bindings: Bindings;
  readonly options?: ChildLoggerOptions;
}

/** Per-proxy cached deferred-child entry + mutable child state replayed on rebuild. */
export interface IDeferredChildEntry {
  resolved: Logger | false;
  /** Root generation `resolved` was derived from; `-1` when unresolved. */
  generation: number;
  /** Immutable Pino-serialized `Symbol(pino.chindings)` string replayed on rebuild. */
  chindings: string | false;
  /** Effective `formatters.bindings` captured from initial child for post-rebuild `setBindings`. */
  bindingsFormatter: BindingsFormatter | false;
  /** Explicit `logger.level = ...` override, replayed across root rebuilds. */
  levelOverride: string | false;
}

/**
 * Identity bindings formatter used while reconstructing a child whose chindings are already cached.
 * @param bindings - Incoming bindings object.
 * @returns Unmodified bindings object.
 */
function passthroughBindings(bindings: Bindings): Bindings {
  return bindings;
}

/**
 * Locate a Pino symbol property on `target` or its prototype chain by `Symbol.description`.
 * @param target - Real Pino logger or prototype object.
 * @param description - Expected `Symbol.prototype.description`.
 * @returns Matching symbol, or `false` when absent.
 */
function findSymbol(target: object, description: string): symbol | false {
  const match = Object.getOwnPropertySymbols(target).find(
    (sym): boolean => sym.description === description,
  );
  if (match) return match;
  const proto: object | false = (Reflect.getPrototypeOf(target) as object | undefined) ?? false;
  return proto ? findSymbol(proto, description) : false;
}

/**
 * Read the immutable serialized chindings string off a real Pino child logger.
 * @param child - Real Pino child logger instance.
 * @returns Serialized chindings string, or `false` when unavailable.
 */
export function captureChindings(child: Logger): string | false {
  const sym = findSymbol(child, 'pino.chindings');
  if (!sym) return false;
  const raw = Reflect.get(child, sym) as string | undefined;
  if (typeof raw !== 'string') return false;
  return raw;
}

/**
 * Read the effective `formatters.bindings` function off a real Pino child logger.
 * @param child - Real Pino child logger instance.
 * @returns Effective bindings formatter, or `false` when unavailable.
 */
export function captureBindingsFormatter(child: Logger): BindingsFormatter | false {
  const sym = findSymbol(child, 'pino.formatters');
  if (!sym) return false;
  const table = Reflect.get(child, sym) as { bindings?: BindingsFormatter } | undefined;
  return typeof table?.bindings === 'function' ? table.bindings : false;
}

/**
 * Restore a previously serialized chindings string onto a newly rebuilt Pino child.
 * @param child - Freshly built Pino child logger.
 * @param chindings - Previously captured chindings string (or `false`).
 * @returns True when chindings were written onto `child`.
 */
function restoreChindings(child: Logger, chindings: string | false): boolean {
  if (chindings === false) return false;
  const sym = findSymbol(child, 'pino.chindings');
  if (!sym) return false;
  return Reflect.set(child, sym, chindings);
}

/**
 * Build child options for reconstruction, neutralizing both explicit and inherited
 * `formatters.bindings` when chindings are already cached so `{}` never trips validation.
 * @param chindings - Existing serialized chindings (or `false` on first build).
 * @param options - Optional original Pino child logger options.
 * @returns Options object safe to pass to `parent.child(...)`, or `false` when none exist.
 */
function optionsForBuild(
  chindings: string | false,
  options?: ChildLoggerOptions,
): ChildLoggerOptions | false {
  if (chindings === false) return options ?? false;
  return { ...options, formatters: { ...options?.formatters, bindings: passthroughBindings } };
}

/**
 * Restore `bindingsFn` onto an own shallow copy of `child[Symbol(pino.formatters)]`
 * without mutating any formatter table shared with `parent`.
 * @param child - Reconstructed Pino child logger.
 * @param bindingsFn - Effective bindings formatter captured on initial construction.
 * @returns True when a formatter table was written onto `child`.
 */
function restoreBindingsFormatter(child: Logger, bindingsFn: BindingsFormatter | false): boolean {
  const sym = bindingsFn && findSymbol(child, 'pino.formatters');
  if (!bindingsFn || !sym) return false;
  const table = Reflect.get(child, sym) as Record<string, object>;
  return Reflect.set(child, sym, { ...table, bindings: bindingsFn });
}

/**
 * Invoke `parent.child` using neutralized bindings formatting whenever cached chindings exist.
 * @param parent - Parent Pino logger instance.
 * @param spec - Child bindings and optional options.
 * @param chindings - Existing serialized chindings (or `false` on first build).
 * @returns Newly created Pino child logger.
 */
function buildRawChild(
  parent: Logger,
  spec: IDeferredChildSpec,
  chindings: string | false,
): Logger {
  const safeOptions = optionsForBuild(chindings, spec.options);
  return safeOptions ? parent.child(spec.bindings, safeOptions) : parent.child(spec.bindings);
}

/**
 * Build a fresh real Pino child for `spec` + `entry`, restoring Pino's own
 * serialized chindings string, effective bindings formatter, and `level` override.
 * @param spec - Parent resolver plus initial child bindings and options.
 * @param entry - Mutable cache slot holding replayed child state.
 * @returns Newly constructed Pino child logger.
 */
export function instantiateChild(spec: IDeferredChildSpec, entry: IDeferredChildEntry): Logger {
  const parent = spec.resolveParent();
  const child = buildRawChild(parent, spec, entry.chindings);
  if (entry.chindings === false) entry.chindings = captureChindings(child);
  if (entry.bindingsFormatter === false) entry.bindingsFormatter = captureBindingsFormatter(child);
  restoreChindings(child, entry.chindings);
  restoreBindingsFormatter(child, entry.bindingsFormatter);
  if (entry.levelOverride !== false) child.level = entry.levelOverride;
  return child;
}
