/**
 * Account/card ID extraction — separates display IDs from query IDs.
 * Display IDs are user-facing (last4Digits), query IDs are for API calls (cardUniqueId).
 * Every extraction returns Procedure with full IFieldMatch receipt.
 */

import { findFieldValue, matchField } from '../Mediator/GenericScrapeStrategy.js';
import { PIPELINE_WELL_KNOWN_TXN_FIELDS as WK } from '../Registry/PipelineWellKnown.js';
import { getDebug } from '../Types/Debug.js';
import type { IAccountIdentity, IFieldMatch } from '../Types/FieldMatch.js';
import { buildFallbackMatch } from '../Types/FieldMatch.js';
import type { Procedure } from '../Types/Procedure.js';
import { isOk } from '../Types/Procedure.js';

const LOG = getDebug('scrape-id');

/** User-facing identifier extracted from account record (e.g. last4Digits). */
type DisplayIdValue = string;
/** Internal query identifier sent to billing API (e.g. cardUniqueId). */
type AccountIdValue = string;

/** Combined result of extractIds — identity receipt plus backward-compat values. */
interface IExtractedIds extends IAccountIdentity {
  readonly displayId: DisplayIdValue;
  readonly accountId: AccountIdValue;
}

/**
 * Resolve string value from a Procedure match result.
 * @param result - Procedure from matchField.
 * @param fallback - Fallback string if match failed.
 * @returns Resolved display or account ID value.
 */
function resolveStr(result: Procedure<IFieldMatch>, fallback: DisplayIdValue): DisplayIdValue {
  if (isOk(result)) return String(result.value.value);
  return fallback;
}

/**
 * Resolve IFieldMatch receipt from a Procedure result.
 * @param result - Procedure from matchField.
 * @param fallback - Fallback value for receipt.
 * @returns IFieldMatch receipt.
 */
function resolveReceipt(result: Procedure<IFieldMatch>, fallback: string): IFieldMatch {
  if (isOk(result)) return result.value;
  return buildFallbackMatch(fallback);
}

/**
 * Extract display and query IDs from record via Procedure-based matching.
 * @param record - Account record from init.
 * @returns IExtractedIds with both match receipts and string values.
 */
function extractIds(record: Record<string, unknown>): IExtractedIds {
  const displayResult = matchField(record, WK.displayId);
  const queryResult = matchField(record, WK.queryId);
  const displayId = resolveStr(displayResult, '');
  const accountId = resolveStr(queryResult, displayId);
  const queryReceipt = resolveReceipt(queryResult, displayId);
  const displayReceipt = resolveReceipt(displayResult, accountId);
  LOG.debug(
    {
      cardUniqueId: accountId,
      queryKey: queryReceipt.originalKey,
      queryMatch: queryReceipt.matchingKey,
      displayId,
      displayKey: displayReceipt.originalKey,
      displayMatch: displayReceipt.matchingKey,
    },
    'extractIds',
  );
  return { displayId, accountId, queryIdentifier: queryReceipt, displayIdentifier: displayReceipt };
}

/**
 * Extract card ID from a nested cards array in account record.
 * Matches old VisaCal pattern: { cards: [{ cardUniqueID: "..." }] }
 * @param record - Account record (may be captured POST body).
 * @returns Card ID string or false.
 */
function extractCardId(record: Record<string, unknown>): string | false {
  const cards = record.cards ?? record.Cards;
  if (!Array.isArray(cards) || cards.length === 0) return false;
  const first = cards[0] as Record<string, unknown>;
  const id = findFieldValue(first, WK.queryId);
  if (!id) return false;
  return String(id);
}

export type { IExtractedIds };
export { extractCardId, extractIds };
