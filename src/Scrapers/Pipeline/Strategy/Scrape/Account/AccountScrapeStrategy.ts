/**
 * POST/GET scrape strategies — matrix loop, billing fallback, range
 * chunking, direct fetch. Phase 7f: SCRAPE consumes the slim
 * `ITxnEndpoint` DASHBOARD.FINAL committed; the buffered-response
 * shortcut that depended on `IDiscoveredEndpoint.responseBody` is
 * removed (R-NET-SCRAPE: SCRAPE has zero IDiscoveredEndpoint surface).
 * One extra fetch per account is the perf cost of strict separation.
 */

import type { ITransaction, ITransactionsAccount } from '../../../../../Transactions.js';
import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import { parseFreshResponse } from '../../../Mediator/Dashboard/TxnParser.js';
import { isRangeIterable } from '../../../Mediator/Scrape/ScrapeAutoMapper.js';
import type { JsonRecord } from '../../../Mediator/Scrape/ScrapeReplayAction.js';
import { applyDateRangeToUrlWithCount } from '../../../Mediator/Scrape/UrlDateRange.js';
import type { Brand } from '../../../Types/Brand.js';
import { getDebug as createLogger } from '../../../Types/Debug.js';
import { redactAccount } from '../../../Types/PiiRedactor.js';
import type { IDashboardTxnHarvest, ITxnEndpoint } from '../../../Types/PipelineContext.js';
import { EMPTY_TXN_HARVEST } from '../../../Types/PipelineContext.js';
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
import {
  type ApiPayload,
  EMPTY_TXN_ENDPOINT,
  type IAccountAssemblyCtx,
  type IAccountFetchCtx,
  type IChunkingCtx,
  type IPostFetchCtx,
} from '../ScrapeTypes.js';
import { isFilterDataUrl, scrapeViaFilterData } from './FilterDataStrategy.js';
import { extractCardId, extractIds } from './ScrapeIdExtraction.js';

type PatchedUrlStr = Brand<string, 'PatchedUrlStr'>;

const LOG = createLogger('scrape-post');
const CARD_SOURCE_LABELS: Record<string, string> = { true: 'from cards[]', false: 'from record' };

/**
 * Resolve the slim ITxnEndpoint to its fieldMap for parseFreshResponse.
 * Returns the EMPTY default's fieldMap when DASHBOARD didn't commit one
 * — `parseFreshResponse` then falls back to auto-discovery.
 *
 * @param fc - Fetch context.
 * @returns FieldMap aliases for the per-account fresh-response parse.
 */
function txnEpForParse(fc: IAccountFetchCtx): ITxnEndpoint['fieldMap'] {
  return (fc.txnEndpoint ?? EMPTY_TXN_ENDPOINT).fieldMap;
}

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
  const fieldMap = txnEpForParse(fc);
  const txns = parseFreshResponse(raw.value, fieldMap);
  const assembly: IAccountAssemblyCtx = {
    fc,
    accountId: postCtx.accountId,
    displayId: postCtx.displayId,
    rawRecord: rawRecord ?? raw.value,
  };
  return buildAccountResult(assembly, txns);
}

/**
 * Build POST fetch context from account record + slim TXN endpoint.
 * Phase 7f: takes the typed `ITxnEndpoint`; reads `templatePostData`
 * (false for GET) and `url` directly. No `IDiscoveredEndpoint`.
 *
 * @param accountRecord - Account record from init.
 * @param txnEndpoint - Slim TXN endpoint committed by DASHBOARD.FINAL.
 * @returns POST context and captured-template body.
 */
function buildPostCtx(
  accountRecord: Record<string, unknown>,
  txnEndpoint: ITxnEndpoint,
): { readonly post: IPostFetchCtx; readonly capturedBody: ApiPayload } {
  const { displayId, accountId } = extractIds(accountRecord);
  const cardId = extractCardId(accountRecord) || accountId;
  const rawPost = ((): string => {
    if (txnEndpoint.templatePostData === false) return '{}';
    return txnEndpoint.templatePostData || '{}';
  })();
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
    url: txnEndpoint.url,
    displayId: displayId || cardId,
    accountId: cardId,
  };
  return { post, capturedBody };
}

/**
 * Returns true when `iterationAccountId` is compatible with the
 * accountId DASHBOARD captured. Banks expose two variants of the same
 * id — display form (`536347`) and the long bank/branch form
 * (`12-170-536347`). A bidirectional `endsWith` check normalizes
 * across both directions without bank-specific branches.
 *
 * @param capturedAccountId - AccountId DASHBOARD parsed from the URL.
 * @param iterationAccountId - AccountId SCRAPE iterates against.
 * @returns True when the two ids are compatible.
 */
function accountIdsCompatible(capturedAccountId: string, iterationAccountId: string): boolean {
  if (capturedAccountId === iterationAccountId) return true;
  if (capturedAccountId === '' || iterationAccountId === '') return false;
  return (
    capturedAccountId.endsWith(iterationAccountId) || iterationAccountId.endsWith(capturedAccountId)
  );
}

/**
 * Decide whether the DASHBOARD-side harvest is reusable for one
 * iteration's accountId. Returns true only when the harvest carries
 * records, is not multi-account scope, and the captured accountId
 * is compatible (or absent — single-account banks).
 *
 * @param harvest - DASHBOARD-side harvest snapshot.
 * @param iterationAccountId - AccountId currently iterating.
 * @returns True when harvest is reusable.
 */
