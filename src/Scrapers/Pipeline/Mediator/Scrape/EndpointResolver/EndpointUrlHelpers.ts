/**
 * URL/body helpers for the EndpointResolver — owns the pending-URL,
 * billing-URL, POST-template, and per-card body-id checks. Pulled out
 * so the EndpointResolver orchestrator stays under the file LoC cap.
 */

import {
  PIPELINE_WELL_KNOWN_ACCOUNT_FIELDS as WK_ACCT,
  PIPELINE_WELL_KNOWN_API as WK_API,
  PIPELINE_WELL_KNOWN_BILLING as WK_BILLING,
} from '../../../Registry/WK/ScrapeWK.js';
import type { IDiscoveredEndpoint, INetworkDiscovery } from '../../Network/NetworkDiscovery.js';

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
 * Resolve the POST template for `ITxnEndpoint.templatePostData`.
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
 * Test whether one capture qualifies as a shaped billing endpoint.
 * Pulled out so {@link findShapedBillingEndpoint} stays under the LoC budget.
 * @param ep - Capture to test.
 * @param txnPatterns - WK_API transaction URL patterns.
 * @returns True iff URL matches AND body carries a card-id alias.
 */
function isShapedBillingCapture(ep: IDiscoveredEndpoint, txnPatterns: readonly RegExp[]): boolean {
  const isUrlMatch = txnPatterns.some((p): boolean => p.test(ep.url));
  if (!isUrlMatch) return false;
  return billingBodyCarriesCardId(ep.postData);
}

/**
 * Locate a captured txn endpoint whose POST body carries a card-id
 * alias — proves the request is per-card and therefore eligible for
 * billing-fallback URL synthesis.
 *
 * @param captured - Captured endpoints to scan.
 * @returns First per-card txn capture, or `false`.
 */
function findShapedBillingEndpoint(
  captured: readonly IDiscoveredEndpoint[],
): IDiscoveredEndpoint | false {
  const txnPatterns = WK_API.transactions;
  const shaped = captured.find((ep): boolean => isShapedBillingCapture(ep, txnPatterns));
  return shaped ?? false;
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
  const shaped = findShapedBillingEndpoint(captured);
  if (shaped !== false) return buildBillingUrlFromOrigin(shaped.url);
  return false;
}

export { resolveBillingUrl, resolvePendingUrl, resolveTemplatePostData };
