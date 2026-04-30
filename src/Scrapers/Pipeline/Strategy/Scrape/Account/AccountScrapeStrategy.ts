/**
 * POST/GET scrape strategies — buffer gate, matrix loop, billing, range, direct.
 * Extracted from ScrapeAccountHelpers.ts to respect max-lines.
 */

import type { ITransactionsAccount } from '../../../../../Transactions.js';
import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { IDiscoveredEndpoint } from '../../../Mediator/Network/NetworkDiscovery.js';
import { extractTransactions, isRangeIterable } from '../../../Mediator/Scrape/ScrapeAutoMapper.js';
import type { JsonRecord } from '../../../Mediator/Scrape/ScrapeReplayAction.js';
import { applyDateRangeToUrlWithCount } from '../../../Mediator/Scrape/UrlDateRange.js';
import { getDebug as createLogger } from '../../../Types/Debug.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, isOk } from '../../../Types/Procedure.js';
import { tryBillingFallback } from '../BillingFallbackStrategy.js';
import { tryMatrixLoop } from '../MatrixLoopStrategy.js';
import {
  buildAccountResult,
  parseStartDate,
  resolveTxnUrl,
  scrapeWithMonthlyChunking,
  templatePostBody,
} from '../ScrapeDataActions.js';
import type {
  ApiPayload,
  IAccountAssemblyCtx,
  IAccountFetchCtx,
  IChunkingCtx,
  IPostFetchCtx,
} from '../ScrapeTypes.js';
import { isFilterDataUrl, scrapeViaFilterData } from './FilterDataStrategy.js';
import { extractCardId, extractIds } from './ScrapeIdExtraction.js';

const LOG = createLogger('scrape-post');
const CARD_SOURCE_LABELS: Record<string, string> = { true: 'from cards[]', false: 'from record' };

/** Endpoint URL string. */
type EndpointUrlStr = string;

/**
 * Patch URL query-string date params from fc.startDate → today.
 * No-op when no WK.fromDate / WK.toDate keys are present.
 * @param url - Captured URL.
 * @param fc - Fetch context.
 * @returns Patched URL.
 */
function patchUrlRange(url: EndpointUrlStr, fc: IAccountFetchCtx): EndpointUrlStr {
  const fromDate = parseStartDate(fc.startDate);
  const toDate = new Date();
  const outcome = applyDateRangeToUrlWithCount(url, fromDate, toDate);
  if (outcome.swapped > 0) {
    LOG.debug({ message: `URL date-range patched (${String(outcome.swapped)} params)` });
  }
  return outcome.url;
}

/**
 * POST with date range: chunks then billing fallback.
 * @param fc - Fetch context.
 * @param postCtx - POST fetch params.
 * @returns Account with transactions.
 */
async function scrapePostWithRange(
  fc: IAccountFetchCtx,
  postCtx: IPostFetchCtx,
): Promise<Procedure<ITransactionsAccount>> {
  const ctx: IChunkingCtx = { fc, ...postCtx };
  const rangeResult = await scrapeWithMonthlyChunking(ctx);
  const hasResults = isOk(rangeResult) && rangeResult.value.txns.length > 0;
  if (hasResults) return rangeResult;
  LOG.debug({
    message: 'range=0 txns, trying billing fallback',
  });
  return tryBillingFallback(fc, postCtx);
}

/**
 * POST without date range: direct single request.
 * @param fc - Fetch context.
 * @param postCtx - POST fetch params.
 * @param rawRecord - Captured account record, passed through to balance resolution.
 * @returns Account with transactions.
 */
async function scrapePostDirect(
  fc: IAccountFetchCtx,
  postCtx: IPostFetchCtx,
  rawRecord?: Record<string, unknown>,
): Promise<Procedure<ITransactionsAccount>> {
  const patchedUrl = patchUrlRange(postCtx.url, fc);
  const raw = await fc.api.fetchPost<Record<string, unknown>>(
    patchedUrl,
    postCtx.baseBody as Record<string, string | object>,
  );
  if (!isOk(raw)) return raw;
  const txns = extractTransactions(raw.value);
  const assembly: IAccountAssemblyCtx = {
    fc,
    accountId: postCtx.accountId,
    displayId: postCtx.displayId,
    rawRecord: rawRecord ?? raw.value,
  };
  return buildAccountResult(assembly, txns);
}

/**
 * Build POST fetch context from account record and endpoint.
 * @param accountRecord - Account record from init.
 * @param endpoint - Discovered POST endpoint.
 * @returns POST context and captured body.
 */
