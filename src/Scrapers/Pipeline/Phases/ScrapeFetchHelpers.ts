/**
 * Scrape fetch helpers — rate limiting, POST templating,
 * deduplication, balance lookup, chunk fetch, monthly chunking.
 */

import { setTimeout as timerWait } from 'node:timers/promises';

import type { ITransaction, ITransactionsAccount } from '../../../Transactions.js';
import type { IMonthChunk } from '../Mediator/GenericScrapeStrategy.js';
import {
  extractTransactions,
  findFieldValue,
  generateMonthChunks,
  replaceField,
} from '../Mediator/GenericScrapeStrategy.js';
import type { INetworkDiscovery } from '../Mediator/NetworkDiscovery.js';
import { PIPELINE_WELL_KNOWN_TXN_FIELDS as WK } from '../Registry/PipelineWellKnown.js';
import type { IApiFetchContext } from '../Types/PipelineContext.js';
import type { Procedure } from '../Types/Procedure.js';
import { isOk, succeed } from '../Types/Procedure.js';
import type { IAccountAssemblyCtx, IChunkingCtx } from './ScrapeTypes.js';

/** Pipe-delimited key for transaction deduplication. */
type TxnHashKey = string;
/** Whether a key matches a WK account ID template field. */
type IsTemplate = boolean;
/** Whether a template field was applied to the POST body. */
type FieldApplied = boolean;
/** Whether a transaction date is after the start date. */
type IsAfterDate = boolean;
/** Resolved transaction fetch URL. */
type TxnUrlStr = string;
/** Start date string forwarded from scraper options. */
type StartDateStr = string;

// ── Rate Limiting ────────────────────────────────────────

const RATE_LIMIT_MS = 300;

/**
 * Pause execution for rate limiting between API calls.
 * Uses node:timers/promises because no browser page is
 * available in the API-only scrape context.
 * @param ms - Milliseconds to pause.
 * @returns True when the pause completes.
 */
async function rateLimitPause(ms: number): Promise<true> {
  await timerWait(ms);
  return true;
}

// ── Parsing + Hashing ────────────────────────────────────

/**
 * Parse YYYYMMDD to Date.
 * @param raw - Date string in YYYYMMDD format.
 * @returns Parsed Date.
 */
function parseStartDate(raw: string): Date {
  const fmt = raw.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
  return new Date(fmt);
}

/**
 * Build dedup hash for a transaction.
 * @param t - Transaction to hash.
 * @returns Pipe-delimited key.
 */
function txnHash(t: ITransaction): TxnHashKey {
  const amt = String(t.originalAmount);
  return `${t.date}|${t.description}|${amt}`;
}

// ── Templating ───────────────────────────────────────────

/** Lowercased WK account ID field names. */
const TEMPLATE_KEYS = new Set(WK.accountId.map((k): TxnHashKey => k.toLowerCase()));

/**
 * Check if a field key is a templateable account ID.
 * @param key - Field name.
 * @returns True if the key matches a WK account ID field.
 */
function isTemplateKey(key: TxnHashKey): IsTemplate {
  const keyLower = key.toLowerCase();
  return TEMPLATE_KEYS.has(keyLower);
}

/**
 * Apply one account record entry to the body if templateable.
 * @param body - Body to mutate.
 * @param key - Field name from account record.
 * @param value - Field value (only string/number are used).
 * @returns True if field was applied.
 */
function applyTemplateField(
  body: Record<string, string | object>,
  key: TxnHashKey,
  value: string | number,
): FieldApplied {
  if (!isTemplateKey(key)) return false;
  const stringValue = String(value);
  replaceField(body, [key], stringValue);
  return true;
}

/**
 * Build POST body from captured template.
 * @param postData - Captured raw POST data string.
 * @param accountRecord - Account record with values.
 * @returns Templated body with account IDs substituted.
 */
/**
 * Extract scalar entries from an account record.
 * @param record - Account record with mixed values.
 * @returns Only string/number entries.
 */
function scalarEntries(record: Record<string, unknown>): readonly [string, string | number][] {
  const all = Object.entries(record);
  return all.filter(
    (e): e is [string, string | number] => typeof e[1] === 'string' || typeof e[1] === 'number',
  );
}

/**
 * Build POST body from captured template.
 * @param postData - Captured raw POST data string.
 * @param accountRecord - Account record with values.
 * @returns Templated body with account IDs substituted.
 */
function templatePostBody(
  postData: string,
  accountRecord: Record<string, unknown>,
): Record<string, string | object> {
  const raw = postData || '{}';
  const body = JSON.parse(raw) as Record<string, string | object>;
  for (const [key, value] of scalarEntries(accountRecord)) {
    applyTemplateField(body, key, value);
  }
  return body;
}

// ── Deduplication ────────────────────────────────────────

/**
 * Deduplicate and filter transactions by start date.
 * @param allTxns - Raw transactions.
 * @param startMs - Start date as epoch ms.
 * @returns Filtered unique transactions.
 */
