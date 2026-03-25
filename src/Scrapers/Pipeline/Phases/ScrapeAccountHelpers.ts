/**
 * Account-level scrape helpers — POST/GET strategies,
 * billing fallback, account dispatch, and iteration.
 */

import { getDebug } from '../../../Common/Debug.js';
import type { ITransaction, ITransactionsAccount } from '../../../Transactions.js';
import { ScraperErrorTypes } from '../../Base/ErrorTypes.js';
import type { IMonthChunk } from '../Mediator/GenericScrapeStrategy.js';
import {
  extractTransactions,
  generateMonthChunks,
  isRangeIterable,
} from '../Mediator/GenericScrapeStrategy.js';
import type { IDiscoveredEndpoint } from '../Mediator/NetworkDiscovery.js';

/** Full billing API URL built from the accounts endpoint origin. */
type BillingApiUrl = string;
/** Month number as string (1–12). */
type MonthStr = string;
/** Account index in sequential iteration. */
type AccountIndex = number;
import type { Procedure } from '../Types/Procedure.js';
import { fail, isOk } from '../Types/Procedure.js';
import {
  buildAccountResult,
  deduplicateTxns,
  fetchWithMonthlyChunking,
  parseStartDate,
  rateLimitPause,
  resolveTxnUrl,
  templatePostBody,
} from './ScrapeFetchHelpers.js';
import { extractCardId, extractIds } from './ScrapeIdExtraction.js';
import type {
  ApiPayload,
  IAccountAssemblyCtx,
  IAccountFetchCtx,
  IAccountFetchOpts,
  IBillingChunkCtx,
  IChunkingCtx,
  IFetchAllAccountsCtx,
  IPostFetchCtx,
} from './ScrapeTypes.js';

const LOG = getDebug('scrape-account');

const RATE_LIMIT_MS = 300;

// ── Billing Helpers ──────────────────────────────────────

/**
 * Build billing URL from accounts endpoint origin.
 * @param accountsUrl - Discovered accounts endpoint URL.
 * @returns Full billing API URL.
 */
function buildBillingUrl(accountsUrl: BillingApiUrl): BillingApiUrl {
  const apiBase = new URL(accountsUrl).origin;
  const path = '/Transactions/api/transactionsDetails/' + 'getCardTransactionsDetails';
  return `${apiBase}${path}`;
}

/**
 * Extract month and year strings from a chunk start date.
 * @param chunk - Month chunk with start date.
 * @returns Month and year as strings.
 */
function chunkMonthYear(chunk: IMonthChunk): { readonly month: MonthStr; readonly year: MonthStr } {
  const d = new Date(chunk.start);
  const rawMonth = d.getMonth() + 1;
  const month = String(rawMonth);
  const rawYear = d.getFullYear();
  const year = String(rawYear);
  return { month, year };
}

/**
 * Fetch one billing chunk for a month.
 * @param ctx - Billing chunk context.
 * @param chunk - Month chunk.
 * @returns Extracted transactions.
 */
async function fetchOneBillingChunk(
  ctx: IBillingChunkCtx,
  chunk: IMonthChunk,
): Promise<readonly ITransaction[]> {
  const { month, year } = chunkMonthYear(chunk);
  const body = { cardUniqueId: ctx.accountId, month, year };
  LOG.debug('billing chunk: m=%s y=%s card=%s url=%s', month, year, ctx.accountId, ctx.billingUrl);
  const raw = await ctx.fc.api.fetchPost<Record<string, unknown>>(ctx.billingUrl, body);
  if (!isOk(raw)) return [];
  const txns = extractTransactions(raw.value);
  LOG.debug('billing chunk: m=%s y=%s → %d txns', month, year, txns.length);
  return txns;
}

/**
 * Process one billing chunk (loop body).
 * @param ctx - Billing context.
 * @param chunk - Month chunk.
 * @param out - Accumulator.
 * @returns True when done.
 */
async function processBillingChunk(
  ctx: IBillingChunkCtx,
  chunk: IMonthChunk,
  out: ITransaction[],
): Promise<true> {
  const txns = await fetchOneBillingChunk(ctx, chunk);
  out.push(...txns);
  return rateLimitPause(RATE_LIMIT_MS);
}

/**
 * Collect all billing chunks via sequential promise chain.
 * @param ctx - Billing context.
 * @param chunks - Month chunks.
 * @returns All transactions.
 */
async function collectBillingChunks(
  ctx: IBillingChunkCtx,
  chunks: readonly IMonthChunk[],
): Promise<readonly ITransaction[]> {
  const all: ITransaction[] = [];
  const seed = Promise.resolve(true as const);
  const chain = chunks.reduce(
    (prev, chunk): Promise<true> =>
      prev.then((): Promise<true> => processBillingChunk(ctx, chunk, all)),
    seed,
  );
  await chain;
  return all;
}

