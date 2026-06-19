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

import type {
  ITxnEndpoint,
  ITxnEndpointInternal,
  ITxnFieldMap,
} from '../../../Types/PipelineContext.js';
import type { IDiscoveredEndpoint, INetworkDiscovery } from '../../Network/NetworkDiscovery.js';
import type { ApiRecord } from '../AutoMapperFacade/AutoMapperTypes.js';
import { extractTransactions } from '../ContainerPicker/ContainerPicker.js';
import huntTransactions from '../FieldHunt/TxnHunt.js';
import resolveFieldMapOrEmpty from './EndpointFieldMap.js';
import {
  resolveBillingUrl,
  resolvePendingUrl,
  resolveTemplatePostData,
} from './EndpointUrlHelpers.js';

/**
 * Resolved request-shape bits the orchestrator commits into the
 * outgoing {@link ITxnEndpoint}. Bundled so {@link buildTxnEndpoint}
 * stays under the parameter cap.
 */
interface IResolvedRequestParts {
  method: 'GET' | 'POST';
  fieldMap: ITxnFieldMap;
}

/** Bundled args for {@link buildEndpointUrlTriple} — keeps params ≤ 3. */
interface IUrlTripleArgs {
  readonly network: INetworkDiscovery;
  readonly ep: IDiscoveredEndpoint;
  readonly method: 'GET' | 'POST';
}

/** Subset of {@link ITxnEndpoint} produced by {@link buildEndpointUrlTriple}. */
type UrlTriple = Pick<ITxnEndpoint, 'templatePostData' | 'pendingUrl' | 'billingUrl'>;

/**
 * Build the URL trio (templatePostData, pendingUrl, billingUrl)
 * for an outgoing {@link ITxnEndpoint}. Pulled out so
 * {@link buildTxnEndpoint} stays under the per-function LoC budget.
 * @param args - Bundled network + capture + method.
 * @returns templatePostData + pendingUrl + billingUrl fragment.
 */
function buildEndpointUrlTriple(args: IUrlTripleArgs): UrlTriple {
  return {
    templatePostData: resolveTemplatePostData(args.method, args.ep.postData),
    pendingUrl: resolvePendingUrl(args.network),
    billingUrl: resolveBillingUrl(args.network),
  };
}

/**
 * Build the slim {@link ITxnEndpoint} that DASHBOARD commits to
 * `ctx.txnEndpoint`. Pulls templatePostData / pendingUrl /
 * billingUrl via their respective helpers so the orchestrator
 * stays small.
 * @param network - Network surface exposing the pool of captures.
 * @param ep - Raw endpoint capture lifted from {@link INetworkDiscovery}.
 * @param parts - Resolved request shape (method + fieldMap).
 * @returns Slim endpoint payload for `ctx.txnEndpoint`.
 */
function buildTxnEndpoint(
  network: INetworkDiscovery,
  ep: IDiscoveredEndpoint,
  parts: IResolvedRequestParts,
): ITxnEndpoint {
  const urls = buildEndpointUrlTriple({ network, ep, method: parts.method });
  return { url: ep.url, method: parts.method, fieldMap: parts.fieldMap, ...urls };
}

/**
 * Build the picker-diagnostics trio surfaced by {@link buildInternalResult}.
 * Pulled out so the wrapper stays under the per-function LoC budget.
 * @param ep - Raw endpoint capture lifted from {@link INetworkDiscovery}.
 * @returns captureIndex + pickerTier + capturedPreClick triple.
 */
function buildPickerDiagnostics(
  ep: IDiscoveredEndpoint,
): Pick<ITxnEndpointInternal, 'captureIndex' | 'pickerTier' | 'capturedPreClick'> {
  return {
    captureIndex: ep.captureIndex ?? 0,
    pickerTier: ep.pickerTier ?? 'shapePassing',
    capturedPreClick: ep.capturedPreClick ?? false,
  };
}

/**
 * Wrap a built {@link ITxnEndpoint} into the wider
 * {@link ITxnEndpointInternal} payload DASHBOARD.FINAL emits as
 * telemetry alongside picker diagnostics.
 * @param ep - Raw endpoint capture (used for tier + capture index).
 * @param endpoint - Slim endpoint payload from {@link buildTxnEndpoint}.
 * @param responseBody - Sampled response body for the telemetry pane.
 * @returns Internal wrapper with picker diagnostics.
 */
