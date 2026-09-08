/**
 * Phone-number formatter — single source of truth for the per-bank
 * wire-format transform.
 *
 * Caller contract (documented in README): the user supplies
 * `phoneNumber` in digits-only international form, e.g. `972000000000`
 * (Israeli example: country code `972` + local number `546218739`).
 * No `+`, no dash, no spaces. Length ≥ 10 digits.
 *
 * Each bank declares its wire format in
 * `PipelineBankConfig.headless.phoneNumberFormat`. This module is the
 * single place that translates the caller's value to a bank's wire
 * form — banks downstream consume the formatted value verbatim.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../Types/Procedure.js';

/**
 * Closed set of bank-specific wire formats.
 *
 * - `international-plus` → `+972XXXXXXXXX` (OneZero / Transmit Security)
 * - `international-dash` → `972-XXXXXXXXX` (PayBox)
 * - `international-flat` → `972XXXXXXXXX` (Pepper body)
 * - `local-only` → `XXXXXXXXX` (no current consumer; reserved)
 */
export type PhoneNumberFormat =
  'international-plus' | 'international-dash' | 'international-flat' | 'local-only';

/** Israeli country-code prefix — every bank we onboard is IL-issued. */
const IL_COUNTRY_CODE = '972';

/** Minimum length of the digits-only international form. */
const MIN_DIGITS = 10;

/**
 * Check that the raw string meets the minimum digit count.
 * @param raw - Caller-supplied digit-form phone string.
 * @returns Succeed with `raw` if length is ≥ {@link MIN_DIGITS}; fail Procedure otherwise.
 */
function checkDigitsLength(raw: string): Procedure<string> {
  if (raw.length >= MIN_DIGITS) return succeed(raw);
  return fail(
    ScraperErrorTypes.Generic,
    `phoneNumber: expected ≥${String(MIN_DIGITS)} digits, got ${String(raw.length)}`,
  );
}

/**
 * Check that the raw string contains digits only (no separators or `+`).
 * @param raw - Caller-supplied digit-form phone string.
 * @returns Succeed with `raw` when fully numeric; fail Procedure otherwise.
 */
function checkDigitsOnly(raw: string): Procedure<string> {
  if (/^\d+$/.test(raw)) return succeed(raw);
  return fail(
    ScraperErrorTypes.Generic,
    'phoneNumber: must be digits-only international form (no +, -, spaces)',
  );
}

/**
 * Check that the raw string starts with the Israeli country-code prefix.
 * @param raw - Caller-supplied digit-form phone string.
 * @returns Succeed with `raw` when prefixed with {@link IL_COUNTRY_CODE}; fail Procedure otherwise.
 */
function checkCountryCode(raw: string): Procedure<string> {
  if (raw.startsWith(IL_COUNTRY_CODE)) return succeed(raw);
  return fail(
    ScraperErrorTypes.Generic,
    `phoneNumber: must start with country code ${IL_COUNTRY_CODE}`,
  );
}

/** Ordered list of digit-form checks — short-circuits on first failure. */
const DIGIT_CHECKS: readonly ((raw: string) => Procedure<string>)[] = [
  checkDigitsLength,
  checkDigitsOnly,
  checkCountryCode,
];

/**
 * Reducer step for {@link validateInternationalDigits}. Skips further
 * checks once a previous one has failed, otherwise runs the next check.
 *
 * @param acc - Procedure accumulated so far (`succeed` until first failure).
 * @param check - Next digit-form check to apply.
 * @param raw - Caller-supplied digit-form phone string.
 * @returns Existing failure on short-circuit, else the next check result.
 */
function reduceDigitCheck(
  acc: Procedure<string>,
  check: (raw: string) => Procedure<string>,
  raw: string,
): Procedure<string> {
  if (!isOk(acc)) return acc;
  return check(raw);
}

/**
 * Validate the caller's digits-only international form. Returns the
 * unchanged digits string on success, or the first failing check's
 * fail Procedure (short-circuits via reduce).
 * @param raw - Caller-supplied phone string.
 * @returns Procedure with the validated digits.
 */
function validateInternationalDigits(raw: string): Procedure<string> {
  const seed = succeed(raw);
  return DIGIT_CHECKS.reduce<Procedure<string>>(
    (acc, check): Procedure<string> => reduceDigitCheck(acc, check, raw),
    seed,
  );
}

