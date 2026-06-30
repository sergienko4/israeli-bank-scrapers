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
 * Normalise a caller-supplied phone string into the bank's wire form.
 * Returns a Procedure so the pipeline can surface validation errors
 * with a clear diagnostic message.
 * @param raw - Caller-supplied digits-only international form.
 * @param format - Per-bank wire-format selector.
 * @returns Procedure with the formatted wire string.
 */
export function formatPhoneNumber(raw: string, format: PhoneNumberFormat): Procedure<string> {
  const validated = validateInternationalDigits(raw);
  if (!isOk(validated)) return validated;
  const cc = validated.value.slice(0, IL_COUNTRY_CODE.length);
  const local = validated.value.slice(IL_COUNTRY_CODE.length);
  const formatted = applyPhoneFormat({ cc, local, format });
  return succeed(formatted);
}
