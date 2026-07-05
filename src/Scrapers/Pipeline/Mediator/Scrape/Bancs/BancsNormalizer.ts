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
 * Sign the BaNCS rows and key each signed amount by its record reference.
 *
 * <p>Only BaNCS rows reach the sign engine, so the chronological sort and
 * running-balance delta cannot be perturbed by a stray non-BaNCS record
 * sharing the hunt output.
 * @param bancsRows - The BaNCS-shaped rows only.
 * @returns Map of record reference → signed charged amount.
 */
function signRows(bancsRows: readonly ApiRecord[]): ReadonlyMap<ApiRecord, number> {
  const signed = computeSignedAmounts(bancsRows);
  return new Map(bancsRows.map((row, j): [ApiRecord, number] => [row, signed[j]]));
}

/**
 * Flatten a signed BaNCS record; pass any other record through untouched.
 * @param root - Hunt-collected record.
 * @param signByRow - Signed amount per BaNCS record reference.
 * @returns Normalized BaNCS record, or the original record unchanged.
 */
function applySign(root: ApiRecord, signByRow: ReadonlyMap<ApiRecord, number>): ApiRecord {
  const signed = signByRow.get(root);
  if (signed === undefined) return root;
  return flattenBancs(root, signed);
}

/**
 * Normalize BaNCS transaction records inside the hunt output.
 *
 * <p>BaNCS rows are filtered out FIRST and signed in isolation, then the
 * signs are mapped back to the original records by reference; non-BaNCS
 * rows pass through untouched. No-op when nothing looks like BaNCS.
 * @param items - Records collected by `huntTransactions`.
 * @returns Records with `bancs*` fields added to BaNCS rows only.
 */
function normalizeBancsRecords(items: readonly ApiRecord[]): readonly ApiRecord[] {
  const bancsRows = items.filter(isBancsTxnRecord);
  if (bancsRows.length === 0) return items;
  const signByRow = signRows(bancsRows);
  return items.map((root): ApiRecord => applySign(root, signByRow));
}

export default normalizeBancsRecords;
