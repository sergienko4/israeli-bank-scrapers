/**
 * Account/card ID extraction — separates display IDs from query IDs.
 * Display IDs are user-facing (last4Digits), query IDs are for API calls (cardUniqueId).
 * Every extraction returns Procedure with full IFieldMatch receipt.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { INetworkDiscovery } from '../../../Mediator/Network/NetworkDiscovery.js';
import { findFieldValue, matchField } from '../../../Mediator/Scrape/ScrapeAutoMapper.js';
import { PIPELINE_WELL_KNOWN_TXN_FIELDS as WK } from '../../../Registry/WK/ScrapeWK.js';
import { getDebug as createLogger } from '../../../Types/Debug.js';
import type { IAccountIdentity, IFieldMatch } from '../../../Types/FieldMatch.js';
import { buildFallbackMatch } from '../../../Types/FieldMatch.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../Types/Procedure.js';

const LOG = createLogger('scrape-id');

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

/** Whether debug logging completed. */
type DidLog = boolean;

/**
 * Log extraction diagnostics for debug tracing.
 * @param ids - The extracted IDs.
 * @returns True after logging.
 */
function logExtraction(ids: IExtractedIds): DidLog {
  LOG.debug(
    {
      cardUniqueId: ids.accountId,
      queryKey: ids.queryIdentifier.originalKey,
      queryMatch: ids.queryIdentifier.matchingKey,
      displayId: ids.displayId,
      displayKey: ids.displayIdentifier.originalKey,
      displayMatch: ids.displayIdentifier.matchingKey,
    },
    'extractIds',
  );
  return true;
}

/**
 * Extract display and query IDs from record via Procedure-based matching.
 * @param record - Account record from init.
 * @returns IExtractedIds with both match receipts and string values.
 */
/**
 * Resolve display and account ID strings from record.
 * @param record - Account record.
 * @returns Display and account ID strings.
 */
function resolveIdStrings(record: Record<string, unknown>): {
  displayId: DisplayIdValue;
  accountId: AccountIdValue;
} {
  const displayResult = matchField(record, WK.displayId);
  const queryResult = matchField(record, WK.queryId);
  const displayId = resolveStr(displayResult, '');
  const accountId = resolveStr(queryResult, displayId);
  return { displayId, accountId };
}

/**
 * Extract display and query IDs from record via Procedure-based matching.
 * @param record - Account record from init.
 * @returns IExtractedIds with both match receipts and string values.
 */
function extractIds(record: Record<string, unknown>): IExtractedIds {
  const { displayId, accountId } = resolveIdStrings(record);
  const displayResult = matchField(record, WK.displayId);
  const queryResult = matchField(record, WK.queryId);
  const queryReceipt = resolveReceipt(queryResult, displayId);
  const displayReceipt = resolveReceipt(displayResult, accountId);
  const ids: IExtractedIds = {
    displayId,
    accountId,
    queryIdentifier: queryReceipt,
    displayIdentifier: displayReceipt,
  };
  logExtraction(ids);
  return ids;
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

/** Error message when no captured endpoint carries a displayId. */
const NO_DISPLAY_ID_IN_STORE = 'no displayId field in any captured endpoint';

/** Opaque alias over `unknown` to satisfy no-restricted-syntax on signatures. */
type JsonValue = unknown;
/** Plain-record alias — composes JsonValue to keep function sigs clean. */
type JsonObject = Record<string, JsonValue>;

/**
 * Extract displayId candidate from one captured endpoint body.
 * @param body - Captured responseBody (opaque shape).
 * @returns String displayId or false when body has no match.
 */
function extractDisplayFromBody(body: JsonValue): string | false {
  if (body === null || typeof body !== 'object') return false;
  const hit = findFieldValue(body as JsonObject, WK.displayId);
  if (hit === false || typeof hit === 'boolean') return false;
  return String(hit);
}

/**
 * Scan every captured endpoint for a displayId match. Generic — used when
 * the primary record yields no displayId but a sibling endpoint does.
 * @param network - Network discovery with all captured endpoints.
 * @returns Procedure wrapping the first match, or fail when none.
 */
function resolveDisplayIdFromCapturedEndpoints(network: INetworkDiscovery): Procedure<string> {
  const hit = network
    .getAllEndpoints()
    .map((ep): string | false => extractDisplayFromBody(ep.responseBody))
    .find((v): v is string => v !== false);
  if (typeof hit === 'string') return succeed(hit);
  return fail(ScraperErrorTypes.Generic, NO_DISPLAY_ID_IN_STORE);
}

export type { IExtractedIds };
export { extractCardId, extractIds, resolveDisplayIdFromCapturedEndpoints };