/** Args bundle for {@link applyPhoneFormat} — keeps params ≤3. */
interface IApplyFormatArgs {
  readonly cc: string;
  readonly local: string;
  readonly format: PhoneNumberFormat;
}

/**
 * Apply the per-bank wire format to a `(cc, local)` digit pair.
 * @param args - Country code + local digits + format selector.
 * @returns Formatted wire string.
 */
function applyPhoneFormat(args: IApplyFormatArgs): string {
  if (args.format === 'international-plus') return `+${args.cc}${args.local}`;
  if (args.format === 'international-dash') return `${args.cc}-${args.local}`;
  if (args.format === 'international-flat') return `${args.cc}${args.local}`;
  return args.local;
}

/**
 * Split a validated digits-only international string into its country
 * code and local part, then render it in the bank's wire form.
 * @param digits - Validated digits-only international form.
 * @param format - Per-bank wire-format selector.
 * @returns Formatted wire string.
 */
function formatDigits(digits: string, format: PhoneNumberFormat): string {
  const cc = digits.slice(0, IL_COUNTRY_CODE.length);
  const local = digits.slice(IL_COUNTRY_CODE.length);
  return applyPhoneFormat({ cc, local, format });
}

/**
 * Separator that each wire format injects into the digits-only form — the
 * decoration that {@link stripWireDecoration} has to remove to recover
 * those digits. Empty string means the format adds no separator at all.
 */
const WIRE_DECORATION: Readonly<Record<PhoneNumberFormat, string>> = {
  'international-plus': '+',
  'international-dash': '-',
  'international-flat': '',
  'local-only': '',
};

/**
 * Remove every occurrence of a format's separator, recovering the
 * candidate digits-only form so it can be validated normally.
 * @param raw - Caller-supplied phone string.
 * @param format - Per-bank wire-format selector.
 * @returns `raw` with the format's separator removed.
 */
function stripWireDecoration(raw: string, format: PhoneNumberFormat): string {
  const decoration = WIRE_DECORATION[format];
  if (!decoration) return raw;
  return raw.split(decoration).join('');
}

/**
 * Decide whether `raw` is *already* this bank's wire form.
 *
 * The per-bank guides (`docs/banks/onezero.md`, `docs/banks/paybox.md`)
 * document the wire form itself as the value to pass, so a caller who
 * follows them hands us a string that needs no further work. Normalising
 * it must therefore be a no-op rather than a rejection.
 *
 * The test is an exact round-trip — strip the separator, validate the
 * recovered digits with the same checks the canonical path uses, then
 * re-render and require byte equality. Anything merely *resembling* a
 * wire form (wrong grouping, another bank's separator) fails to round-trip
 * and falls through to the strict digits-only contract.
 *
 * @param raw - Caller-supplied phone string.
 * @param format - Per-bank wire-format selector.
 * @returns True when `raw` round-trips to itself.
 */
function isAlreadyWireForm(raw: string, format: PhoneNumberFormat): boolean {
  const digits = stripWireDecoration(raw, format);
  const validated = validateInternationalDigits(digits);
  if (!isOk(validated)) return false;
  return formatDigits(validated.value, format) === raw;
}

/**
 * Normalise a caller-supplied phone string into the bank's wire form.
 * Returns a Procedure so the pipeline can surface validation errors
 * with a clear diagnostic message.
 *
 * Accepts either the canonical digits-only international form or a value
 * already in this bank's wire form (see {@link isAlreadyWireForm}); every
 * other shape — including the Israeli local trunk form `05…` — fails here
 * rather than reaching the bank as an unusable credential.
 *
 * @param raw - Caller-supplied digits-only international form.
 * @param format - Per-bank wire-format selector.
 * @returns Procedure with the formatted wire string.
 */
export function formatPhoneNumber(raw: string, format: PhoneNumberFormat): Procedure<string> {
  if (isAlreadyWireForm(raw, format)) return succeed(raw);
  const validated = validateInternationalDigits(raw);
  if (!isOk(validated)) return validated;
  const formatted = formatDigits(validated.value, format);
  return succeed(formatted);
}
