/**
 * Endpoint resolver — turns the raw `INetworkDiscovery` capture pool
 * into the slim `ITxnEndpointInternal` payload DASHBOARD.FINAL
 * commits to `ctx.txnEndpoint`. Owns the per-bank field-map
 * resolution (date / amount / description / currency / identifier
 * + optional `originalAmount` / `processedDate` / `balance`), the
 * pending-URL fallback derived from `WK_API.pending`, and the
 * billing-URL fallback derived from `WK_BILLING.pathFragment`.
 *
 * SCRAPE never imports any WK directly — it consumes
 * `ctx.txnEndpoint` instead. That makes this module the sole
 * place WK_API + WK_BILLING + WK_TXN aliases turn into concrete
 * URLs and field-name strings.
 *
 * Extracted from ScrapeAutoMapper as part of the Phase 5
 * pipeline-decoupling split (master plan
 * pipeline-decoupling-master-2026-05-28 / phase-5).
 */

import {
  PIPELINE_WELL_KNOWN_ACCOUNT_FIELDS as WK_ACCT,
  PIPELINE_WELL_KNOWN_API as WK_API,
  PIPELINE_WELL_KNOWN_BILLING as WK_BILLING,
  PIPELINE_WELL_KNOWN_TXN_FIELDS as WK,
} from '../../../Registry/WK/ScrapeWK.js';
import type {
  ITxnEndpoint,
  ITxnEndpointInternal,
  ITxnFieldMap,
} from '../../../Types/PipelineContext.js';
import type { INetworkDiscovery } from '../../Network/NetworkDiscovery.js';
import type { ApiRecord } from '../AutoMapperFacade/AutoMapperTypes.js';
import { extractTransactions } from '../ContainerPicker/ContainerPicker.js';
import huntTransactions from '../FieldHunt/TxnHunt.js';

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
 * Pick the amount field alias from a sample record. Falls back
 * to credit / debit aliases when WK.amount is absent so the
 * Beinleumi split-pair shape still passes the field-map check.
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
 * Resolve the POST template for
 * {@link ITxnEndpoint.templatePostData}.
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
 * Resolve the pending-transactions API URL from captured traffic,
 * or fall back to constructing it under the discovered API origin
 * using the canonical
 * `Transactions/api/approvals/getClearanceRequests` path.
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
 * {@link WK_ACCT.queryId} alias — i.e. the request is scoped
 * per-card.
 * @param postData - Captured POST body string.
 * @returns True when at least one alias appears.
 */
function billingBodyCarriesCardId(postData: string): boolean {
  if (!postData) return false;
  return WK_ACCT.queryId.some((alias): boolean => postData.includes(alias));
}

/**
 * Build the canonical billing URL under a discovered API origin
 * using `WK_BILLING` path fragments. No hostname is hardcoded.
 * @param anyCapturedUrl - URL already captured on the target host.
 * @returns Built billing URL string.
 */
function buildBillingUrlFromOrigin(anyCapturedUrl: string): string {
  const origin = new URL(anyCapturedUrl).origin;
  const { apiPrefix, pathFragment, actionName } = WK_BILLING;
  return `${origin}${apiPrefix}/${pathFragment}/${actionName}`;
}

/**
 * Resolve the billing-fallback URL from captured traffic.
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

/**
 * Phase 7f — resolve the TXN endpoint from DASHBOARD's captures.
 * Returns the wider {@link ITxnEndpointInternal} so DASHBOARD.FINAL
 * can emit the `dashboard.txnEndpoint.committed` telemetry with the
 * picker's diagnostics; DASHBOARD then unwraps `.endpoint` and
 * commits ONLY the slim {@link ITxnEndpoint} to `ctx.txnEndpoint`.
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

export default resolveTxnEndpoint;
