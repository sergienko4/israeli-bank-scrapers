/**
 * Scrape fetch helpers — rate limiting, POST templating,
 * deduplication, balance lookup, chunk fetch, monthly chunking.
 */

import { setTimeout as timerWait } from 'node:timers/promises';

import type { ITransaction, ITransactionsAccount } from '../../../../Transactions.js';
import type { JsonRecord } from '../../Mediator/Network/GenericScrapeReplayStrategy.js';
import { findFieldValue, replaceField } from '../../Mediator/Network/GenericScrapeStrategy.js';
import type { INetworkDiscovery } from '../../Mediator/Network/NetworkDiscovery.js';
import { PIPELINE_WELL_KNOWN_TXN_FIELDS as WK } from '../../Registry/WK/ScrapeWK.js';
import type { IApiFetchContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { isOk, succeed } from '../../Types/Procedure.js';
import type { IAccountAssemblyCtx } from './ScrapeTypes.js';

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
  replaceField(body as JsonRecord, [key], stringValue);
  return true;
}

/**
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
async function lookupBalance(
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
  const balance = await lookupBalance(ctx.fc.api, ctx.fc.network, ctx.accountId);
  const accountNumber = ctx.displayId || ctx.accountId;
  return succeed({ accountNumber, balance, txns: [...txns] });
}

export { applyGlobalDateFilter, scrapeWithMonthlyChunking } from './ScrapeChunking.js';

export {
  buildAccountResult,
  deduplicateTxns,
  lookupBalance,
  parseStartDate,
  rateLimitPause,
  resolveTxnUrl,
  templatePostBody,
};
