/**
 * Validates financial identities, dates and amounts before tolerant extraction.
 */

import { bankMomentOfInstant } from '../../../Mediator/Scrape/BankCalendar.js';
import {
  findFieldValue,
  matchFieldInRecord,
} from '../../../Mediator/Scrape/BfsFieldSearch/BfsFieldSearch.js';
import { coerceNumber, parseAutoDate } from '../../../Mediator/Scrape/Coercion/Coercion.js';
import { signCardAmounts } from '../../../Mediator/Scrape/TxnMapper/TxnSign.js';
import { PIPELINE_WELL_KNOWN_TXN_FIELDS as WK } from '../../../Registry/WK/ScrapeWK.js';

const COMPLETE_ISO_DATE = /^(?:\d{4}-\d{2}-\d{2}|\d{8})(?:T|$)/;
const CONTROL_CHARACTERS = /\p{Cc}/u;

/**
 * Narrows an untrusted financial entry.
 * @param value - Untrusted entry.
 * @returns Whether it is a record.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Checks whether a raw account index is a non-negative safe integer.
 * @param value - Untrusted AccountIndex field.
 * @returns True for a non-negative safe integer.
 */
function isAccountIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Requires both identifiers used to retrieve and label an account.
 * @param value - Untrusted account entry.
 * @returns Whether its identifiers are usable.
 */
function validAccount(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const index: unknown = Reflect.get(value, 'AccountIndex');
  const display: unknown = Reflect.get(value, 'MaskedNumber');
  return isAccountIndex(index) && typeof display === 'string' && display.trim().length > 0;
}

/**
 * Rejects ambiguous account identifiers before any account-specific call.
 * @param accounts - Untrusted account entries.
 * @returns Whether each index and display number is unique.
 */
function validAccounts(accounts: readonly unknown[]): boolean {
  if (!accounts.every(validAccount)) return false;
  return ['AccountIndex', 'MaskedNumber'].every((field): boolean => {
    const values = accounts.map((account): unknown => account[field]);
    return new Set(values).size === accounts.length;
  });
}

/**
 * Requires a finite number or numeric string.
 * @param value - Untrusted amount.
 * @returns Whether the amount is usable.
 */
function finiteAmount(value: unknown): value is string | number {
  if (typeof value !== 'string' && typeof value !== 'number') return false;
  const parsed = coerceNumber(value, Number.NaN);
  return Number.isFinite(parsed);
}

/**
 * Requires original amount and signs to survive the mapper unchanged.
 * @param value - Untrusted transaction record.
 * @param amount - Validated row amount.
 * @returns Whether both mapped amounts are rooted and retain their signs.
 */
function validMappedAmounts(value: Record<string, unknown>, amount: string | number): boolean {
  const original = findFieldValue(value, WK.originalAmount);
  if (original !== matchFieldInRecord(value, WK.originalAmount)) return false;
  if (original !== false && !finiteAmount(original)) return false;
  const charged = coerceNumber(amount, Number.NaN);
  const initial = coerceNumber(original, charged);
  const signed = signCardAmounts({ raw: value, amount: charged, original: initial, isCard: false });
  return signed.amtNum === charged && signed.origNum === initial;
}

/**
 * Requires the mapper to use Leumi's own amount and a finite original amount.
 * @param value - Untrusted transaction entry.
 * @returns Whether its mapped amounts are usable.
 */
function validTransactionAmount(value: unknown): boolean {
  if (!isRecord(value) || !Object.hasOwn(value, 'Amount')) return false;
  if (!finiteAmount(value.Amount)) return false;
  if (findFieldValue(value, WK.amount) !== value.Amount) return false;
  return validMappedAmounts(value, value.Amount);
}

/**
 * Excludes placeholders and numbers that cannot be represented precisely.
 * @param value - Untrusted transaction identifier.
 * @returns Whether the mapper can preserve it without a placeholder or precision loss.
 */
function usableIdentifier(value: unknown): value is string | number {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value !== 0;
  if (typeof value !== 'string') return false;
  return value.trim() !== '' && value.trim() !== '0' && !CONTROL_CHARACTERS.test(value);
}

/**
 * Prefers FITID over the coarser reference.
 * @param value - Transaction row.
 * @returns The provider's primary identifier or its documented fallback.
 */
function sourceIdentifier(value: Record<string, unknown>): unknown {
  if (Object.hasOwn(value, 'FITID') && usableIdentifier(value.FITID)) return value.FITID;
  return Object.hasOwn(value, 'ReferenceNumberLong') ? value.ReferenceNumberLong : undefined;
}

/**
 * Removes an unusable FITID on a copy so the mapper can reach the fallback.
 * @param value - Transaction row.
 * @returns A row where an unusable primary identifier cannot mask the fallback.
 */
function normalizeTransactionIdentifier(value: Record<string, unknown>): Record<string, unknown> {
  if (usableIdentifier(value.FITID) || !Object.hasOwn(value, 'FITID')) return value;
  const normalized = { ...value };
  Reflect.deleteProperty(normalized, 'FITID');
  return normalized;
}

/**
 * Validates the date and checks mapper precedence.
 * @param value - Transaction row.
 * @returns Whether the mapper resolves the valid provider date.
 */
function validSourceDate(value: Record<string, unknown>): boolean {
  if (!Object.hasOwn(value, 'DateUTC') || typeof value.DateUTC !== 'string') return false;
  if (!COMPLETE_ISO_DATE.test(value.DateUTC)) return false;
  if (!bankMomentOfInstant(value.DateUTC, true).isValid()) return false;
  const day = value.DateUTC.slice(0, value.DateUTC[4] === '-' ? 10 : 8);
  if (parseAutoDate(day) === '') return false;
  return findFieldValue(value, WK.date) === value.DateUTC;
}

/**
 * Checks that mapping retains provider-supplied identity and date.
 * @param value - Untrusted transaction row.
 * @returns Whether its date and identifier survive mapping.
 */
function validTransactionSource(value: unknown): boolean {
  if (!isRecord(value) || !validSourceDate(value)) return false;
  const identifier = sourceIdentifier(value);
  if (!usableIdentifier(identifier)) return false;
  const normalized = normalizeTransactionIdentifier(value);
  return findFieldValue(normalized, WK.identifier) === identifier;
}

export {
  normalizeTransactionIdentifier,
  validAccounts,
  validTransactionAmount,
  validTransactionSource,
};