function deduplicateTxns(
  allTxns: readonly ITransaction[],
  startMs: number,
): readonly ITransaction[] {
  const afterStart = allTxns.filter((t): IsAfterDate => new Date(t.date).getTime() >= startMs);
  const seen = new Set<TxnHashKey>();
  return afterStart.filter((t): IsAfterDate => {
    const key = txnHash(t);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── Balance ──────────────────────────────────────────────

/**
 * Fetch balance for one account.
 * @param api - API fetch context.
 * @param network - Network discovery.
 * @param accountId - Account number.
 * @returns Balance number or 0.
 */
async function genericFetchBalance(
  api: IApiFetchContext,
  network: INetworkDiscovery,
  accountId: string,
): Promise<number> {
  const balUrl = network.buildBalanceUrl(accountId);
  if (!balUrl) return 0;
  const raw = await api.fetchGet<Record<string, unknown>>(balUrl);
  if (!isOk(raw)) return 0;
  const bal = findFieldValue(raw.value, WK.balance);
  if (typeof bal === 'number') return bal;
  return 0;
}

// ── Transaction URL ──────────────────────────────────────

/** Bundled params for resolving transaction URL. */
interface ITxnUrlCtx {
  readonly api: IApiFetchContext;
  readonly network: INetworkDiscovery;
  readonly accountId: TxnUrlStr;
  readonly startDate: StartDateStr;
}

/**
 * Resolve the transaction URL for an account.
 * @param ctx - Bundled URL resolution context.
 * @returns Transaction URL or false.
 */
function resolveTxnUrl(ctx: ITxnUrlCtx): string | false {
  const fromTemplate = ctx.network.buildTransactionUrl(ctx.accountId, ctx.startDate);
  if (fromTemplate) return fromTemplate;
  return ctx.api.transactionsUrl;
}

// ── Account Assembly ─────────────────────────────────────

/**
 * Build account result with balance lookup.
 * @param ctx - Assembly context.
 * @param txns - Transactions.
 * @returns Assembled account Procedure.
 */
async function buildAccountResult(
  ctx: IAccountAssemblyCtx,
  txns: readonly ITransaction[],
): Promise<Procedure<ITransactionsAccount>> {
  const balance = await genericFetchBalance(ctx.fc.api, ctx.fc.network, ctx.accountId);
  const accountNumber = ctx.displayId || ctx.accountId;
  return succeed({ accountNumber, balance, txns: [...txns] });
}

// ── Chunk Fetch ──────────────────────────────────────────

/**
 * Fetch one monthly chunk.
 * @param ctx - Chunking context.
 * @param chunk - Month chunk.
 * @returns Extracted transactions.
 */
async function fetchOneChunk(
  ctx: IChunkingCtx,
  chunk: IMonthChunk,
): Promise<readonly ITransaction[]> {
  const cloned = JSON.stringify(ctx.baseBody);
  const body = JSON.parse(cloned) as Record<string, unknown>;
  replaceField(body, WK.fromDate, chunk.start);
  replaceField(body, WK.toDate, chunk.end);
  const raw = await ctx.fc.api.fetchPost<Record<string, unknown>>(
    ctx.url,
    body as Record<string, string | object>,
  );
  if (!isOk(raw)) return [];
  return extractTransactions(raw.value);
}

/**
 * Process one chunk with rate limiting (loop body).
 * @param ctx - Chunking context.
 * @param chunk - Month chunk.
 * @param out - Accumulator array.
 * @returns True when done.
 */
async function processChunk(
  ctx: IChunkingCtx,
  chunk: IMonthChunk,
  out: ITransaction[],
): Promise<true> {
  const txns = await fetchOneChunk(ctx, chunk);
  out.push(...txns);
  return rateLimitPause(RATE_LIMIT_MS);
}

/**
 * Fetch all monthly chunks sequentially via promise chain.
 * @param ctx - Chunking context.
 * @param chunks - Month chunks.
 * @returns All transactions.
 */
async function fetchAllChunks(
  ctx: IChunkingCtx,
  chunks: readonly IMonthChunk[],
): Promise<readonly ITransaction[]> {
  const all: ITransaction[] = [];
  const seed = Promise.resolve(true as const);
  const chain = chunks.reduce(
    (prev, chunk): Promise<true> => prev.then((): Promise<true> => processChunk(ctx, chunk, all)),
    seed,
  );
  await chain;
  return all;
}

// ── Monthly Chunking ─────────────────────────────────────

/**
 * Fetch with monthly chunking and deduplication.
 * @param ctx - Chunking context.
 * @returns Account with all monthly transactions.
 */
async function fetchWithMonthlyChunking(
  ctx: IChunkingCtx,
): Promise<Procedure<ITransactionsAccount>> {
  const startDate = parseStartDate(ctx.fc.startDate);
  const now = new Date();
  const chunks = generateMonthChunks(startDate, now);
  const allTxns = await fetchAllChunks(ctx, chunks);
  const startMs = startDate.getTime();
  const unique = deduplicateTxns(allTxns, startMs);
  const assembly: IAccountAssemblyCtx = {
    fc: ctx.fc,
    accountId: ctx.accountId,
    displayId: ctx.displayId,
  };
  return buildAccountResult(assembly, unique);
}

// ── Date Filter ──────────────────────────────────────────

/**
 * Check if a transaction is after start date.
 * @param t - Transaction.
 * @param startMs - Start epoch ms.
 * @returns True if valid and after start.
 */
function isAfterStart(t: ITransaction, startMs: number): IsAfterDate {
  const txnMs = new Date(t.date).getTime();
  return !Number.isNaN(txnMs) && txnMs >= startMs;
}

/**
 * Apply global date filter to all accounts.
 * @param accounts - Scraped accounts.
 * @param startMs - Start date as epoch ms.
 * @returns The filtered accounts.
 */
function applyGlobalDateFilter(
  accounts: readonly ITransactionsAccount[],
  startMs: number,
): readonly ITransactionsAccount[] {
  for (const account of accounts) {
    account.txns = account.txns.filter((t): IsAfterDate => isAfterStart(t, startMs));
  }
  return accounts;
}

export {
  applyGlobalDateFilter,
  buildAccountResult,
  deduplicateTxns,
  fetchWithMonthlyChunking,
  genericFetchBalance,
  parseStartDate,
  rateLimitPause,
  resolveTxnUrl,
  templatePostBody,
};
