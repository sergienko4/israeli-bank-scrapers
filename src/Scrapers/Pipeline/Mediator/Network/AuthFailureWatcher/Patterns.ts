/**
 * AuthFailureWatcher Patterns — body-error pattern table + predicates.
 *
 * Patterns derived from real network captures of every migrated
 * pipeline bank. New bank = optionally add ONE row.
 *
 * The predicates remain file-private; the table itself is the single
 * public default export consumed by BodyClassifier.
 */

import type { JsonValue } from '../../../Types/JsonValue.js';
import type { IBodyFailurePattern } from './Types.js';

/**
 * Predicate: true when a numeric login-status field signals failure.
 * @param v - JSON value at the field.
 * @returns True when v is a non-zero number.
 */
function isNonZeroNumber(v: JsonValue): boolean {
  return typeof v === 'number' && v !== 0;
}

/**
 * Predicate: true when error_code is a non-zero number or non-zero string.
 * Beinleumi-shape: success returns 0 (number) or "0" (string).
 * @param v - JSON value at the field.
 * @returns True when v indicates failure.
 */
function isErrorCodeFailure(v: JsonValue): boolean {
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v.length > 0 && v !== '0';
  return false;
}

/**
 * Predicate: true when an `error` field carries any non-empty value.
 * Hapoalim-shape: success returns null; failure returns object/string.
 * @param v - JSON value at the field.
 * @returns True when v indicates a populated error.
 */
function isErrorObjectFailure(v: JsonValue): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.length > 0;
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return false;
}

/**
 * Predicate: true when a Status string is anything other than "SUCCESS".
 * Discount-shape: { Login: { Status: "SUCCESS" } } on success.
 * @param v - JSON value at the field.
 * @returns True when v is a non-success status string.
 */
function isNonSuccessStatus(v: JsonValue): boolean {
  return typeof v === 'string' && v !== 'SUCCESS' && v.length > 0;
}

/**
 * Body-error patterns derived from real network captures of every migrated
 * pipeline bank. New bank = optionally add ONE row. No per-bank code.
 */
const AUTH_BODY_FAILURE_PATTERNS = [
  {
    field: 'LoginStatus',
    isFailure: isNonZeroNumber,
    note: 'Max — Result.LoginStatus !== 0 means invalid credentials',
  },
  {
    field: 'ReturnCode',
    isFailure: isNonZeroNumber,
    note: 'Max — top-level ReturnCode !== 0 means transport error or rejection',
  },
  {
    field: 'error_code',
    isFailure: isErrorCodeFailure,
    note: 'Beinleumi — { error_code, error_message, data } at top level',
  },
  {
    field: 'error',
    isFailure: isErrorObjectFailure,
    note: 'Hapoalim — top-level error object/string',
  },
  {
    field: 'Status',
    isFailure: isNonSuccessStatus,
    note: 'Discount — Login.Status !== "SUCCESS"',
  },
] as const satisfies readonly IBodyFailurePattern[];

export default AUTH_BODY_FAILURE_PATTERNS;