function harvestApplies(harvest: IDashboardTxnHarvest, iterationAccountId: string): boolean {
  if (harvest.records.length === 0) return false;
  if (harvest.multiAccountScope) return false;
  if (harvest.capturedAccountId === false) return true;
  return accountIdsCompatible(harvest.capturedAccountId, iterationAccountId);
}

/**
 * Phase 7f follow-up: try the DASHBOARD-side harvest before issuing a
 * fresh per-account fetch. Recovers the per-account fast path that
 * pre-Phase-7f's `tryBufferedResponse` provided, but as a typed
 * value-pass instead of a network-surface back door — SCRAPE consumes
 * the pre-extracted `readonly ITransaction[]` DASHBOARD already saw.
 *
 * <p>Mirrors {@link tryMatrixLoop}'s contract: returns a Procedure on
 * success, `false` on miss so the caller can fall through to billing
 * / range / direct strategies.
 *
 * @param fc - Fetch context (carries the harvest from SCRAPE.PRE).
 * @param post - POST fetch params for the iteration's account.
 * @param accountRecord - Captured account record (passed to balance helpers).
 * @returns Procedure on hit, false on miss.
 */
async function tryFirstWave(
  fc: IAccountFetchCtx,
  post: IPostFetchCtx,
  accountRecord: Record<string, unknown>,
): Promise<Procedure<ITransactionsAccount> | false> {
  await Promise.resolve();
  const harvest = fc.dashboardTxnHarvest ?? EMPTY_TXN_HARVEST;
  if (!harvestApplies(harvest, post.accountId)) return false;
  const accountLabel = redactAccount(post.accountId);
  const recordCount = String(harvest.records.length);
  LOG.debug({
    message: `tryFirstWave hit: account=${accountLabel} records=${recordCount}`,
  });
  const txns: readonly ITransaction[] = harvest.records;
  const assembly: IAccountAssemblyCtx = {
    fc,
    accountId: post.accountId,
    displayId: post.displayId,
    rawRecord: accountRecord,
  };
  return buildAccountResult(assembly, txns);
}

/**
 * POST strategy: matrix → first-wave harvest → billing → range → direct.
 * Phase 7f: reads the slim `ITxnEndpoint` from `fc.txnEndpoint` and the
 * DASHBOARD-side harvest from `fc.dashboardTxnHarvest`. Matrix loops
 * (Amex/Isracard) run first because they iterate every card. When
 * matrix doesn't apply, the harvest fast path consumes DASHBOARD's
 * pre-extracted records before triggering a fresh per-account fetch
 * (which some banks 302 against rapid second-fetches with extended
 * windows — Hapoalim regression).
 *
 * @param fc - Fetch context (carries the slim TXN endpoint + harvest).
 * @param accountRecord - Account record from init.
 * @returns Account with transactions.
 */
async function scrapeOneAccountPost(
  fc: IAccountFetchCtx,
  accountRecord: Record<string, unknown>,
): Promise<Procedure<ITransactionsAccount>> {
  const txnEp = fc.txnEndpoint ?? EMPTY_TXN_ENDPOINT;
  const { post, capturedBody } = buildPostCtx(accountRecord, txnEp);
  const matrix = await tryMatrixLoop({
    fc,
    accountId: post.accountId,
    displayId: post.displayId,
    accountRecord,
  });
  if (matrix !== false) return matrix;
  const firstWave = await tryFirstWave(fc, post, accountRecord);
  if (firstWave !== false) return firstWave;
  const billing = await tryBillingFallback(fc, post);
  if (isOk(billing) && billing.value.txns.length > 0) return billing;
  if (isRangeIterable(capturedBody as JsonRecord)) return scrapePostWithRange(fc, post);
  return scrapePostDirect(fc, post, accountRecord);
}

/**
 * GET strategy: resolve URL template and fetch.
 * If URL contains TransactionsAndGraphs → monthly iteration with filterData.
 * Otherwise → single GET.
 * @param fc - Fetch context (carries the slim TXN endpoint).
 * @param accountId - Account ID.
 * @returns Account with transactions.
 */
async function scrapeOneAccountViaUrl(
  fc: IAccountFetchCtx,
  accountId: string,
): Promise<Procedure<ITransactionsAccount>> {
  // Phase 7f: read the slim ITxnEndpoint plumbed onto fc by SCRAPE.PRE.
  // SCRAPE never calls network.discoverTransactionsEndpoint() —
  // DASHBOARD owns discovery and the slim contract is the only source.
  const txnEp = fc.txnEndpoint ?? EMPTY_TXN_ENDPOINT;
  if (txnEp.url !== '' && isFilterDataUrl(txnEp.url)) {
    return scrapeViaFilterData(fc, accountId, txnEp.url);
  }
  const urlCtx = { api: fc.api, network: fc.network, accountId, startDate: fc.startDate };
  const scrapeUrl = resolveTxnUrl(urlCtx);
  if (!scrapeUrl) return fail(ScraperErrorTypes.Generic, 'No txn URL');
  const patchedUrl = patchUrlRange(scrapeUrl, fc);
  const raw = await fc.api.fetchGet<Record<string, unknown>>(patchedUrl);
  if (!isOk(raw)) return raw;
  const fieldMap = txnEpForParse(fc);
  const txns = parseFreshResponse(raw.value, fieldMap);
  return buildAccountResult({ fc, accountId, displayId: accountId, rawRecord: raw.value }, txns);
}

export { scrapeOneAccountPost, scrapeOneAccountViaUrl };
