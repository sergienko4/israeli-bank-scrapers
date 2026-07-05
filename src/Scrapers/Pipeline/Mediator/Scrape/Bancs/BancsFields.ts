/**
 * BaNCS per-field scalar readers.
 *
 * <p>Each reader pulls one `ITransaction`-shaped scalar out of a raw
 * BaNCS `DataEntity[]` record, flattening the nested TCS BaNCS envelope
 * (`OrigDt {Day,Month,Year}` → ISO, `TotalCurAmt.Amt.Value` → magnitude
 * string, `TxnId.TxnIds.TRANSACTIONID` → id) so the shared generic
 * mapper can consume them via the prepended `bancs*` WK aliases.
 */

import type { ApiRecord } from '../AutoMapperFacade/AutoMapperTypes.js';
import { getIn, isNum, isStr } from './BancsShape.js';

/**
 * Zero-pad a number to 2 digits.
 * @param n - Number to pad.
 * @returns Two-character string (e.g. `6` → `"06"`).
 */
function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Read a BaNCS `{Day,Month,Year}` date object as `YYYY-MM-DD`.
 *
 * <p>Emitted in `YYYY-MM-DD` (a {@link "../../../Registry/WK/ScrapeWK.js"}
 * `KNOWN_DATE_FORMATS` member) so it flows through the shared
 * `parseAutoDate` identically to every other bank's date string. BaNCS
 * `Month` is 1-based (verified from live trace).
 * @param root - BaNCS record.
 * @param field - Date field name (`OrigDt` / `PostedDt`).
 * @returns ISO calendar date, or empty string when parts are missing.
 */
function readDateIso(root: ApiRecord, field: string): string {
  const y = getIn(root, [field, 'Year']);
  const m = getIn(root, [field, 'Month']);
  const d = getIn(root, [field, 'Day']);
  if (!isNum(y) || !isNum(m) || !isNum(d)) return '';
  return `${String(y)}-${pad2(m)}-${pad2(d)}`;
}

/**
 * Read a nested string scalar, defaulting to empty string.
 * @param root - BaNCS record.
 * @param path - Nested key path to the scalar.
 * @returns The string value, or empty string when absent/non-string.
 */
function readString(root: ApiRecord, path: readonly string[]): string {
  const v = getIn(root, path);
  return isStr(v) ? v : '';
}

/**
 * Read the unsigned amount magnitude string.
 * @param root - BaNCS record.
 * @returns `TotalCurAmt.Amt.Value` (unsigned), or empty string.
 */
function readMagnitude(root: ApiRecord): string {
  return readString(root, ['TotalCurAmt', 'Amt', 'Value']);
}

/**
 * Read the ISO currency code, defaulting to ILS.
 * @param root - BaNCS record.
 * @returns `TotalCurAmt.CurrCode.CDE`, or `ILS` when absent.
 */
function readCurrency(root: ApiRecord): string {
  return readString(root, ['TotalCurAmt', 'CurrCode', 'CDE']) || 'ILS';
}

/**
 * Read the per-transaction unique identifier.
 * @param root - BaNCS record.
 * @returns `TxnId.TxnIds.TRANSACTIONID`, or empty string.
 */
function readIdentifier(root: ApiRecord): string {
  return readString(root, ['TxnId', 'TxnIds', 'TRANSACTIONID']);
}

/**
 * First non-empty string in a preference list.
 * @param values - Ordered candidates.
 * @returns The first non-empty value, or empty string.
 */
function firstNonEmpty(values: readonly string[]): string {
  return values.find((v): boolean => v.length > 0) ?? '';
}

/**
 * Read the user-facing description (Memo, then type fallbacks).
 * @param root - BaNCS record.
 * @returns `Memo` → `TxnType.TypVal.DSC` → `TxnType.Desc`, or empty.
 */
function readDescription(root: ApiRecord): string {
  return firstNonEmpty([
    readString(root, ['Memo']),
    readString(root, ['TxnType', 'TypVal', 'DSC']),
    readString(root, ['TxnType', 'Desc']),
  ]);
}

/**
 * Read the transaction type code (for sign direction lookup).
 * @param root - BaNCS record.
 * @returns `TxnType.OthrSubTyp` → `TxnType.TypVal.CDE`, or empty.
 */
function readTypeCode(root: ApiRecord): string {
  return firstNonEmpty([
    readString(root, ['TxnType', 'OthrSubTyp']),
    readString(root, ['TxnType', 'TypVal', 'CDE']),
  ]);
}

/**
 * Read the post-transaction running balance as a number.
 * @param root - BaNCS record.
 * @returns `StmtRunningBal[0].CurrAmt.Amt.Value` as number, or NaN when
 *   absent (NaN is the "no balance" sentinel — the sign engine treats it
 *   as unusable and falls back to the type-code direction map).
 */
function readRunningBalance(root: ApiRecord): number {
  const v = readString(root, ['StmtRunningBal', '0', 'CurrAmt', 'Amt', 'Value']);
  if (v === '') return Number.NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : Number.NaN;
}

export {
  readCurrency,
  readDateIso,
  readDescription,
  readIdentifier,
  readMagnitude,
  readRunningBalance,
  readTypeCode,
};
