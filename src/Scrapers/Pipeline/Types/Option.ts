/**
 * Option type — replaces null/undefined with explicit discriminated union.
 * Use `some(value)` for present values, `none()` for absent.
 */

/** A present value — T must be non-null/non-undefined. */
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

/** Allowed types for Option values — everything except null/undefined. */
type NonNullish = object | string | number | boolean | symbol | bigint;

/**
 * Wrap a non-null/non-undefined value as present.
 * @param value - The value to wrap (must not be null or undefined).
 * @returns An Option with `has: true`.
 */
function some<T extends NonNullish>(value: T): ISome<T> {
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
  if (!opt.has) return fallback;
  return opt.value;
}

export type { INone, ISome, NonNullish, Option };
export { isSome, none, some, unwrapOr };
