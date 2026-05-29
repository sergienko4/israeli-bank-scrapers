/**
 * Generic scrape strategy — auto-maps API responses.
 * Banks provide ZERO mapping code. The mediator discovers
 * field names automatically via BFS iterative search.
 */

import {
  PIPELINE_WELL_KNOWN_ACCOUNT_FIELDS as WK_ACCT,
  PIPELINE_WELL_KNOWN_API as WK_API,
  PIPELINE_WELL_KNOWN_BILLING as WK_BILLING,
  PIPELINE_WELL_KNOWN_TXN_FIELDS as WK,
} from '../../Registry/WK/ScrapeWK.js';
import type {
  ITxnEndpoint,
  ITxnEndpointInternal,
  ITxnFieldMap,
} from '../../Types/PipelineContext.js';
import type { INetworkDiscovery } from '../Network/NetworkDiscovery.js';
import { type ApiRecord } from './AutoMapperFacade/AutoMapperTypes.js';
import { extractTransactions } from './ContainerPicker/ContainerPicker.js';
import huntTransactions from './FieldHunt/TxnHunt.js';

export type { IMonthChunk } from '../Scrape/ScrapeReplayAction.js';
export {
  buildMonthBody,
  generateMonthChunks,
  isMonthlyEndpoint,
  isRangeIterable,
  replaceField,
} from '../Scrape/ScrapeReplayAction.js';

// ── Phase 7e — DASHBOARD.FINAL TXN-endpoint resolver ──────────────────────────

/**
 * Resolve the first-found field-name alias for one TXN-side concern.
 * Walks the WK alias list against the first record's keys (case-
 * sensitive equality) and returns the first match. Pure check, no
 * extraction. Used by {@link resolveTxnEndpoint} to build the per-
 * run {@link ITxnFieldMap}.
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
 * (`originalAmount`, `processedDate`, `balance`) that not every bank
 * exposes — consumers test the boolean before walking.
 * @param record - First record from the txn array.
 * @param aliases - WK alias list.
 * @returns First matching key, or `false` when absent.
 */
function resolveOptionalAlias(record: ApiRecord, aliases: readonly string[]): string | false {
  const hit = aliases.find((alias): boolean => alias in record);
  return hit ?? false;
}

/**
 * Build the {@link ITxnFieldMap} for the first txn record in a
 * captured response body. Date and amount are required (their
 * absence trips DASHBOARD.FINAL's F-DASH-2 fail-loud). Other fields
 * are optional.
 * @param sample - First txn record from the captured response.
 * @returns Resolved field map, or `false` when date or amount cannot
 *   be resolved (caller fails the run with F-DASH-2).
 */
/**
 * Pick the amount field alias from a sample record. Banks expose the
 * amount in one of three shapes:
 *
 * <ol>
 *   <li>Single signed amount under {@link WK.amount} (Discount / Max
 *       /Hapoalim and most card-family backends).</li>
 *   <li>Split credit + debit pair under {@link WK.creditAmount} +
 *       {@link WK.debitAmount} (Beinleumi). The runtime
 *       {@link autoMapTransaction} already nets the two sides, so this
 *       helper returns whichever side is present so the field-map
 *       check passes; downstream `parseFreshResponse` consumers must
 *       look at both `creditAmount` and `debitAmount` aliases when
 *       `WK.amount` does not match.</li>
 *   <li>Neither shape — record is not a transaction; return ''.</li>
 * </ol>
 *
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

/**
 * Build the per-run {@link ITxnFieldMap} from a sample record. Returns
 * `false` when neither a date alias nor any amount alias resolves —
 * DASHBOARD.FINAL escalates to F-DASH-2 in that case so SCRAPE never
 * starts against a body whose schema is unrecognised.
 * @param sample - First record from the txn array.
 * @returns Resolved field map or `false`.
 */
