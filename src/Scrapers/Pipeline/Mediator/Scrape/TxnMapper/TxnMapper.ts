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
 * Raw scalar field set lifted off a single API record via the
 * WK.* registries. Bundled into a single struct so the per-txn
 * orchestrator (`autoMapTransaction`) stays small while the
 * coercion / amount-resolution helpers receive a typed input
 * instead of seven loose positional parameters.
 */
interface IRawTxnFields {
  date: ScalarFieldHit;
  processedDate: ScalarFieldHit;
  amount: ScalarFieldHit;
  originalAmount: ScalarFieldHit;
  description: ScalarFieldHit;
  identifier: ScalarFieldHit;
  currency: ScalarFieldHit;
  voidField: ScalarFieldHit;
}

/**
 * Resolved per-txn amounts after sign-correction and split
 * debit/credit netting. `amtNum` is the signed charged amount,
 * `origNum` is the signed original-currency amount.
 */
interface IResolvedAmounts {
  amtNum: number;
  origNum: number;
}

/**
 * Pre-coerced date strings used to build the mapped txn. Bundled
 * so {@link buildMappedTxn} stays under the parameter cap.
 */
interface IDateStrings {
  date: string;
  processedDate: string;
}

/**
 * WK lookup → field name dispatch map used by {@link extractRawTxnFields}.
 * OCP-style: add a new raw field by appending its WK list here instead
 * of adding a hand-written assignment in the orchestrator.
 */
const RAW_FIELD_LOOKUPS: Readonly<Record<keyof IRawTxnFields, readonly string[]>> = {
  date: WK.date,
  processedDate: WK.processedDate,
  amount: WK.amount,
  originalAmount: WK.originalAmount,
  description: WK.description,
  identifier: WK.identifier,
  currency: WK.currency,
  voidField: WK.voidIndicators,
};

/** Tuple shape produced by `Object.entries(RAW_FIELD_LOOKUPS)` for {@link extractRawTxnFields}. */
type RawLookupEntry = readonly [keyof IRawTxnFields, readonly string[]];

/**
 * Mapper for one {@link RAW_FIELD_LOOKUPS} entry — resolves the
 * raw scalar hit for the given WK alias list against `raw`.
 *
 * @param raw - Raw API record.
 * @returns Mapper from a `[key, aliases]` entry to `[key, value]`.
 */
function buildRawFieldMapper(
  raw: ApiRecord,
): (entry: RawLookupEntry) => [string, ReturnType<typeof findFieldValue>] {
  return ([key, wk]): [string, ReturnType<typeof findFieldValue>] => [key, findFieldValue(raw, wk)];
}

/**
 * Extract every WK.* scalar a single raw record contributes. One
 * `findFieldValue` call per WK list — no fall-back logic, no
 * coercion, just the raw scalar hits the downstream helpers need.
 * @param raw - Raw API record.
 * @returns Bundled raw scalar hits for the record.
 */
function extractRawTxnFields(raw: ApiRecord): IRawTxnFields {
  const entries = Object.entries(RAW_FIELD_LOOKUPS) as readonly RawLookupEntry[];
  const mapper = buildRawFieldMapper(raw);
  const mapped = entries.map(mapper);
  return Object.fromEntries(mapped) as unknown as IRawTxnFields;
}

/**
 * Compute the signed charged + original amounts. Runs the
 * card-negation + direction-WK pipeline on both `amount` and
 * `originalAmount`, falling back to `amount` for `originalAmount`
 * when the record omits it.
 * @param raw - Raw API record (needed for direction-WK lookup).
 * @param fields - Pre-extracted scalar hits.
 * @param isCard - True for Isracard/Amex (debit-as-positive).
 * @returns Signed amounts ready to assign to the mapped txn.
 */
