/**
 * Scrape fetch helpers — rate limiting, POST templating,
 * deduplication, chunk fetch, monthly chunking.
 *
 * v4 (2026-05-27): balance lookup moved out of SCRAPE. Balance
 * resolution is owned exclusively by the BALANCE-RESOLVE phase,
 * which consumes `scrape.perAccountResponses` and writes
 * `ctx.balanceResolution`. SCRAPE here owns only `accountNumber`
 * and `txns` on the assembled account.
 */

import { setTimeout as timerWait } from 'node:timers/promises';

import type { ITransaction, ITransactionsAccount } from '../../../../Transactions.js';
import ScraperError from '../../../Base/ScraperError.js';
import type { INetworkDiscovery } from '../../Mediator/Network/NetworkDiscovery.js';
import { findFieldValue, replaceField } from '../../Mediator/Scrape/ScrapeAutoMapper.js';
import type { JsonRecord } from '../../Mediator/Scrape/ScrapeReplayAction.js';
import {
  PIPELINE_WELL_KNOWN_ACCOUNT_FIELDS as WK_ACCT,
  PIPELINE_WELL_KNOWN_MONTHLY_FIELDS as MF,
} from '../../Registry/WK/ScrapeWK.js';
import type { Brand } from '../../Types/Brand.js';
import type { IApiFetchContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { isOk, succeed } from '../../Types/Procedure.js';

/** Pipe-delimited transaction hash. */
type TxnHashKey = Brand<string, 'TxnHashKey'>;
/** Lowercased templateable WK key. */
type TemplateKeyLower = Brand<string, 'TemplateKeyLower'>;
/** Templateable-key predicate result. */
type IsTemplateKey = Brand<boolean, 'IsTemplateKey'>;
/** Field-application predicate result. */
type DidApplyField = Brand<boolean, 'DidApplyField'>;
/** After-start-date predicate result. */
type IsAfterStartDate = Brand<boolean, 'IsAfterStartDate'>;
/** Dedup retain predicate result. */
type ShouldRetainTxn = Brand<boolean, 'ShouldRetainTxn'>;
/** Per-month transaction URL. */
type TxnUrlStr = Brand<string, 'TxnUrlStr'>;
/** Resolved final account-number string. */
type AccountNumberStr = Brand<string, 'AccountNumberStr'>;

import { resolveDisplayIdFromCapturedEndpoints } from './Account/ScrapeIdExtraction.js';
import type { IAccountAssemblyCtx } from './ScrapeTypes.js';

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

/** Stringified `undefined` produced by `String(undefined)` — used by the
 * row-shape guard below to detect catastrophic missing-field rows. */
const UNDEFINED_SENTINEL = 'undefined';

/**
 * Composes the dedup key for a transaction by joining the values of
 * the named fields with the `|` delimiter.
 *
 * <p>Phase G (2026-05-14): the field-name array `dedupKeyFields`
 * is supplied by DASHBOARD.FINAL per-card and travels through the
 * harvest contract. Typical contents are `['identifier']` when
 * the bank emits a per-txn unique id, or
 * `['date', 'identifier', 'originalAmount']` when the
 * identifier collides across rows (Beinleumi's `reference` is a
 * transaction-TYPE code shared by recurring monthly txns).
 *
 * <p>Defensive runtime guards (CodeRabbit review 2026-05-15):
 * <ul>
 *   <li><b>Empty tuple</b> — DASHBOARD always emits a non-empty
 *     array; an empty `dedupKeyFields` would hash every row to the
 *     empty string and collapse every transaction into one. Throws
 *     `DEDUP_KEY_FIELDS_EMPTY`.</li>
 *   <li><b>All-undefined row</b> — when every named field is
 *     absent on a row, the join hash degenerates to
 *     `"undefined|undefined|..."` and unrelated rows collide into
 *     one (frozen-mode replay or test mock without a DASHBOARD
 *     harvest). The fallback emits a per-row fingerprint hash
 *     based on the full row's JSON shape so distinct rows stay
 *     distinct without throwing.</li>
 * </ul>
 *
 * @param t - Transaction whose fields supply the key components.
 * @param dedupKeyFields - Non-empty array of {@link ITransaction}
 *   field names. Order is significant — emitted key joins values in
 *   the given order.
 * @returns Composed dedup key string.
 * @throws {ScraperError} `DEDUP_KEY_FIELDS_EMPTY` when the tuple is
 *   empty.
 */
function txnHash(t: ITransaction, dedupKeyFields: readonly string[]): TxnHashKey {
  if (dedupKeyFields.length === 0) {
    throw new ScraperError(
      'DEDUP_KEY_FIELDS_EMPTY: dedupKeyFields contract violation — must be non-empty',
    );
  }
  const row = t as unknown as Record<string, unknown>;
  const values = dedupKeyFields.map((field): string => String(row[field]));
  if (values.every((value): boolean => value === UNDEFINED_SENTINEL)) {
    return `_degenerate:${JSON.stringify(t)}` as TxnHashKey;
  }
  return values.join('|') as TxnHashKey;
}

// ── Templating ───────────────────────────────────────────

/** Lowercased WK account ID field names. */
const TEMPLATE_KEYS = new Set(
  WK_ACCT.id.map((k): TemplateKeyLower => k.toLowerCase() as TemplateKeyLower),
);

/**
 * Check if a field key is a templateable account ID.
 * @param key - Field name.
 * @returns True if the key matches a WK account ID field.
 */
function isTemplateKey(key: string): IsTemplateKey {
  const keyLower = key.toLowerCase();
  return TEMPLATE_KEYS.has(keyLower as TemplateKeyLower) as IsTemplateKey;
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
  key: string,
  value: string | number,
): DidApplyField {
  if (!isTemplateKey(key)) return false as DidApplyField;
  const stringValue = String(value);
  replaceField(body as JsonRecord, [key], stringValue);
  return true as DidApplyField;
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

/** Plural-array WK keys identifying multi-card request scopes. */
const PLURAL_CARDS_KEYS: readonly string[] = ['cards', 'accounts', 'bankAccounts'];

/** Per-txn WK card-id alias union — same union used by the partition. */
const PER_TXN_CARD_FIELDS: readonly string[] = [
  ...WK_ACCT.queryId,
  ...WK_ACCT.displayId,
  ...MF.accountId,
];

/** Local alias for an opaque card-array entry — bypass `unknown` rule. */
type CardEntry = Record<string, unknown> | string | number | boolean | null;

/** Did-filter outcome — branded so Rule #15 accepts the boolean return. */
type DidFilter = Brand<boolean, 'DidFilter'>;

/**
 * Returns true when one card-array entry's WK card-id field matches
 * the iteration's accountId. Generic via the WK alias list — case-
 * insensitive key matching is delegated to {@link findFieldValue}.
 *
 * @param entry - One element of the plural cards array.
 * @param accountId - Iteration card identifier.
 * @returns true when the entry belongs to this card.
 */
function entryMatchesAccountId(entry: CardEntry, accountId: string): boolean {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    return false;
  }
  const value = findFieldValue(entry, PER_TXN_CARD_FIELDS);
  if (value === false) return false;
  return String(value) === accountId;
}

/**
 * Filters the array under one plural key to entries matching
 * `accountId`. Returns true when a filter actually narrowed the
 * array. Hoisted so {@link filterPluralCardArrays} stays at depth 1.
 *
 * @param body - Mutable POST body.
 * @param key - Plural key to inspect.
 * @param accountId - Iteration card identifier.
 * @returns true when the array under `key` was rewritten.
 */
function filterOnePluralKey(
  body: Record<string, unknown>,
  key: string,
  accountId: string,
): DidFilter {
  const arr = body[key];
  if (!Array.isArray(arr)) return false as DidFilter;
  const entries = arr as readonly CardEntry[];
  const matched = entries.filter((entry): boolean => entryMatchesAccountId(entry, accountId));
  if (matched.length === 0) return false as DidFilter;
  if (matched.length === arr.length) return false as DidFilter;
  body[key] = matched;
  return true as DidFilter;
}

/**
 * Rewrites every plural cards array in `body` to contain only the
 * entry matching `accountId`. Banks whose dashboard fires a single
 * multi-card POST (Amex/Isracard `GetLatestTransactions`) accept a
 * one-element array equally well — the bank then returns per-card
 * data per request, eliminating the response-side mirror without
 * any per-bank code.
 *
 * <p>Generic via {@link PLURAL_CARDS_KEYS} (cards/accounts/
 * bankAccounts) and the WK card-id alias union. No-op when the body
 * carries no plural array, when no entry matches the accountId, or
 * when the accountId is empty (single-account banks).
 *
 * @param body - Mutable POST body parsed from the captured template.
 * @param accountId - Iteration card identifier (empty = no filter).
 * @returns true when at least one plural array was narrowed.
 */
function filterPluralCardArrays(body: Record<string, unknown>, accountId: string): DidFilter {
  if (accountId.length === 0) return false as DidFilter;
  const outcomes = PLURAL_CARDS_KEYS.map(
    (key): DidFilter => filterOnePluralKey(body, key, accountId),
  );
  return outcomes.includes(true as DidFilter) as DidFilter;
}

/**
 * Build POST body from captured template.
 *
 * <p>Two-step rewrite: first filter any plural cards/accounts array
 * to the iteration's card (so multi-card request templates become
 * per-card requests, generic via {@link PLURAL_CARDS_KEYS}); then
 * substitute scalar WK identifiers via the existing replaceField
 * walker.
 *
 * @param postData - Captured raw POST data string.
 * @param accountRecord - Account record with values.
 * @param accountId - Iteration card identifier; drives the plural-
 *   array filter. Optional — when omitted, only scalar substitution
 *   runs (single-card banks).
 * @returns Templated body with account IDs substituted and plural
 *   arrays narrowed to the iteration's card when applicable.
 */
function templatePostBody(
  postData: string,
  accountRecord: Record<string, unknown>,
  accountId = '',
): Record<string, string | object> {
  const raw = postData || '{}';
  const body = JSON.parse(raw) as Record<string, unknown>;
  filterPluralCardArrays(body, accountId);
  for (const [key, value] of scalarEntries(accountRecord)) {
    applyTemplateField(body as Record<string, string | object>, key, value);
  }
  return body as Record<string, string | object>;
}

// ── Deduplication ────────────────────────────────────────

/**
 * Filters txns to a start-date window, collapses duplicates by
 * {@link txnHash}, then sorts newest-first.
 *
 * <p>Phase G (2026-05-14): the dedup key is now driven by
 * `dedupKeyFields` — a field-name array chosen per-card by
 * DASHBOARD.FINAL and threaded through the harvest contract. The
 * function no longer infers a key from the row's shape; callers
 * supply the explicit tuple.
 *
 * <p>R-DEDUP-IDEMPOTENT invariant: a second pass over an
 * already-deduped array with the same tuple is a no-op — sister
 * strategies that call this factory before {@link buildAccountResult}
 * are safe to double-call.
 *
 * <p>Sort step (Phase F): the matrix-loop concatenates chunks in
 * oldest-cycle-first iteration order, producing interleaved
 * by-cycle output. Sorting at the factory boundary gives every
 * caller a chronological newest-first view regardless of upstream
 * order.
 *
 * @param allTxns - Raw transactions concatenated from one or more
 *   bank-API responses.
 * @param startMs - Inclusive window lower bound as epoch ms.
 * @param dedupKeyFields - Non-empty array of {@link ITransaction}
 *   field names used to compose each row's dedup key. Sourced from
 *   {@link IDashboardTxnHarvest.dedupKeyFieldsByAccount} per card.
 * @returns In-range unique transactions sorted by `date` descending.
 */
function deduplicateTxns(
  allTxns: readonly ITransaction[],
  startMs: number,
  dedupKeyFields: readonly string[],
): readonly ITransaction[] {
  const afterStart = allTxns.filter(
    (t): IsAfterStartDate => (new Date(t.date).getTime() >= startMs) as IsAfterStartDate,
  );
  const seen = new Set<string>();
  const unique = afterStart.filter((t): ShouldRetainTxn => {
    const key = txnHash(t, dedupKeyFields);
    if (seen.has(key)) return false as ShouldRetainTxn;
    seen.add(key);
    return true as ShouldRetainTxn;
  });
  return [...unique].sort(
    (a, b): number => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );
}

// ── Transaction URL ──────────────────────────────────────

/** Bundled params for resolving transaction URL. */
interface ITxnUrlCtx {
  readonly api: IApiFetchContext;
  readonly network: INetworkDiscovery;
  readonly accountId: string;
  readonly startDate: string;
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
 * Builds a per-month transaction URL by setting `filterData` and
 * `firstCallCardIndex` on the captured base URL. Uses URL.searchParams
 * so existing query params (e.g. version, stale filterData) merge
 * correctly — concatenating with `?` produced a double-`?` URL when
 * the captured base already carried a query string, which Max's API
 * rejected with `result: null, returnCode: 10`.
 * @param baseUrl - captured transaction URL.
 * @param yyyy - calendar year.
 * @param m - calendar month (1-based, no zero-pad).
 * @returns full URL with encoded filterData + firstCallCardIndex.
 */
function buildFilterDataUrl(baseUrl: string, yyyy: number, m: number): TxnUrlStr {
  const dateStr = `${String(yyyy)}-${String(m)}-01`;
  const json = JSON.stringify(FILTER_DATA_TEMPLATE).replace('{date}', dateStr);
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    const encoded = encodeURIComponent(json);
    return `${baseUrl}?filterData=${encoded}&firstCallCardIndex=-1` as TxnUrlStr;
  }
  url.searchParams.set('filterData', json);
  url.searchParams.set('firstCallCardIndex', '-1');
  return url.toString() as TxnUrlStr;
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

/**
 * Resolve final accountNumber. Prefers ctx ids; if both are empty or
 * the synthetic 'default' placeholder, scan captured endpoints.
 * Generic — no bank-specific routing.
 * @param ctx - Assembly context.
 * @returns Best-effort accountNumber string (never empty).
 */
function resolveAccountNumber(ctx: IAccountAssemblyCtx): AccountNumberStr {
  const primary = ctx.displayId || ctx.accountId;
  if (primary && primary !== DEFAULT_ACCOUNT_NUMBER) return primary as AccountNumberStr;
  const fromStore = resolveDisplayIdFromCapturedEndpoints(ctx.fc.network);
  if (isOk(fromStore)) return fromStore.value as AccountNumberStr;
  return (primary || DEFAULT_ACCOUNT_NUMBER) as AccountNumberStr;
}

/**
 * Build SCRAPE-side account result.
 *
 * <p>v4 (2026-05-27): balance is NO LONGER set here. The BALANCE-
 * RESOLVE phase owns balance resolution and writes
 * `ctx.balanceResolution`; `PipelineResult.combineWithBalance` merges
 * it onto the account by `accountNumber`. SCRAPE writes only the
 * `accountNumber` and `txns` fields. Keeping `balance` undefined on
 * the SCRAPE output is intentional — the type allows it (optional)
 * and the merge step never reads it.
 *
 * @param ctx - Assembly context.
 * @param txns - Transactions.
 * @returns Assembled account Procedure.
 */
function buildAccountResult(
  ctx: IAccountAssemblyCtx,
  txns: readonly ITransaction[],
): Procedure<ITransactionsAccount> {
  const accountNumber = resolveAccountNumber(ctx);
  return succeed({ accountNumber, txns: [...txns] });
}

export { applyGlobalDateFilter, scrapeWithMonthlyChunking } from './ScrapeChunking.js';

/**
 * Phase G ergonomic fallback when `fc.dedupKeyFields` is absent
 * (legacy test mocks, frozen-mode replays that pre-date Phase G).
 * Production SCRAPE.PRE always populates `fc.dedupKeyFields` from
 * the harvest, so this constant is dead in live runs.
 *
 * <p>Typed via `as const` (CodeRabbit review 2026-05-15) so the
 * literal tuple shape is preserved through `readonly ['identifier']`,
 * preventing accidental mutation or assignment of an unrelated
 * string array at any consumer.
 */
const FALLBACK_DEDUP_KEY_FIELDS = ['identifier'] as const;

export {
  buildAccountResult,
  buildFilterDataUrl,
  deduplicateTxns,
  FALLBACK_DEDUP_KEY_FIELDS,
  parseStartDate,
  rateLimitPause,
  resolveTxnUrl,
  templatePostBody,
  txnHash,
};
