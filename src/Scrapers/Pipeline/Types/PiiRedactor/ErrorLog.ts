/**
 * ErrorLog — `redactErrorMessage` + `redactSensitiveEnum` strategies.
 *
 * Closes CodeQL `js/clear-text-logging` alert #28: bank APIs sometimes
 * echo credentials in the `errorMessage` field, and the
 * discriminated-union `errorType` tag (`InvalidPassword` /
 * `ChangePassword`) is password-class metadata.
 */

import ScraperErrorTypes from '../../../Base/ErrorTypes.js';
import { graphemeCount } from './CommonHelpers.js';
import { type PiiCategory, type PiiHintString } from './Types.js';

export const ERROR_LOG_CATEGORY: PiiCategory = 'unknown';

/**
 * Sensitive scraper-error-enum values that MUST NOT appear in
 * cleartext log lines. Add a new enum value here only when CodeQL or
 * Sonar flags it as sensitive.
 */
export const SENSITIVE_SCRAPER_ENUMS: ReadonlySet<string> = new Set<string>([
  ScraperErrorTypes.InvalidPassword,
  ScraperErrorTypes.ChangePassword,
]);

/**
 * Bank-error-message strategy. Returns a length-tag `<msg:N>` where N
 * is the grapheme count of the raw value. ALWAYS redacts — the
 * `isPiiRedactionDisabled` bypass is intentionally absent because this
 * helper exists specifically to close CodeQL `js/clear-text-logging`
 * alert #28, which is independent of the dev-mode bypass.
 * @param value - Raw error message from a bank API or production code.
 * @returns Length-tagged hint `<msg:N>` or `<msg:0>` for empty input.
 */
function redactErrorMessage(value: string): PiiHintString {
  if (value.length === 0) return '<msg:0>' as PiiHintString;
  const length = graphemeCount(value);
  return `<msg:${String(length)}>` as PiiHintString;
}

/**
 * Sensitive-enum strategy. Replaces sensitive scraper-error-type enum
 * values with the stable token `<REDACTED_ENUM>`; non-sensitive values
 * pass through unchanged. ALWAYS redacts sensitive enums — same
 * rationale as {@link redactErrorMessage}.
 * @param value - Raw scraper-error-type enum value.
 * @returns `<REDACTED_ENUM>` for sensitive values, otherwise input.
 */
function redactSensitiveEnum(value: string): PiiHintString {
  if (value.length === 0) return value as PiiHintString;
  if (SENSITIVE_SCRAPER_ENUMS.has(value)) return '<REDACTED_ENUM>' as PiiHintString;
  return value as PiiHintString;
}

export { redactErrorMessage, redactSensitiveEnum };