function computeAmounts(raw: ApiRecord, fields: IRawTxnFields, isCard: boolean): IResolvedAmounts {
  const rawAmt = resolveAmount(raw, fields.amount);
  const negAmt = maybeNegateAmount(rawAmt, isCard);
  const amtNum = applyDirectionWk(raw, negAmt);
  const rawOrig = coerceNumber(fields.originalAmount, amtNum);
  const negOrig = maybeNegateAmount(rawOrig, isCard);
  const origNum = applyDirectionWk(raw, negOrig);
  return { amtNum, origNum };
}

/**
 * Resolve the currency + identifier suffix appended to the txn base.
 * Pulled out so {@link buildMappedTxn} stays a thin compose helper.
 *
 * @param fields - Raw scalar hits (currency + identifier).
 * @returns Suffix bundle ready to spread into the final txn.
 */
function resolveTxnSuffix(
  fields: IRawTxnFields,
): Pick<ITransaction, 'originalCurrency' | 'identifier'> {
  const rawCurr = coerceString(fields.currency, undefined, DEFAULT_CURRENCY);
  const rawId = coerceIdentifier(fields.identifier);
  return { originalCurrency: normalizeCurrency(rawCurr), identifier: rawId || undefined };
}

/** Bundled args for {@link buildTxnBase} and {@link buildMappedTxn}. */
interface IBuildTxnInput {
  readonly dates: IDateStrings;
  readonly amounts: IResolvedAmounts;
  readonly fields: IRawTxnFields;
}

/** Transaction shape minus the fields {@link resolveTxnSuffix} owns. */
type ITxnBase = Omit<ITransaction, 'originalCurrency' | 'identifier'>;

/**
 * Build the {@link ITransaction} base without the currency normalisation
 * + identifier sanitisation. Pulled out so {@link buildMappedTxn} stays
 * a thin compose helper.
 *
 * @param input - Bundled dates + amounts + raw fields.
 * @returns Transaction shape minus `originalCurrency` and `identifier`.
 */
function buildTxnBase(input: IBuildTxnInput): ITxnBase {
  return {
    type: TransactionTypes.Normal,
    ...input.dates,
    originalAmount: input.amounts.origNum,
    chargedAmount: input.amounts.amtNum,
    description: coerceString(input.fields.description),
    status: TransactionStatuses.Completed,
  };
}

/**
 * Assemble the final {@link ITransaction} from the resolved
 * primitives. Pure mapping — no coercion or validation beyond
 * the currency normalisation + identifier sanitisation already
 * performed upstream.
 * @param input - Bundled dates + amounts + raw fields.
 * @returns Mapped transaction.
 */
function buildMappedTxn(input: IBuildTxnInput): ITransaction {
  const base = buildTxnBase(input);
  return { ...base, ...resolveTxnSuffix(input.fields) };
}

/**
 * Emit the LOUD "rejected" log line and return `false`. Pulled out so
 * {@link autoMapTransaction} stays under the LoC budget while keeping
 * the rejection telemetry intact.
 *
 * @param dateStr - Coerced date string (may be empty on failure).
 * @param amtNum - Resolved charged amount (may be NaN on failure).
 * @returns Always `false` — the rejection sentinel for the extractor.
 */
function rejectMappedTxn(dateStr: string, amtNum: number): false {
  const why = `date="${dateStr}", amount=${String(amtNum)}`;
  LOG.debug({ message: `autoMapTransaction: rejected (${why})` });
  return false;
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
  const fields = extractRawTxnFields(raw);
  const dateStr = coerceString(fields.date, parseAutoDate);
  const procStr = coerceString(fields.processedDate, parseAutoDate, dateStr);
  const isCard = Boolean(fields.voidField);
  const amounts = computeAmounts(raw, fields, isCard);
  if (!isMappableTxn(dateStr, amounts.amtNum)) return rejectMappedTxn(dateStr, amounts.amtNum);
  return buildMappedTxn({ dates: { date: dateStr, processedDate: procStr }, amounts, fields });
}

export { autoMapTransaction, isVoidedTransaction };