function buildFieldMap(sample: ApiRecord): ITxnFieldMap | false {
  const date = resolveAlias(sample, WK.date);
  const amount = pickAmountAlias(sample);
  if (date === '' || amount === '') return false;
  return {
    date,
    amount,
    description: resolveAlias(sample, WK.description),
    currency: resolveAlias(sample, WK.currency),
    identifier: resolveAlias(sample, WK.identifier),
    originalAmount: resolveOptionalAlias(sample, WK.originalAmount),
    processedDate: resolveOptionalAlias(sample, WK.processedDate),
    balance: resolveOptionalAlias(sample, WK.balance),
  };
}

/**
 * Phase 7e — resolve the TXN endpoint from DASHBOARD's captures.
 *
 * <p>Combines the existing
 * {@link INetworkDiscovery.discoverTransactionsEndpoint} URL pick
 * with a per-run {@link ITxnFieldMap} resolution from the captured
 * response body. The output is the single source of truth SCRAPE
 * consumes — every artifact pre-resolved so SCRAPE imports zero WK.
 *
 * <p>Returns `false` in two cases:
 * <ul>
 *   <li>No capture in the network's pool matches `WK_API.transactions`
 *       (DASHBOARD.FINAL escalates to F-DASH-1).</li>
 *   <li>The picked capture's response body has no record exposing a
 *       date OR amount field that `WK_TXN.date` / `WK_TXN.amount`
 *       recognises (DASHBOARD.FINAL escalates to F-DASH-2).</li>
 * </ul>
 *
 * @param network - Network surface exposing the pool of captures.
 * @returns Resolved {@link ITxnEndpoint}, or `false`.
 */
/** Lookup table for the POST-template branch — replaces an inline ternary. */
const TEMPLATE_POST_LOOKUP: Record<'true' | 'false', (postData: string) => string | false> = {
  /**
   * Captured POST body present.
   * @param postData - Raw POST body.
   * @returns Same string back.
   */
  true: (postData): string | false => postData,
  /**
   * No POST body (GET endpoint or empty body).
   * @returns Sentinel false.
   */
  false: (): string | false => false,
};

/**
 * Resolve the POST template for {@link ITxnEndpoint.templatePostData}
 * — extracted so {@link resolveTxnEndpoint} stays inside the
 * cyclomatic-complexity ceiling.
 * @param method - HTTP method of the captured endpoint.
 * @param postData - Raw POST body (empty string when not a POST).
 * @returns The body when method=POST and body non-empty, false otherwise.
 */
function resolveTemplatePostData(method: 'GET' | 'POST', postData: string): string | false {
  const hasPostBody = method === 'POST' && postData !== '';
  const key = String(hasPostBody) as 'true' | 'false';
  return TEMPLATE_POST_LOOKUP[key](postData);
}

/**
 * Phase 7e — resolve the TXN endpoint from DASHBOARD's captures.
 * Combines the existing
 * {@link INetworkDiscovery.discoverTransactionsEndpoint} URL pick
 * with a per-run {@link ITxnFieldMap} resolution from the captured
 * response body. Returns `false` when the network has no captured
 * TXN URL OR the picked body has no record exposing a date AND
 * amount field — DASHBOARD.FINAL escalates each case to a distinct
 * fail-loud error.
 * @param network - Network surface exposing the pool of captures.
 * @returns Resolved endpoint or `false`.
 */
/**
 * Resolve the pending-transactions API URL from captured traffic, or
 * fall back to constructing it under the discovered API origin using
 * the canonical `Transactions/api/approvals/getClearanceRequests`
 * path. Returns `false` when neither source resolves a URL — the
 * bank simply does not expose pending in this run.
 *
 * <p>Phase 7e: this discovery moves out of {@link fetchAndMergePending}
 * and into DASHBOARD.FINAL's {@link resolveTxnEndpoint} — SCRAPE
 * consumes the pre-resolved URL via `ctx.txnEndpoint.pendingUrl` and
 * imports zero `WK_API`.
 *
 * @param network - Network surface exposing the captured pool.
 * @returns Pending URL string or `false`.
 */
