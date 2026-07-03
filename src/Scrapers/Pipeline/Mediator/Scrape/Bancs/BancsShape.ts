/**
 * BaNCS shape detection + safe nested getters.
 *
 * <p>A record is a TCS BaNCS transaction when it carries BOTH the
 * `OrigDt {Day,Month,Year}` calendar-date object AND the nested
 * `TotalCurAmt.Amt.Value` magnitude — the pair no other pipeline bank
 * emits. {@link isBancsTxnRecord} is therefore the default-deny gate
 * that keeps {@link "./BancsNormalizer.js"} a provable no-op for every
 * non-BaNCS response (Leumi/Discount/VisaCal/Max/Isracard).
 */

import type { ApiRecord } from '../AutoMapperFacade/AutoMapperTypes.js';

/**
 * Coerce any value to a plain record, using `{}` for non-objects.
 * @param v - Value to coerce.
 * @returns `v` as a record, or an empty record when `v` is not an object.
 */
function asRecord(v: unknown): Record<string, unknown> {
  if (v === null || typeof v !== 'object') return {};
  return v as Record<string, unknown>;
}

/**
 * Read one nested link without throwing on a missing/non-object node.
 * @param cur - Current node (any JSON value).
 * @param key - Key to read on `cur`.
 * @returns The child value (absent links surface as `undefined` at runtime).
 */
function descend(cur: unknown, key: string): unknown {
  return asRecord(cur)[key];
}

/**
 * Resolve a nested value by key path (no throw on any missing link).
 * @param root - Record to descend from.
 * @param path - Ordered keys to follow.
 * @returns The value at the path, or undefined when unreachable.
 */
function getIn(root: ApiRecord, path: readonly string[]): unknown {
  return path.reduce<unknown>((cur, key): unknown => descend(cur, key), root);
}

/**
 * Finite-number type guard.
 * @param v - Value to test.
 * @returns True when `v` is a finite number.
 */
function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * String type guard.
 * @param v - Value to test.
 * @returns True when `v` is a string.
 */
function isStr(v: unknown): v is string {
  return typeof v === 'string';
}

/**
 * Whether `field` on `root` is a BaNCS `{Day,Month,Year}` numeric date.
 * @param root - Candidate record.
 * @param field - Date field name (`OrigDt` / `PostedDt`).
 * @returns True when all three numeric parts are present.
 */
function hasCalendarDate(root: ApiRecord, field: string): boolean {
  const parts = ['Year', 'Month', 'Day'].map((k): unknown => getIn(root, [field, k]));
  return parts.every(isNum);
}

/**
 * Shape guard — identifies a BaNCS transaction record.
 * @param root - Candidate record from the hunt output.
 * @returns True when the record is a BaNCS `DataEntity[]` transaction.
 */
function isBancsTxnRecord(root: ApiRecord): boolean {
  if (!hasCalendarDate(root, 'OrigDt')) return false;
  const amount = getIn(root, ['TotalCurAmt', 'Amt', 'Value']);
  return isStr(amount);
}

export { getIn, isBancsTxnRecord, isNum, isStr };
