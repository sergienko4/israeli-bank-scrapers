/**
 * Field-map resolution helpers for the EndpointResolver. Pulled out
 * so the orchestrator file stays under the 150-line cap.
 *
 * Owns every WK_TXN alias walk used by DASHBOARD.FINAL — date,
 * amount (with credit/debit fallback), description, currency,
 * identifier, plus the three optionals (originalAmount,
 * processedDate, balance) — and exposes a single
 * {@link resolveFieldMapOrEmpty} that the orchestrator commits as
 * the per-run {@link ITxnFieldMap}.
 */

import { PIPELINE_WELL_KNOWN_TXN_FIELDS as WK } from '../../../Registry/WK/ScrapeWK.js';
import type { ITxnFieldMap } from '../../../Types/PipelineContext.js';
import type { ApiRecord } from '../AutoMapperFacade/AutoMapperTypes.js';

/**
 * Resolve the first-found field-name alias for one TXN-side
 * concern. Walks the WK alias list against the first record's keys
 * (case-sensitive equality) and returns the first match.
 * @param record - First record from the txn array.
 * @param aliases - WK alias list.
 * @returns First matching key, or empty string when no alias hits.
 */
function resolveAlias(record: ApiRecord, aliases: readonly string[]): string {
  const present = aliases.find((alias): boolean => alias in record);
  return present ?? '';
}

/**
 * Same as {@link resolveAlias} but returns `false` instead of empty
 * string when no alias hits. Used for the optional fields
 * (`originalAmount`, `processedDate`, `balance`).
 * @param record - First record from the txn array.
 * @param aliases - WK alias list.
 * @returns First matching key, or `false` when absent.
 */
function resolveOptionalAlias(record: ApiRecord, aliases: readonly string[]): string | false {
  const hit = aliases.find((alias): boolean => alias in record);
  return hit ?? false;
}

/**
 * Pick the amount field alias from a sample record. Falls back to
 * credit / debit aliases when WK.amount is absent so the Beinleumi
 * split-pair shape still passes the field-map check.
 * @param sample - First record from the txn array.
 * @returns Alias string, or '' when no match.
 */
function pickAmountAlias(sample: ApiRecord): string {
  const direct = resolveAlias(sample, WK.amount);
  if (direct !== '') return direct;
  const credit = resolveAlias(sample, WK.creditAmount);
  if (credit !== '') return credit;
  return resolveAlias(sample, WK.debitAmount);
}

/** Optional fieldMap aliases resolved via {@link resolveOptionalAlias}. */
interface IFieldMapOptionals {
  readonly originalAmount: string | false;
  readonly processedDate: string | false;
  readonly balance: string | false;
}

/**
 * Resolve the optional aliases bundle for {@link buildFieldMap}.
 * Pulled out so the orchestrator stays a thin guard + return.
 *
 * @param sample - First record from the txn array.
 * @returns Bundle holding the three optional alias results.
 */
function resolveOptionalFields(sample: ApiRecord): IFieldMapOptionals {
  return {
    originalAmount: resolveOptionalAlias(sample, WK.originalAmount),
    processedDate: resolveOptionalAlias(sample, WK.processedDate),
    balance: resolveOptionalAlias(sample, WK.balance),
  };
}

/**
 * Build the per-run {@link ITxnFieldMap} from a sample record.
 * Returns `false` when neither a date alias nor any amount alias
 * resolves — DASHBOARD.FINAL escalates to F-DASH-2.
 * @param sample - First record from the txn array.
 * @returns Resolved field map or `false`.
 */
function buildFieldMap(sample: ApiRecord): ITxnFieldMap | false {
  const date = resolveAlias(sample, WK.date);
  const amount = pickAmountAlias(sample);
  if (date === '' || amount === '') return false;
  const description = resolveAlias(sample, WK.description);
  const currency = resolveAlias(sample, WK.currency);
  const identifier = resolveAlias(sample, WK.identifier);
  return { date, amount, description, currency, identifier, ...resolveOptionalFields(sample) };
}

/** Empty fieldMap returned when the picked capture has zero
 *  transaction records (replayablePost tier — bank's session
 *  window has no recent activity). */
const EMPTY_FIELD_MAP: ITxnFieldMap = {
  date: '',
  amount: '',
  description: '',
  currency: '',
  identifier: '',
  originalAmount: false,
  processedDate: false,
  balance: false,
};

/**
 * Resolve a fieldMap from the first transaction record, or fall
 * back to the empty fieldMap when the body has zero records.
 * @param records - Records harvested by `huntTransactions`.
 * @returns Resolved fieldMap (never `false`).
 */
function resolveFieldMapOrEmpty(records: readonly ApiRecord[]): ITxnFieldMap {
  if (records.length === 0) return EMPTY_FIELD_MAP;
  const sampleFieldMap = buildFieldMap(records[0]);
  if (sampleFieldMap === false) return EMPTY_FIELD_MAP;
  return sampleFieldMap;
}

export default resolveFieldMapOrEmpty;
