/**
 * Identity — builds the per-card identity triples emitted by
 * SCRAPE.post to BALANCE-RESOLVE.
 *
 * Pairs each iter accountId with its accountDiscovery record and
 * extracts the (cardDisplayId, cardUniqueId, bankAccountUniqueId)
 * triple. Pure data — no balance work.
 *
 * Extracted from ScrapePhaseActions.ts in Phase 8.5b C4.
 */

import { PIPELINE_WELL_KNOWN_ACCOUNT_FIELDS as WK_ACCT } from '../../../Registry/WK/ScrapeWK.js';
import { type IAccountIdentity, type IPipelineContext } from '../../../Types/PipelineContext.js';
import { findFieldValue } from '../ScrapeAutoMapper.js';

/** Empty identities map sentinel — used for the no-discovery branch. */
const EMPTY_IDENTITIES: ReadonlyMap<string, IAccountIdentity> = new Map();

/** WK aliases for the parent bank-account id (a subset of queryId). */
const BANK_ACCOUNT_ID_FIELDS: readonly string[] = [
  'bankAccountUniqueId',
  'bankAccountUniqueID',
  'partyCurrentAccount',
];

/**
 * Coerce a findFieldValue scalar return to a non-empty string.
 * @param hit - Scalar or false.
 * @returns String form, or empty.
 */
function coerceStringFieldValue(hit: string | number | boolean): string {
  if (hit === false) return '';
  return String(hit);
}

/**
 * Look up the WK queryId value from a record (case-insensitive via
 * findFieldValue) and coerce to a string. Empty string when absent.
 *
 * @param rec - accountDiscovery record.
 * @returns String value or empty.
 */
function lookupQueryIdValue(rec: Record<string, unknown>): string {
  const hit = findFieldValue(rec, [...WK_ACCT.queryId]);
  return coerceStringFieldValue(hit);
}

/**
 * Look up the bank-account-id value from a record using the
 * dedicated BANK_ACCOUNT_ID_FIELDS aliases. Empty string when absent.
 *
 * @param rec - accountDiscovery record.
 * @returns String value or empty.
 */
function lookupBankAccountIdValue(rec: Record<string, unknown>): string {
  const hit = findFieldValue(rec, BANK_ACCOUNT_ID_FIELDS);
  return coerceStringFieldValue(hit);
}

/**
 * Build one identity triple from a single accountDiscovery record.
 * cardUniqueId is picked from queryId fields, bankAccountUniqueId
 * from the bankAccountUniqueId family; both fall back to the display
 * id when the record carries no internal id.
 *
 * @param displayId - Iter accountId (display form).
 * @param rec - accountDiscovery record.
 * @returns Identity triple.
 */
function recordToIdentity(displayId: string, rec: Record<string, unknown>): IAccountIdentity {
  const cardUid = lookupQueryIdValue(rec);
  const bankUid = lookupBankAccountIdValue(rec);
  return {
    cardDisplayId: displayId,
    cardUniqueId: cardUid === '' ? displayId : cardUid,
    bankAccountUniqueId: bankUid === '' ? displayId : bankUid,
  };
}

/**
 * Build the per-card identity map SCRAPE.post emits to BALANCE-RESOLVE.
 * @param ids - Iter accountId list (cardDisplayId form).
 * @param records - accountDiscovery records, same order as ids.
 * @returns Per-card identity map keyed by cardDisplayId.
 */
function buildAccountIdentities(
  ids: readonly string[],
  records: readonly Record<string, unknown>[],
): ReadonlyMap<string, IAccountIdentity> {
  const entries = ids.map((id, i): readonly [string, IAccountIdentity] => {
    const rec = records[i] ?? {};
    return [id, recordToIdentity(id, rec)];
  });
  return new Map(entries);
}

/**
 * Read accountDiscovery and build the identity map. Returns the
 * empty sentinel when accountDiscovery is absent.
 *
 * @param input - Pipeline context.
 * @returns Identity map.
 */
function buildIdentitiesForScrape(input: IPipelineContext): ReadonlyMap<string, IAccountIdentity> {
  if (!input.accountDiscovery.has) return EMPTY_IDENTITIES;
  const { ids, records } = input.accountDiscovery.value;
  return buildAccountIdentities(ids, records);
}

export {
  BANK_ACCOUNT_ID_FIELDS,
  buildAccountIdentities,
  buildIdentitiesForScrape,
  coerceStringFieldValue,
  EMPTY_IDENTITIES,
  recordToIdentity,
};
