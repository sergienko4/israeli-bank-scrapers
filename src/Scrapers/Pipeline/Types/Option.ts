/**
 * Option type — replaces null/undefined with explicit discriminated union.
 * Use `some(value)` for present values, `none()` for absent.
 */

/** A present value. */
interface ISome<T> {
  readonly has: true;
  readonly value: T;
}

/** An absent value. */
interface INone {
  readonly has: false;
}

/** Discriminated union: value is either present (Some) or absent (None). */
type Option<T> = ISome<T> | INone;

/**
 * Wrap a value as present.
 * @param value - The value to wrap.
 * @returns An Option with `has: true`.
 */
function some<T>(value: T): ISome<T> {
  return { has: true, value };
}

/** Sentinel for absent values — shared immutable instance. */
const NONE: INone = Object.freeze({ has: false });

/**
 * Create an absent Option.
 * @returns An Option with `has: false`.
 */
function none(): INone {
  return NONE;
}

/**
 * Type guard: narrows Option to Some.
 * @param opt - The Option to check.
 * @returns True if the option contains a value.
 */
function isSome<T>(opt: Option<T>): opt is ISome<T> {
  return opt.has;
}

/**
 * Unwrap an Option with a fallback default.
 * @param opt - The Option to unwrap.
 * @param fallback - Value to return if Option is None.
 * @returns The wrapped value or the fallback.
 */
function unwrapOr<T>(opt: Option<T>, fallback: T): T {
  return opt.has ? opt.value : fallback;
}

export type { INone, ISome, Option };
export { isSome, none, some, unwrapOr };
