/**
 * POST/GET scrape strategies — buffer gate, matrix loop, billing, range, direct.
 * Extracted from ScrapeAccountHelpers.ts to respect max-lines.
 */

import type { ITransactionsAccount } from '../../../../../Transactions.js';
import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { IDiscoveredEndpoint } from '../../../Mediator/Network/NetworkDiscovery.js';
import {
  extractTransactions,
  findFieldValue,
  isMonthlyEndpoint,
  isRangeIterable,
} from '../../../Mediator/Scrape/ScrapeAutoMapper.js';
import type { JsonRecord } from '../../../Mediator/Scrape/ScrapeReplayAction.js';
import { applyDateRangeToUrlWithCount } from '../../../Mediator/Scrape/UrlDateRange.js';
import {
  PIPELINE_WELL_KNOWN_MONTHLY_FIELDS as MF,
  PIPELINE_WELL_KNOWN_TXN_FIELDS as WK,
} from '../../../Registry/WK/ScrapeWK.js';
import type { Brand } from '../../../Types/Brand.js';
import { getDebug as createLogger } from '../../../Types/Debug.js';
import { redactAccount } from '../../../Types/PiiRedactor.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, isOk } from '../../../Types/Procedure.js';

type PatchedUrlStr = Brand<string, 'PatchedUrlStr'>;
type IsBufferReusable = Brand<boolean, 'IsBufferReusable'>;
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

/**
 * Patch URL query-string date params from fc.startDate → today.
 * No-op when no WK.fromDate / WK.toDate keys are present.
 * @param url - Captured URL.
 * @param fc - Fetch context.
 * @returns Patched URL.
 */
function patchUrlRange(url: string, fc: IAccountFetchCtx): PatchedUrlStr {
  const fromDate = parseStartDate(fc.startDate);
  const toDate = new Date();
  const outcome = applyDateRangeToUrlWithCount(url, fromDate, toDate);
  if (outcome.swapped > 0) {
    LOG.debug({ message: `URL date-range patched (${String(outcome.swapped)} params)` });
  }
  return outcome.url as PatchedUrlStr;
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
  const baseBody = templatePostBody(rawPost, accountRecord, cardId);
  const isLookupCard = cardId !== accountId;
  const cardLabel = redactAccount(cardId);
  LOG.debug({
    message:
      `buildPostCtx: cardUniqueId=${cardLabel} ` +
      `source=${CARD_SOURCE_LABELS[String(isLookupCard)]}`,
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

/** WK field names that identify a per-card / per-account body parameter. */
const ACCOUNT_BODY_KEYS: readonly string[] = [...WK.accountId, ...MF.accountId];

/** Plural-array WK keys identifying multi-card request scopes. */
const BUFFER_PLURAL_CARDS_KEYS: readonly string[] = ['cards', 'accounts', 'bankAccounts'];

/**
 * Returns true when the parsed POST body carries a non-empty plural
 * cards/accounts array. The buffer captured under such a request is
 * multi-card scope — `findFieldValue` cannot descend into arrays
 * (`enqueueChildren` excludes them), so without this explicit check
 * `bufferedMatchesAccount` mistakes "no singular id" for "safe to
 * reuse for any iteration", mirroring the captured combined response
 * onto every card.
 *
 * @param parsed - Parsed POST body.
 * @returns true when at least one WK plural cards array is present.
 */
function postDataIsMultiCardScope(parsed: Record<string, unknown>): boolean {
  return BUFFER_PLURAL_CARDS_KEYS.some((key): boolean => {
    const value = parsed[key];
    return Array.isArray(value) && value.length > 1;
  });
}

/**
 * Returns true when the captured POST body identifies `accountId`, or
 * when the body carries no account identifier at all (single-account
 * banks share one buffer across the run).
 *
 * <p>Refuses reuse when the body carries a plural cards array
 * (`cards: [...]`), because the captured response under such a
 * request reflects multiple cards combined and cannot be safely
 * attributed to one iteration's accountId. The fall-through path
 * (scrapePostDirect) re-posts a per-card-templated body and gets
 * per-card data naturally.
 *
 * @param endpoint - captured endpoint with optional postData.
 * @param accountId - iterating account identifier.
 * @returns true when the buffer is safe to reuse for this account.
 */
function bufferedMatchesAccount(
  endpoint: IDiscoveredEndpoint,
  accountId: string,
): IsBufferReusable {
  if (!endpoint.postData) return true as IsBufferReusable;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(endpoint.postData) as Record<string, unknown>;
  } catch {
    return true as IsBufferReusable;
  }
  if (postDataIsMultiCardScope(parsed)) return false as IsBufferReusable;
  const id = findFieldValue(parsed, ACCOUNT_BODY_KEYS);
  if (id === false) return true as IsBufferReusable;
  return (String(id) === accountId) as IsBufferReusable;
}

/**
 * Resolves the captured response into an account when reuse is safe,
 * else returns false so the caller can fall through to MatrixLoop or
 * the billing / direct strategies.
 * @param fc - fetch context.
 * @param attempt - endpoint + POST params + optional captured record.
 * @returns account Procedure, or false when the buffer is unsuitable.
 */
async function tryBufferedResponse(
  fc: IAccountFetchCtx,
  attempt: IBufferedAttemptCtx,
): Promise<Procedure<ITransactionsAccount> | false> {
  const { endpoint, postCtx, rawRecord } = attempt;
  if (!endpoint.responseBody) return false;
  // Monthly endpoints: MatrixLoop iterates all chunks and strictly
  // subsumes the buffer (one captured (card,month) row).
  if (isMonthlyEndpoint(endpoint.postData)) return false;
  // Multi-card families (Amex/Isracard) capture only the leading card's
  // POST during dashboard load — reusing it for siblings mirrors the
  // same txns across every card.
  if (!bufferedMatchesAccount(endpoint, postCtx.accountId)) return false;
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
  const matrix = await tryMatrixLoop({
    fc,
    accountId: post.accountId,
    displayId: post.displayId,
    accountRecord,
  });
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
