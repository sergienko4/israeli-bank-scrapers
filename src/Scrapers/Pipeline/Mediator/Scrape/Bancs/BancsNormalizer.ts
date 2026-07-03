/**
 * BaNCS normalizer — the array-level entry point wired into the shared
 * `extractTransactions` pipeline.
 *
 * <p>Default-deny: when no hunt-collected record passes the BaNCS shape
 * guard the input is returned UNCHANGED, so the other five pipeline
 * banks (Leumi/Discount/VisaCal/Max/Isracard) are provably unaffected.
 * When BaNCS records ARE present it signs them (running-balance delta,
 * see {@link "./BancsSign.js"}) and flattens each into collision-free
 * `bancs*` scalar fields that the generic mapper resolves via the
 * prepended WK aliases in
 * {@link "../../../Registry/WK/ScrapeFieldMappings.js"}.
 */

import type { ApiRecord } from '../AutoMapperFacade/AutoMapperTypes.js';
import { readCurrency, readDateIso, readDescription, readIdentifier } from './BancsFields.js';
import { isBancsTxnRecord } from './BancsShape.js';
import computeSignedAmounts from './BancsSign.js';

/**
 * Processed date, falling back to the value date when absent.
 * @param root - BaNCS record.
 * @returns ISO processed date (`PostedDt`, else `OrigDt`).
 */
function readProcessed(root: ApiRecord): string {
  return readDateIso(root, 'PostedDt') || readDateIso(root, 'OrigDt');
}

/**
 * Build the flat `bancs*` scalar fields for one record.
 * @param root - BaNCS record.
 * @param signedAmount - Pre-signed charged amount from the sign engine.
 * @returns Object of `bancs*` scalars.
 */
function bancsScalars(root: ApiRecord, signedAmount: number): ApiRecord {
  return {
    bancsDate: readDateIso(root, 'OrigDt'),
    bancsProcessedDate: readProcessed(root),
    bancsAmount: signedAmount,
    bancsCurrency: readCurrency(root),
    bancsDescription: readDescription(root),
    bancsIdentifier: readIdentifier(root),
  };
}

/**
 * Flatten one BaNCS record, preserving its original keys.
 * @param root - BaNCS record.
 * @param signedAmount - Pre-signed charged amount.
 * @returns Record augmented with `bancs*` scalars.
 */
function flattenBancs(root: ApiRecord, signedAmount: number): ApiRecord {
  const scalars = bancsScalars(root, signedAmount);
  return { ...root, ...scalars };
}

/**
 * Flatten a BaNCS record; pass any non-BaNCS record through untouched.
 * @param root - Hunt-collected record.
 * @param signedAmount - Pre-signed amount for this index.
 * @returns Normalized BaNCS record, or the original record unchanged.
 */
function mapOne(root: ApiRecord, signedAmount: number): ApiRecord {
  if (!isBancsTxnRecord(root)) return root;
  return flattenBancs(root, signedAmount);
}

/**
 * Normalize BaNCS transaction records inside the hunt output.
 *
 * <p>Runs at ARRAY level because running-balance signing needs every
 * row. No-op (returns input) when nothing looks like BaNCS.
 * @param items - Records collected by `huntTransactions`.
 * @returns Records with `bancs*` fields added to BaNCS rows only.
 */
function normalizeBancsRecords(items: readonly ApiRecord[]): readonly ApiRecord[] {
  if (!items.some(isBancsTxnRecord)) return items;
  const signed = computeSignedAmounts(items);
  return items.map((root, i): ApiRecord => mapOne(root, signed[i]));
}

export default normalizeBancsRecords;
