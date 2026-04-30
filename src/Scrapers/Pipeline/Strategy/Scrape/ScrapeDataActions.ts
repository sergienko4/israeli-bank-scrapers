/**
 * Scrape fetch helpers — rate limiting, POST templating,
 * deduplication, balance lookup, chunk fetch, monthly chunking.
 */

import { setTimeout as timerWait } from 'node:timers/promises';

import type { ITransaction, ITransactionsAccount } from '../../../../Transactions.js';
import type { INetworkDiscovery } from '../../Mediator/Network/NetworkDiscovery.js';
import type { IDiscoveredEndpoint } from '../../Mediator/Network/NetworkDiscoveryTypes.js';
import { findFieldValue, replaceField } from '../../Mediator/Scrape/ScrapeAutoMapper.js';
import type { JsonRecord } from '../../Mediator/Scrape/ScrapeReplayAction.js';
import { PIPELINE_WELL_KNOWN_TXN_FIELDS as WK } from '../../Registry/WK/ScrapeWK.js';
import type { IApiFetchContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { isOk, succeed } from '../../Types/Procedure.js';
import {
  isRecord,
  resolveBalanceFromRecords,
  resolveRecordBalance,
} from './Account/BalanceExtractor.js';
import { resolveDisplayIdFromCapturedEndpoints } from './Account/ScrapeIdExtraction.js';
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

/** Generic filterData JSON — "show all" defaults for SPA filter APIs. */
const FILTER_DATA_TEMPLATE = {
  userIndex: -1,
  cardIndex: -1,
  monthView: true,
  date: '{date}',
  dates: { startDate: '0', endDate: '0' },
  bankAccount: { bankAccountIndex: -1, cards: null },
};

/**
 * Build a full config-fallback URL with filterData for a specific month.
 * @param baseUrl - Config transaction URL (e.g. https://...getTransactionsAndGraphs).
 * @param yyyy - Year.
 * @param m - Month (1-based, no zero-pad).
 * @returns Full URL with encoded filterData + firstCallCardIndex.
 */
function buildFilterDataUrl(baseUrl: TxnUrlStr, yyyy: number, m: number): TxnUrlStr {
  const dateStr = `${String(yyyy)}-${String(m)}-01`;
  const json = JSON.stringify(FILTER_DATA_TEMPLATE).replace('{date}', dateStr);
  const encoded = encodeURIComponent(json);
  return `${baseUrl}?filterData=${encoded}&firstCallCardIndex=-1`;
}

/**
 * Resolve the transaction URL for an account.
 * Priority: config path (validated) → discovered traffic → discovered transactionsUrl.
 * @param ctx - Bundled URL resolution context.
 * @returns Transaction URL or false.
 */
function resolveTxnUrl(ctx: ITxnUrlCtx): string | false {
  if (ctx.api.configTransactionsUrl) return ctx.api.configTransactionsUrl;
  const fromTemplate = ctx.network.buildTransactionUrl(ctx.accountId, ctx.startDate);
  if (fromTemplate) return fromTemplate;
  return ctx.api.transactionsUrl;
}

// ── Account Assembly ─────────────────────────────────────

/** Fallback accountNumber value when no record carries a display ID. */
const DEFAULT_ACCOUNT_NUMBER = 'default';

/** Named alias for the resolved accountNumber string (Rule #15). */
type AccountNumberStr = string;

/**
 * Resolve final accountNumber. Prefers ctx ids; if both are empty or
 * the synthetic 'default' placeholder, scan captured endpoints.
 * Generic — no bank-specific routing.
 * @param ctx - Assembly context.
 * @returns Best-effort accountNumber string (never empty).
 */
function resolveAccountNumber(ctx: IAccountAssemblyCtx): AccountNumberStr {
  const primary = ctx.displayId || ctx.accountId;
  if (primary && primary !== DEFAULT_ACCOUNT_NUMBER) return primary;
  const fromStore = resolveDisplayIdFromCapturedEndpoints(ctx.fc.network);
  if (isOk(fromStore)) return fromStore.value;
  return primary || DEFAULT_ACCOUNT_NUMBER;
}

/**
 * Build account result with balance + accountNumber lookup.
 * @param ctx - Assembly context.
 * @param txns - Transactions.
 * @returns Assembled account Procedure.
 */
async function buildAccountResult(
  ctx: IAccountAssemblyCtx,
  txns: readonly ITransaction[],
): Promise<Procedure<ITransactionsAccount>> {
  const balance = await resolveBalance(ctx);
  const accountNumber = resolveAccountNumber(ctx);
  return succeed({ accountNumber, balance, txns: [...txns] });
}

/** Captured record list — concrete type avoids null/undefined in signatures. */
type CapturedRecords = readonly Record<string, unknown>[];

/**
 * Project one captured endpoint to a 0- or 1-element record array.
 * flatMap over this produces a clean CapturedRecords list with no nulls.
 * @param ep - One discovered endpoint.
 * @returns Single-element array if responseBody is a plain record, else empty.
 */
function projectEndpointBody(ep: IDiscoveredEndpoint): CapturedRecords {
  if (!isRecord(ep.responseBody)) return [];
  return [ep.responseBody];
}

/**
 * Scan every captured endpoint's responseBody for a balance match.
 * Generic: no bank routing. Used when the primary txn record yields
 * no balance but a sibling endpoint (e.g. /accountSummary, /balances)
 * carries one. Rule #15: returns Procedure.
 * @param network - Network discovery with all captured endpoints.
 * @returns Procedure wrapping the balance value, or fail when no match.
 */
function resolveBalanceFromCapturedEndpoints(network: INetworkDiscovery): Procedure<number> {
  const bodies = network.getAllEndpoints().flatMap(projectEndpointBody);
  return resolveBalanceFromRecords(bodies);
}

/**
 * Resolve balance: record first (free), cross-endpoint scan, URL fallback.
 * @param ctx - Assembly context.
 * @returns Balance number (0 when no source yields a value).
 */
async function resolveBalance(ctx: IAccountAssemblyCtx): Promise<number> {
  const fromRecord = resolveRecordBalance(ctx.rawRecord);
  if (typeof fromRecord === 'number') return fromRecord;
  const fromStore = resolveBalanceFromCapturedEndpoints(ctx.fc.network);
  if (isOk(fromStore)) return fromStore.value;
  return lookupBalance(ctx.fc.api, ctx.fc.network, ctx.accountId);
}

export { applyGlobalDateFilter, scrapeWithMonthlyChunking } from './ScrapeChunking.js';

export {
  buildAccountResult,
  buildFilterDataUrl,
  deduplicateTxns,
  lookupBalance,
  parseStartDate,
  rateLimitPause,
  resolveTxnUrl,
  templatePostBody,
};
