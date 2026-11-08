/**
 * Validates account identities and amounts before tolerant extraction.
 */

import {
  findFieldValue,
  matchFieldInRecord,
} from '../../../Mediator/Scrape/BfsFieldSearch/BfsFieldSearch.js';
import { coerceNumber } from '../../../Mediator/Scrape/Coercion/Coercion.js';
import { signCardAmounts } from '../../../Mediator/Scrape/TxnMapper/TxnSign.js';
import { PIPELINE_WELL_KNOWN_TXN_FIELDS as WK } from '../../../Registry/WK/ScrapeWK.js';

/**
 * Narrows an untrusted financial entry.
 * @param value - Untrusted entry.
 * @returns Whether it is a record.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
  return (
    typeof index === 'number' &&
    Number.isSafeInteger(index) &&
    index >= 0 &&
    typeof display === 'string' &&
    display.trim().length > 0
  );
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

export { validAccounts, validTransactionAmount };