function resolvePendingUrl(network: INetworkDiscovery): string | false {
  const ep = network.discoverByPatterns(WK_API.pending);
  if (ep) return ep.url;
  const origin = network.discoverApiOrigin();
  if (!origin) return false;
  return `${origin}/Transactions/api/approvals/getClearanceRequests`;
}

/**
 * Returns true when a captured POST body carries any
 * {@link WK_ACCT.queryId} alias — i.e. the request is scoped per-card.
 * Used to distinguish a billing endpoint (per-card POST) from other
 * captures matching `WK_API.transactions`.
 * @param postData - Captured POST body string.
 * @returns True when at least one alias appears.
 */
function billingBodyCarriesCardId(postData: string): boolean {
  if (!postData) return false;
  return WK_ACCT.queryId.some((alias): boolean => postData.includes(alias));
}

/**
 * Build the canonical billing URL under a discovered API origin using
 * `WK_BILLING` path fragments. No hostname is hardcoded — the origin
 * comes from a URL the bank's own SPA already touched.
 * @param anyCapturedUrl - URL already captured on the target host.
 * @returns Built billing URL string.
 */
function buildBillingUrlFromOrigin(anyCapturedUrl: string): string {
  const origin = new URL(anyCapturedUrl).origin;
  const { apiPrefix, pathFragment, actionName } = WK_BILLING;
  return `${origin}${apiPrefix}/${pathFragment}/${actionName}`;
}

/**
 * Resolve the billing-fallback URL from captured traffic. Priority:
 * <ol>
 *   <li>A captured URL already under {@link WK_BILLING.pathFragment}
 *       — use its origin directly.</li>
 *   <li>A captured `WK_API.transactions` URL whose POST body carries a
 *       `WK_ACCT.queryId` alias — build a canonical billing URL
 *       under that capture's origin.</li>
 *   <li>No match — return `false` (bank doesn't expose the family).</li>
 * </ol>
 *
 * <p>Phase 7e: this discovery moves out of
 * {@link tryBillingFallback} and into DASHBOARD.FINAL's
 * {@link resolveTxnEndpoint} — SCRAPE consumes the pre-resolved URL
 * via `ctx.txnEndpoint.billingUrl` and imports zero
 * `WK_API`/`WK_BILLING`.
 *
 * @param network - Network surface exposing the captured pool.
 * @returns Built billing URL or `false`.
 */
function resolveBillingUrl(network: INetworkDiscovery): string | false {
  const captured = network.getAllEndpoints();
  const direct = captured.find((ep): boolean => ep.url.includes(WK_BILLING.pathFragment));
  if (direct) return buildBillingUrlFromOrigin(direct.url);
  const txnPatterns = WK_API.transactions;
  const shaped = captured.find((ep): boolean => {
    const isUrlMatch = txnPatterns.some((p): boolean => p.test(ep.url));
    if (!isUrlMatch) return false;
    return billingBodyCarriesCardId(ep.postData);
  });
  if (shaped) return buildBillingUrlFromOrigin(shaped.url);
  return false;
}

/** Empty fieldMap returned when the picked capture has zero transaction
 *  records (replayablePost tier — bank's session window has no recent
 *  activity). The URL+method are still authoritative for SCRAPE replay;
 *  per-account requests may yield non-empty bodies and `extractTransactions`
 *  auto-discovers fields at parse time. */
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
 * Resolve a fieldMap from the first transaction record, or fall back to
 * the empty fieldMap when the body has zero records. SCRAPE re-fetches
 * per-account, so the empty case is valid for `replayablePost` URLs.
 * @param records - Records harvested by `huntTransactions`.
 * @returns Resolved fieldMap (never `false`).
 */
function resolveFieldMapOrEmpty(records: readonly ApiRecord[]): ITxnFieldMap {
  if (records.length === 0) return EMPTY_FIELD_MAP;
  const sampleFieldMap = buildFieldMap(records[0]);
  if (sampleFieldMap === false) return EMPTY_FIELD_MAP;
  return sampleFieldMap;
}

