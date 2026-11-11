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
  /** Explicit `logger.level = ...` override, replayed across root rebuilds. */
  levelOverride: string | false;
}

/**
 * Locate an own Pino symbol property on `child` by its `Symbol.description`.
 * @param child - Real Pino child logger instance.
 * @param description - Expected `Symbol.prototype.description`.
 * @returns Matching symbol, or `false` when absent.
 */
function findOwnSymbol(child: Logger, description: string): symbol | false {
  const symbols = Object.getOwnPropertySymbols(child);
  const match = symbols.find((sym): boolean => sym.description === description);
  return match ?? false;
}

/**
 * Read the immutable serialized chindings string off a real Pino child logger.
 * @param child - Real Pino child logger instance.
 * @returns Serialized chindings string, or `false` when unavailable.
 */
export function captureChindings(child: Logger): string | false {
  const sym = findOwnSymbol(child, 'pino.chindings');
  if (!sym) return false;
  const raw = Reflect.get(child, sym) as string | undefined;
  if (typeof raw !== 'string') return false;
  return raw;
}

/**
 * Restore a previously serialized chindings string onto a newly rebuilt Pino child.
 * @param child - Freshly built Pino child logger.
 * @param chindings - Previously captured chindings string (or `false`).
 * @returns True when chindings were written onto `child`.
 */
function restoreChindings(child: Logger, chindings: string | false): boolean {
  if (chindings === false) return false;
  const sym = findOwnSymbol(child, 'pino.chindings');
  if (!sym) return false;
  return Reflect.set(child, sym, chindings);
}

/**
 * Build child options for reconstruction, stripping `formatters.bindings` when
 * chindings are already serialized so field-requiring formatters are not run on `{}`.
 * @param options - Original Pino child logger options.
 * @param chindings - Existing serialized chindings (or `false` on first build).
 * @returns Options object safe to pass to `parent.child(...)`.
 */
function optionsForBuild(
  options: ChildLoggerOptions,
  chindings: string | false,
): ChildLoggerOptions {
  if (chindings === false || !options.formatters?.bindings) return options;
  const { level, log } = options.formatters;
  return { ...options, formatters: { level, log } };
}

/**
 * Re-attach `options.formatters.bindings` onto `child[Symbol(pino.formatters)]`
 * after reconstruction so subsequent `setBindings(...)` calls still format inputs.
 * @param child - Reconstructed Pino child logger.
 * @param options - Original Pino child logger options.
 * @returns True when a custom bindings formatter was restored.
 */
function restoreBindingsFormatter(child: Logger, options?: ChildLoggerOptions): boolean {
  const bindingsFn = options?.formatters?.bindings;
  const sym = bindingsFn && findOwnSymbol(child, 'pino.formatters');
  if (!bindingsFn || !sym) return false;
  const table = Reflect.get(child, sym) as object;
  return Reflect.set(table, 'bindings', bindingsFn);
}

/**
 * Invoke `parent.child` with or without sanitized options depending on whether
 * the caller supplied `spec.options`.
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
  if (!spec.options) return parent.child(spec.bindings);
  const safeOptions = optionsForBuild(spec.options, chindings);
  return parent.child(spec.bindings, safeOptions);
}

/**
 * Build a fresh real Pino child for `spec` + `entry`, restoring Pino's own
 * serialized chindings string, custom bindings formatter, and `level` override.
 * @param spec - Parent resolver plus initial child bindings and options.
 * @param entry - Mutable cache slot holding replayed child state.
 * @returns Newly constructed Pino child logger.
 */
export function instantiateChild(spec: IDeferredChildSpec, entry: IDeferredChildEntry): Logger {
  const parent = spec.resolveParent();
  const child = buildRawChild(parent, spec, entry.chindings);
  if (entry.chindings === false) entry.chindings = captureChindings(child);
  restoreChindings(child, entry.chindings);
  restoreBindingsFormatter(child, spec.options);
  if (entry.levelOverride !== false) child.level = entry.levelOverride;
  return child;
}