/** Bundled params for billing result assembly. */
interface IBillingResultCtx {
  readonly fc: IAccountFetchCtx;
  readonly post: IPostFetchCtx;
  readonly startDate: Date;
}

/**
 * Build billing fallback result with dedup.
 * @param ctx - Billing result context.
 * @param allTxns - Raw billing transactions.
 * @returns Account Procedure.
 */
async function buildBillingResult(
  ctx: IBillingResultCtx,
  allTxns: readonly ITransaction[],
): Promise<Procedure<ITransactionsAccount>> {
  const startMs = ctx.startDate.getTime();
  const unique = deduplicateTxns(allTxns, startMs);
  const assembly: IAccountAssemblyCtx = {
    fc: ctx.fc,
    accountId: ctx.post.accountId,
    displayId: ctx.post.displayId,
  };
  return buildAccountResult(assembly, unique);
}

/**
 * Build billing context and generate month chunks.
 * @param fc - Fetch context.
 * @param billingUrl - Billing API URL.
 * @param accountId - Card unique ID.
 * @returns Billing context and chunks.
 */
function prepareBilling(
  fc: IAccountFetchCtx,
  billingUrl: string,
  accountId: string,
): { readonly ctx: IBillingChunkCtx; readonly chunks: readonly IMonthChunk[] } {
  const startDate = parseStartDate(fc.startDate);
  const now = new Date();
  const chunks = generateMonthChunks(startDate, now);
  const ctx: IBillingChunkCtx = { fc, billingUrl, accountId };
  return { ctx, chunks };
}

/**
 * Try monthly billing fallback for a card.
 * @param fc - Fetch context.
 * @param post - POST params with accountId + displayId.
 * @param txnEndpoint - Optional discovered transaction endpoint for origin.
 * @returns Account with transactions, or failure.
 */
async function tryBillingFallback(
  fc: IAccountFetchCtx,
  post: IPostFetchCtx,
  txnEndpoint?: IDiscoveredEndpoint | false,
): Promise<Procedure<ITransactionsAccount>> {
  const originSource = txnEndpoint ?? fc.network.discoverAccountsEndpoint();
  if (!originSource) {
    return fail(ScraperErrorTypes.Generic, 'No endpoint for billing origin');
  }
  const billingUrl = buildBillingUrl(originSource.url);
  const billing = prepareBilling(fc, billingUrl, post.accountId);
  const allTxns = await collectBillingChunks(billing.ctx, billing.chunks);
  if (allTxns.length === 0) {
    return fail(ScraperErrorTypes.Generic, 'Billing: 0 txns');
  }
  const startDate = parseStartDate(fc.startDate);
  const resultCtx: IBillingResultCtx = { fc, post, startDate };
  return buildBillingResult(resultCtx, allTxns);
}

// ── POST Strategies ──────────────────────────────────────

/**
 * POST with date range: chunks then billing fallback.
 * @param fc - Fetch context.
 * @param post - POST fetch params.
 * @returns Account with transactions.
 */
async function fetchPostWithRange(
  fc: IAccountFetchCtx,
  post: IPostFetchCtx,
): Promise<Procedure<ITransactionsAccount>> {
  const ctx: IChunkingCtx = { fc, ...post };
  const rangeResult = await fetchWithMonthlyChunking(ctx);
  const hasResults = isOk(rangeResult) && rangeResult.value.txns.length > 0;
  if (hasResults) return rangeResult;
  LOG.debug('range=0 txns, trying billing fallback');
  return tryBillingFallback(fc, post);
}

/**
 * POST without date range: direct fetch.
 * @param fc - Fetch context.
 * @param post - POST fetch params.
 * @returns Account with transactions.
 */
async function fetchPostDirect(
  fc: IAccountFetchCtx,
  post: IPostFetchCtx,
): Promise<Procedure<ITransactionsAccount>> {
  const raw = await fc.api.fetchPost<Record<string, unknown>>(
    post.url,
    post.baseBody as Record<string, string | object>,
  );
  if (!isOk(raw)) return raw;
  const txns = extractTransactions(raw.value);
  const assembly: IAccountAssemblyCtx = {
    fc,
    accountId: post.accountId,
    displayId: post.displayId,
  };
  return buildAccountResult(assembly, txns);
}

/**
 * Build POST fetch context from account record and endpoint.
 * @param accountRecord - Account record from init.
 * @param endpoint - Discovered POST endpoint.
 * @returns POST context and captured body.
 */
/** Card source labels for debug logging. */
const CARD_SOURCE_LABELS: Record<string, string> = { true: 'from cards[]', false: 'from record' };

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
  const rawCardId = extractCardId(accountRecord);
  const cardId = rawCardId || accountId;
  const rawPost = endpoint.postData || '{}';
  const capturedBody = JSON.parse(rawPost) as ApiPayload;
  const baseBody = templatePostBody(rawPost, accountRecord);
  const isFromCards = cardId !== accountId;
  LOG.debug('tryBilling: accountId=%s (card=%s)', cardId, CARD_SOURCE_LABELS[String(isFromCards)]);
  const post: IPostFetchCtx = {
    baseBody,
    url: endpoint.url,
    displayId: displayId || cardId,
    accountId: cardId,
  };
  return { post, capturedBody };
}