/**
 * Phase 7f — resolve the TXN endpoint from DASHBOARD's captures.
 * Returns the wider {@link ITxnEndpointInternal} so DASHBOARD.FINAL
 * can emit the `dashboard.txnEndpoint.committed` telemetry with the
 * picker's diagnostics; DASHBOARD then unwraps `.endpoint` and
 * commits ONLY the slim {@link ITxnEndpoint} to `ctx.txnEndpoint`.
 * SCRAPE never sees `captureIndex`, `responseBodySample`,
 * `normalizedRecords`, `pickerTier`, or `capturedPreClick`.
 *
 * <p>Returns `false` ONLY when the picker found no URL match or the
 * body is malformed JSON. An empty body for a valid `replayablePost`
 * URL is committed with an empty fieldMap — SCRAPE re-fetches per
 * account and the per-account parse falls back to legacy
 * auto-discovery for that one execution.
 *
 * @param network - Network surface exposing the pool of captures.
 * @returns Resolved internal payload or `false`.
 */
function resolveTxnEndpoint(network: INetworkDiscovery): ITxnEndpointInternal | false {
  const ep = network.discoverTransactionsEndpoint();
  if (ep === false) return false;
  const body = ep.responseBody;
  // Phase H' (2026-05-14): a null body is a valid 2xx-no-content
  // response (e.g. 204 from Hapoalim's current-account transactions
  // when the SPA-default 30-day window holds zero txns). Treat as
  // an empty object so URL+method are still committed; SCRAPE
  // re-queries with the user's wider startDate window and the
  // auto-mapper resolves field aliases via WK on the populated
  // response. Body MUST be `null | object`; primitives are rejected.
  if (body !== null && typeof body !== 'object') return false;
  if (ep.method !== 'GET' && ep.method !== 'POST') return false;
  const responseBody = (body ?? {}) as ApiRecord;
  const records = huntTransactions(responseBody);
  const fieldMap = resolveFieldMapOrEmpty(records);
  const method: 'GET' | 'POST' = ep.method;
  const endpoint: ITxnEndpoint = {
    url: ep.url,
    method,
    templatePostData: resolveTemplatePostData(method, ep.postData),
    fieldMap,
    pendingUrl: resolvePendingUrl(network),
    billingUrl: resolveBillingUrl(network),
  };
  return {
    endpoint,
    captureIndex: ep.captureIndex ?? 0,
    responseBodySample: responseBody,
    normalizedRecords: extractTransactions(responseBody),
    pickerTier: ep.pickerTier ?? 'shapePassing',
    capturedPreClick: ep.capturedPreClick ?? false,
  };
}

// Phase 7e checkpoint: `parseFreshResponse` and `buildPerAccountBody`
// stubs were removed pending the SCRAPE migration that consumes them
// (Phase 7e.5+). When SCRAPE.ACTION starts walking fresh per-account
// responses via `ctx.txnEndpoint.fieldMap`, the helpers re-land here
// alongside the per-WK ownership-test changes.

export type {
  ITxnEndpoint as TxnEndpoint,
  ITxnFieldMap as TxnFieldMap,
} from '../../Types/PipelineContext.js';
export {
  extractAccountIds,
  extractAccountRecords,
  extractAllContainers,
  isUsableIdentifier,
} from './AccountExtractor/AccountExtractor.js';
export { findAllFieldValues, findFieldValue, matchField } from './BfsFieldSearch/BfsFieldSearch.js';
export { parseAutoDate } from './Coercion/Coercion.js';
export {
  extractTransactions,
  extractTransactionsForCard,
} from './ContainerPicker/ContainerPicker.js';
export { default as findFirstArray } from './FieldHunt/LifoCrawl.js';
export { autoMapTransaction } from './TxnMapper/TxnMapper.js';
export { resolveTxnEndpoint };
