/**
 * Txn mapper — converts a single raw API record into a normalised
 * `ITransaction`. Owns the per-field coercion concerns: identifier
 * sanitisation, currency normalisation (shekel aliases → ILS),
 * card-vs-bank amount sign convention, debit/credit netting,
 * direction-WK sign correction, and date/amount sanity gating.
 *
 * Extracted from ScrapeAutoMapper as part of the Phase 5
 * pipeline-decoupling split (master plan
 * pipeline-decoupling-master-2026-05-28 / phase-5).
 */

import type { ITransaction } from '../../../../../Transactions.js';
import { TransactionStatuses, TransactionTypes } from '../../../../../Transactions.js';
import { PIPELINE_WELL_KNOWN_TXN_FIELDS as WK } from '../../../Registry/WK/ScrapeWK.js';
import { getDebug } from '../../../Types/Debug.js';
import {
  type ApiRecord,
  DEFAULT_CURRENCY,
  type ScalarFieldHit,
} from '../AutoMapperFacade/AutoMapperTypes.js';
import { findFieldValue } from '../BfsFieldSearch/BfsFieldSearch.js';
import { coerceNumber, coerceString, parseAutoDate } from '../Coercion/Coercion.js';

const LOG = getDebug(import.meta.url);

/** Shekel currency aliases from WK. */
const SHEKEL_ALIASES = new Set(WK.shekelAliases);

/**
 * Coerce a `findFieldValue` hit to a usable per-txn identifier.
 * Accepts numeric IDs and non-empty strings; rejects the sentinel
 * placeholders (`0`, empty string) Beinleumi emits on pending
 * out-of-statement rows so the identifier never collides with a
 * real one in the dedup hash.
 * @param val - Raw field value from {@link findFieldValue}.
 * @returns The identifier preserved as-is when usable, `false` when
 *   the value is a sentinel placeholder.
 */
function coerceIdentifier(val: ScalarFieldHit): string | number | false {
  if (typeof val === 'number') return val;
  if (typeof val === 'string' && val.length > 0 && val !== '0') return val;
  return false;
}

/**
 * Normalize currency — convert shekel aliases to standard ILS.
 * @param raw - Raw currency string.
 * @returns Normalized currency code.
 */
function normalizeCurrency(raw: string): string {
  if (SHEKEL_ALIASES.has(raw)) return 'ILS';
  return raw;
}

/**
 * Check if a raw transaction is voided/summary (should be filtered
 * out). Matches old scraper's filterValidTransactions logic:
 * dealSumType === '1' is voided, voucherNumberRatz === '000000000'
 * is invalid.
 * @param raw - Raw transaction record.
 * @returns True if the transaction should be excluded.
 */
function isVoidedTransaction(raw: ApiRecord): boolean {
  const voidVal = findFieldValue(raw, WK.voidIndicators);
  if (voidVal === '1') return true;
  const voucher = findFieldValue(raw, WK.voucherFields);
  if (voucher === '000000000') return true;
  return false;
}

/**
 * Negate amount for card transactions (charges are debits).
 * Isracard/Amex report positive amounts for charges — old scraper
 * negates them.
 * @param amount - Raw amount from API.
 * @param isCardTxn - Whether this is a card company transaction.
 * @returns Negated amount for cards, original for banks.
 */
function maybeNegateAmount(amount: number, isCardTxn: boolean): number {
  if (!isCardTxn) return amount;
  if (amount === 0) return 0;
  return -Math.abs(amount);
}

/**
 * Resolve amount — single field or split debit/credit netting.
 * Generic: if WK.amount not found, falls back to credit - debit.
 * @param raw - Raw transaction record.
 * @param singleAmount - Result of findFieldValue(raw, WK.amount).
 * @returns Resolved numeric amount.
 */
function resolveAmount(raw: ApiRecord, singleAmount: ScalarFieldHit): number {
  if (singleAmount !== false) return coerceNumber(singleAmount, 0);
  const debit = findFieldValue(raw, WK.debitAmount);
  const credit = findFieldValue(raw, WK.creditAmount);
  const debitNum = coerceNumber(debit, 0);
  const creditNum = coerceNumber(credit, 0);
  return creditNum - debitNum;
}

/**
 * Apply WK.direction sign convention. Debit indicators flip a positive
 * amount to negative; missing / non-debit directions leave the amount
 * untouched.
 * @param raw - Raw transaction record.
 * @param amount - Amount already resolved via resolveAmount + maybeNegateAmount.
 * @returns Sign-corrected amount.
 */
function applyDirectionWk(raw: ApiRecord, amount: number): number {
  const direction = findFieldValue(raw, WK.direction);
  if (typeof direction !== 'string') return amount;
  if (!/^debit$/i.test(direction)) return amount;
  return -Math.abs(amount);
}

/**
 * Validate a mapped txn before it leaves the auto-mapper. Rejects
 * records with empty date or NaN amount — these would silently
 * drop later in deduplicateTxns / downstream consumers.
 * @param dateIso - Coerced date string (ISO or passthrough).
 * @param amount - Coerced charged amount.
 * @returns True when txn has the minimum required fields.
 */
function isMappableTxn(dateIso: string, amount: number): boolean {
  if (dateIso === '') return false;
  if (!Number.isFinite(amount)) return false;
  const ms = new Date(dateIso).getTime();
  if (Number.isNaN(ms)) return false;
  return true;
}

/**
 * Map a raw API record to a standard ITransaction. Returns false
 * when required fields (date / amount) cannot be coerced, so the
 * extractor can drop the record with a LOUD log instead of letting
 * an empty-date / NaN-amount txn propagate silently.
 * @param raw - Raw transaction record from API response.
 * @returns Mapped transaction, or false on malformed record.
 */
function autoMapTransaction(raw: ApiRecord): ITransaction | false {
  const date = findFieldValue(raw, WK.date);
  const processedDate = findFieldValue(raw, WK.processedDate);
  const amount = findFieldValue(raw, WK.amount);
  const originalAmount = findFieldValue(raw, WK.originalAmount);
  const description = findFieldValue(raw, WK.description);
  const identifier = findFieldValue(raw, WK.identifier);
  const currency = findFieldValue(raw, WK.currency);
  const dateStr = coerceString(date, parseAutoDate);
  const procStr = coerceString(processedDate, parseAutoDate, dateStr);
  const voidField = findFieldValue(raw, WK.voidIndicators);
  const isCard = Boolean(voidField);
  const rawAmt = resolveAmount(raw, amount);
  const negAmt = maybeNegateAmount(rawAmt, isCard);
  const amtNum = applyDirectionWk(raw, negAmt);
  if (!isMappableTxn(dateStr, amtNum)) {
    const why = `date="${dateStr}", amount=${String(amtNum)}`;
    LOG.debug({ message: `autoMapTransaction: rejected (${why})` });
    return false;
  }
  const rawOrig = coerceNumber(originalAmount, amtNum);
  const negOrig = maybeNegateAmount(rawOrig, isCard);
  const origNum = applyDirectionWk(raw, negOrig);
  const descStr = coerceString(description);
  const rawCurr = coerceString(currency, undefined, DEFAULT_CURRENCY);
  const currStr = normalizeCurrency(rawCurr);
  const rawId = coerceIdentifier(identifier);
  const idVal = rawId || undefined;
  return {
    type: TransactionTypes.Normal,
    date: dateStr,
    processedDate: procStr,
    originalAmount: origNum,
    originalCurrency: currStr,
    chargedAmount: amtNum,
    description: descStr,
    status: TransactionStatuses.Completed,
    identifier: idVal,
  };
}

export { autoMapTransaction, isVoidedTransaction };