function buildPostCtx(
  accountRecord: Record<string, unknown>,
  endpoint: IDiscoveredEndpoint,
): { readonly post: IPostFetchCtx; readonly capturedBody: ApiPayload } {
  const { displayId, accountId } = extractIds(accountRecord);
  const cardId = extractCardId(accountRecord) || accountId;
  const rawPost = endpoint.postData || '{}';
  const capturedBody = JSON.parse(rawPost) as ApiPayload;
  const baseBody = templatePostBody(rawPost, accountRecord as JsonRecord);
  LOG.debug({
    message:
      `buildPostCtx: cardUniqueId=${cardId} ` +
      `source=${CARD_SOURCE_LABELS[String(cardId !== accountId)]}`,
  });
  const post: IPostFetchCtx = {
    baseBody,
    url: endpoint.url,
    displayId: displayId || cardId,
    accountId: cardId,
  };
  return { post, capturedBody };
}

interface IBufferedAttemptCtx {
  readonly endpoint: IDiscoveredEndpoint;
  readonly postCtx: IPostFetchCtx;
  readonly rawRecord?: Record<string, unknown>;
}

/**
 * Try buffered response from NetworkStore — zero network cost.
 * @param fc - Fetch context.
 * @param attempt - Endpoint + POST params + optional captured record.
 * @returns Account Procedure, or false if no usable buffer.
 */
async function tryBufferedResponse(
  fc: IAccountFetchCtx,
  attempt: IBufferedAttemptCtx,
): Promise<Procedure<ITransactionsAccount> | false> {
  const { endpoint, postCtx, rawRecord } = attempt;
  if (!endpoint.responseBody) return false;
  LOG.debug({
    message: 'Using buffered response (0ms network cost)',
  });
  const body = endpoint.responseBody as Record<string, unknown>;
  const txns = extractTransactions(body);
  if (txns.length === 0) return false;
  const effectiveId = postCtx.accountId || postCtx.displayId || 'default';
  const display = postCtx.displayId || effectiveId;
  const assembly: IAccountAssemblyCtx = {
    fc,
    accountId: effectiveId,
    displayId: display,
    rawRecord: rawRecord ?? body,
  };
  return buildAccountResult(assembly, txns);
}

/**
 * POST strategy: buffer → matrix → billing → range → direct.
 * @param fc - Fetch context.
 * @param accountRecord - Account record from init.
 * @param endpoint - Discovered POST endpoint.
 * @returns Account with transactions.
 */
async function scrapeOneAccountPost(
  fc: IAccountFetchCtx,
  accountRecord: Record<string, unknown>,
  endpoint: IDiscoveredEndpoint,
): Promise<Procedure<ITransactionsAccount>> {
  const { post, capturedBody } = buildPostCtx(accountRecord, endpoint);
  const buffered = await tryBufferedResponse(fc, {
    endpoint,
    postCtx: post,
    rawRecord: accountRecord,
  });
  if (buffered !== false) return buffered;
  const matrix = await tryMatrixLoop({ fc, accountId: post.accountId, displayId: post.displayId });
  if (matrix !== false) return matrix;
  const billing = await tryBillingFallback(fc, post);
  if (isOk(billing) && billing.value.txns.length > 0) return billing;
  if (isRangeIterable(capturedBody as JsonRecord)) return scrapePostWithRange(fc, post);
  return scrapePostDirect(fc, post, accountRecord);
}

/**
 * GET strategy: resolve URL template and fetch.
 * If URL contains TransactionsAndGraphs → monthly iteration with filterData.
 * Otherwise → single GET.
 * @param fc - Fetch context.
 * @param accountId - Account ID.
 * @returns Account with transactions.
 */
async function scrapeOneAccountViaUrl(
  fc: IAccountFetchCtx,
  accountId: string,
): Promise<Procedure<ITransactionsAccount>> {
  const rawEndpoint = fc.network.discoverTransactionsEndpoint();
  const emptyUrl = String(false);
  const rawUrl = (rawEndpoint as IDiscoveredEndpoint | undefined)?.url ?? emptyUrl;
  if (rawEndpoint && isFilterDataUrl(rawUrl)) {
    return scrapeViaFilterData(fc, accountId, rawEndpoint.url);
  }
  const urlCtx = { api: fc.api, network: fc.network, accountId, startDate: fc.startDate };
  const scrapeUrl = resolveTxnUrl(urlCtx);
  if (!scrapeUrl) return fail(ScraperErrorTypes.Generic, 'No txn URL');
  const patchedUrl = patchUrlRange(scrapeUrl, fc);
  const raw = await fc.api.fetchGet<Record<string, unknown>>(patchedUrl);
  if (!isOk(raw)) return raw;
  const txns = extractTransactions(raw.value);
  return buildAccountResult({ fc, accountId, displayId: accountId, rawRecord: raw.value }, txns);
}

export { scrapeOneAccountPost, scrapeOneAccountViaUrl, tryBufferedResponse };
