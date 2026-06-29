/**
 * Restore the BaNCS request-envelope origin (`UIID.Id`) the bank's
 * input validator requires on data-bearing transaction windows.
 *
 * <p>The dashboard-captured filtered template carries an EMPTY origin
 * (its default narrow window had no rows, so the UI never tripped the
 * validator). Replayed data-bearing windows then fail with `88501`
 * (`SubjctElmnt.Path:"origin"`) and drop the month's transactions.
 * This module repopulates the origin, gated structurally on the BaNCS
 * `UIIDomain` marker, so every other bank's body stays byte-identical.
 */

import ORIGIN from '../../../Registry/WK/ScrapeRequestEnvelope.js';
import type { JsonRecord } from './JsonTypes.js';

/** Mutable origin-envelope view after the structural guard. */
type OriginEnvelope = Record<string, unknown>;

/**
 * Type-guard a value as a plain record so property access never throws.
 * @param value - Candidate value (array/primitive/null rejected).
 * @returns True when the value is a plain object record.
 */
function isRecord(value: unknown): value is OriginEnvelope {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Decide whether the envelope is a BaNCS UIIDomain origin missing its
 * screen id.
 * @param uiid - Candidate origin envelope.
 * @returns True when the marker matches and `Id` is empty/absent.
 */
function isEmptyBancsOrigin(uiid: OriginEnvelope): boolean {
  const ver = uiid[ORIGIN.verField];
  if (typeof ver !== 'string' || !ver.includes(ORIGIN.verMarker)) return false;
  const id = uiid[ORIGIN.idField];
  return id === undefined || id === '';
}

/**
 * Populate the empty `UIID.Id` origin a BaNCS data-bearing window
 * requires. No-op for non-BaNCS bodies or already-populated origins.
 * @param body - Parsed POST body, mutated in place.
 */
function ensureRequestOrigin(body: JsonRecord): void {
  const uiid = body[ORIGIN.envelopeKey];
  if (!isRecord(uiid) || !isEmptyBancsOrigin(uiid)) return;
  uiid[ORIGIN.idField] = ORIGIN.value;
}

export default ensureRequestOrigin;
