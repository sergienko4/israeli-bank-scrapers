/**
 * Phase 7e bridge — adapts the contract type `ITxnEndpoint` (committed by
 * DASHBOARD.FINAL into `ctx.txnEndpoint`) into the runtime
 * `IDiscoveredEndpoint` shape that the SCRAPE-side strategies still consume.
 *
 * <p>SCRAPE never re-discovers anything. The bridge reads exactly one
 * source — `ctx.txnEndpoint` — committed by DASHBOARD.FINAL. There is
 * no fallback to `network.discoverTransactionsEndpoint()`: when DASHBOARD
 * cannot commit, the pipeline halts at F-DASH-1 / F-DASH-2 and SCRAPE
 * never starts. The architecture test forbids any SCRAPE-zone call to
 * `discoverTransactionsEndpoint` so the boundary cannot drift.
 */

import type { Option } from '../../Types/Option.js';
import type { ITxnEndpoint } from '../../Types/PipelineContext.js';
import type { IDiscoveredEndpoint } from '../Network/NetworkDiscoveryTypes.js';

/**
 * Minimal context surface — both IPipelineContext and IActionContext satisfy
 * it. The optional `?` admits test mocks built via `as unknown as IActionContext`
 * that historically didn't carry the field.
 */
interface ITxnEndpointBearingCtx {
  readonly txnEndpoint?: Option<ITxnEndpoint>;
}

/**
 * Resolve a `templatePostData` value into the runtime `postData` string.
 * Returns the empty string for the `false` sentinel ("no POST template")
 * and the raw template otherwise. The narrowing branch is necessary
 * because `string | false` cannot satisfy `string` directly.
 * @param template - Raw template POST data or false.
 * @returns POST data string ('' when template is false).
 */
function resolvePostData(template: string | false): string {
  if (template === false) return '';
  return template;
}

/**
 * Map an `ITxnEndpoint` (DASHBOARD-resolved contract) onto the legacy
 * `IDiscoveredEndpoint` runtime shape consumed by SCRAPE strategies.
 * Field-name translations: `templatePostData` → `postData`,
 * `responseBodySample` → `responseBody`. Headers / contentType / timestamp
 * default to inert values — strategies do not read them.
 * @param ep - Endpoint committed by DASHBOARD.FINAL.
 * @returns Equivalent runtime endpoint for SCRAPE-side consumers.
 */
function adaptTxnEndpointToDiscovered(ep: ITxnEndpoint): IDiscoveredEndpoint {
  return {
    url: ep.url,
    method: ep.method,
    postData: resolvePostData(ep.templatePostData),
    responseBody: ep.responseBodySample,
    contentType: 'application/json',
    requestHeaders: {},
    responseHeaders: {},
    timestamp: 0,
    captureIndex: ep.captureIndex,
  };
}

/**
 * Read `ctx.txnEndpoint` and return the runtime-shaped endpoint. Returns
 * `false` ONLY in test paths where the mock context did not commit one;
 * in production every successful run has a committed endpoint because
 * DASHBOARD.FINAL halts the pipeline (F-DASH-1 / F-DASH-2) before SCRAPE
 * starts otherwise. There is no fallback to network re-discovery — the
 * bridge is a pure read of the contract.
 *
 * @param ctx - Pipeline context.
 * @returns Adapted endpoint or `false` when ctx carries no committed value.
 */
function readTxnEndpoint(ctx: ITxnEndpointBearingCtx): IDiscoveredEndpoint | false {
  const opt = ctx.txnEndpoint;
  if (opt?.has) return adaptTxnEndpointToDiscovered(opt.value);
  return false;
}

/**
 * Read `ctx.txnEndpoint.pendingUrl` (pre-resolved by DASHBOARD.FINAL).
 * Returns `false` when no endpoint is committed.
 * @param ctx - Pipeline context.
 * @returns Pre-resolved pending URL or `false`.
 */
function readPendingUrl(ctx: ITxnEndpointBearingCtx): string | false {
  const opt = ctx.txnEndpoint;
  if (opt?.has) return opt.value.pendingUrl;
  return false;
}

/**
 * Read `ctx.txnEndpoint.billingUrl` (pre-resolved by DASHBOARD.FINAL).
 * Returns `false` when no endpoint is committed.
 * @param ctx - Pipeline context.
 * @returns Pre-resolved billing URL or `false`.
 */
function readBillingUrl(ctx: ITxnEndpointBearingCtx): string | false {
  const opt = ctx.txnEndpoint;
  if (opt?.has) return opt.value.billingUrl;
  return false;
}

export { adaptTxnEndpointToDiscovered, readBillingUrl, readPendingUrl, readTxnEndpoint };