/**
 * POST strategy: monthly billing first, range fallback, direct.
 * @param fc - Fetch context.
 * @param accountRecord - Account record from init.
 * @param endpoint - Discovered POST endpoint.
 * @returns Account with transactions.
 */
async function fetchOneAccountPost(
  fc: IAccountFetchCtx,
  accountRecord: Record<string, unknown>,
  endpoint: IDiscoveredEndpoint,
): Promise<Procedure<ITransactionsAccount>> {
  const { post, capturedBody } = buildPostCtx(accountRecord, endpoint);
  const billing = await tryBillingFallback(fc, post, endpoint);
  const hasBilling = isOk(billing) && billing.value.txns.length > 0;
  if (hasBilling) return billing;
  if (isRangeIterable(capturedBody)) return await fetchPostWithRange(fc, post);
  return await fetchPostDirect(fc, post);
}

// ── GET Strategy ─────────────────────────────────────────

/**
 * GET strategy: fetch by URL template.
 * @param fc - Fetch context.
 * @param accountId - Account ID.
 * @returns Account with transactions.
 */
async function fetchOneAccountGet(
  fc: IAccountFetchCtx,
  accountId: string,
): Promise<Procedure<ITransactionsAccount>> {
  const urlCtx = { api: fc.api, network: fc.network, accountId, startDate: fc.startDate };
  const fetchUrl = resolveTxnUrl(urlCtx);
  if (!fetchUrl) {
    return fail(ScraperErrorTypes.Generic, 'No txn URL');
  }
  const raw = await fc.api.fetchGet<Record<string, unknown>>(fetchUrl);
  if (!isOk(raw)) return raw;
  const txns = extractTransactions(raw.value);
  const assembly: IAccountAssemblyCtx = { fc, accountId, displayId: accountId };
  return buildAccountResult(assembly, txns);
}

// ── Account Dispatch ─────────────────────────────────────

/**
 * Check if options indicate a POST endpoint is available.
 * @param opts - Account fetch options.
 * @returns True if POST endpoint with account record exists.
 */
function hasPostEndpoint(opts: IAccountFetchOpts): opts is IAccountFetchOpts & {
  readonly accountRecord: ApiPayload;
  readonly txnEndpoint: IDiscoveredEndpoint;
} {
  if (!opts.txnEndpoint) return false;
  if (opts.txnEndpoint.method !== 'POST') return false;
  return Boolean(opts.accountRecord);
}

/**
 * Fetch transactions for one account.
 * @param fc - Fetch context.
 * @param accountId - Account number.
 * @param opts - Account record and endpoint.
 * @returns Account with transactions.
 */
async function genericFetchOneAccount(
  fc: IAccountFetchCtx,
  accountId: string,
  opts: IAccountFetchOpts,
): Promise<Procedure<ITransactionsAccount>> {
  if (!hasPostEndpoint(opts)) {
    return await fetchOneAccountGet(fc, accountId);
  }
  return await fetchOneAccountPost(fc, opts.accountRecord, opts.txnEndpoint);
}

/**
 * Process one account (loop body helper).
 * @param ctx - Fetch-all context.
 * @param index - Current account index.
 * @param out - Accumulator.
 * @returns True when processed.
 */
async function processOneAccount(
  ctx: IFetchAllAccountsCtx,
  index: number,
  out: ITransactionsAccount[],
): Promise<true> {
  const opts: IAccountFetchOpts = {
    accountRecord: ctx.records[index],
    txnEndpoint: ctx.txnEndpoint,
  };
  const fetched = await genericFetchOneAccount(ctx.fc, ctx.ids[index], opts);
  if (isOk(fetched)) out.push(fetched.value);
  return true as const;
}

/**
 * Build index array for sequential account iteration.
 * @param count - Number of accounts.
 * @returns Array of indices [0, 1, 2, ...].
 */
function indexArray(count: number): readonly AccountIndex[] {
  return Array.from({ length: count }, (_, i): AccountIndex => i);
}

/**
 * Fetch all accounts via sequential promise chain.
 * @param ctx - Bundled fetch-all context.
 * @returns Scraped accounts array.
 */
async function fetchAllAccounts(
  ctx: IFetchAllAccountsCtx,
): Promise<readonly ITransactionsAccount[]> {
  const accounts: ITransactionsAccount[] = [];
  const indices = indexArray(ctx.ids.length);
  const seed = Promise.resolve(true as const);
  const chain = indices.reduce(
    (prev, idx): Promise<true> =>
      prev.then((): Promise<true> => processOneAccount(ctx, idx, accounts)),
    seed,
  );
  await chain;
  return accounts;
}

export default fetchAllAccounts;
export { fetchAllAccounts };