function buildInternalResult(
  ep: IDiscoveredEndpoint,
  endpoint: ITxnEndpoint,
  responseBody: ApiRecord,
): ITxnEndpointInternal {
  const normalizedRecords = extractTransactions(responseBody);
  const responseBodySample = responseBody;
  return { endpoint, responseBodySample, normalizedRecords, ...buildPickerDiagnostics(ep) };
}

/**
 * Pre-flight guard for {@link resolveTxnEndpoint} — rejects captures
 * whose body is non-object/non-null or whose HTTP method falls outside
 * the supported `GET` / `POST` pair. Pulled out so the orchestrator
 * body stays within the per-function LoC budget.
 *
 * @param ep - Capture returned by `discoverTransactionsEndpoint`.
 * @returns True iff the capture is shaped enough to commit.
 */
function isCommittableCapture(ep: IDiscoveredEndpoint): boolean {
  const body = ep.responseBody;
  if (body !== null && typeof body !== 'object') return false;
  return ep.method === 'GET' || ep.method === 'POST';
}

/** Compose result of {@link buildCommitArtifacts} — pre-built endpoint
 *  plus the parsed body sample used by {@link buildInternalResult}. */
interface ICommitArtifacts {
  readonly endpoint: ITxnEndpoint;
  readonly responseBody: ApiRecord;
}

/** Compose result of {@link resolveRequestParts} — resolved request
 *  parts (method + fieldMap) plus the parsed body sample. */
interface IRequestPartsResult {
  readonly parts: IResolvedRequestParts;
  readonly responseBody: ApiRecord;
}

/**
 * Resolve method + fieldMap from a shape-passing capture body.
 * Pulled out so {@link buildCommitArtifacts} stays under the LoC budget.
 * @param ep - Capture returned by `discoverTransactionsEndpoint`.
 * @param balanceAliases - Family-scoped balance aliases (optional;
 *   the leaf resolver defaults to the full WK list when omitted).
 * @returns Resolved request parts (method + fieldMap) + parsed body.
 */
function resolveRequestParts(
  ep: IDiscoveredEndpoint,
  balanceAliases?: readonly string[],
): IRequestPartsResult {
  const method = ep.method as 'GET' | 'POST';
  const responseBody = (ep.responseBody ?? {}) as ApiRecord;
  const huntedRecords = huntTransactions(responseBody);
  const fieldMap = resolveFieldMapOrEmpty(huntedRecords, balanceAliases);
  return { parts: { method, fieldMap }, responseBody };
}

/**
 * Build the committable endpoint + parsed body sample from a
 * shape-passing capture. Pulled out so {@link resolveTxnEndpoint}
 * stays a thin guard + delegate.
 *
 * @param network - Network surface exposing the captured pool.
 * @param ep - Capture returned by `discoverTransactionsEndpoint`.
 * @param balanceAliases - Family-scoped balance aliases (optional).
 * @returns Slim endpoint + parsed responseBody bundle.
 */
function buildCommitArtifacts(
  network: INetworkDiscovery,
  ep: IDiscoveredEndpoint,
  balanceAliases?: readonly string[],
): ICommitArtifacts {
  const { parts, responseBody } = resolveRequestParts(ep, balanceAliases);
  const endpoint = buildTxnEndpoint(network, ep, parts);
  return { endpoint, responseBody };
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
 * @param balanceAliases - Family-scoped balance aliases (optional;
 *   DASHBOARD.FINAL passes the bank's kind-scoped list).
 * @returns Resolved internal payload or `false`.
 */
function resolveTxnEndpoint(
  network: INetworkDiscovery,
  balanceAliases?: readonly string[],
): ITxnEndpointInternal | false {
  const ep = network.discoverTransactionsEndpoint();
  if (ep === false) return false;
  if (!isCommittableCapture(ep)) return false;
  const { endpoint, responseBody } = buildCommitArtifacts(network, ep, balanceAliases);
  return buildInternalResult(ep, endpoint, responseBody);
}

export default resolveTxnEndpoint;
