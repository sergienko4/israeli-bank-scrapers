/**
 * BALANCE-RESOLVE phase Mediator actions — PRE/ACTION/POST/FINAL (v6).
 *
 * Phase chain position: SCRAPE → BALANCE-RESOLVE → TERMINATE.
 * Browser banks only; api-direct banks emit ctx.balanceResolution
 * from ApiDirectScrapePhase.final via their per-bank shape extractors.
 *
 * v6 — SINGLE-PHASE OWNERSHIP. BALANCE-RESOLVE is the only phase that
 * touches balance:
 *   - .pre   reads SCRAPE-emitted accountIdentities + balanceFetchTemplate,
 *            builds the per-bank-account balanceFetchPlan
 *   - .action loops the plan via api.fetchPost / fetchGet, quarantines
 *            single-fetch failures, extracts per-card balance
 *   - .post  partitions resolved vs missed; hard-fails universal miss
 *   - .final emits final balanceResolution map
 *
 * Per general-phases-view-guidlines.md: "100% separation between phases
 * and sub-steps". SCRAPE.post emits typed data; BALANCE-RESOLVE consumes
 * via context fields only.
 */

import { randomUUID } from 'node:crypto';

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { getDebug as createLogger } from '../../Types/Debug.js';
import { some } from '../../Types/Option.js';
import { redactAccount } from '../../Types/PiiRedactor.js';
import type {
  BalanceExtractionOutcome,
  IAccountIdentity,
  IActionContext,
  IApiFetchContext,
  IBalanceExtracted,
  IBalanceFetchPlanEntry,
  IBalanceFetchTemplate,
  IBalanceValidation,
  IPipelineContext,
} from '../../Types/PipelineContext.js';
import { fail, isOk, type Procedure, succeed } from '../../Types/Procedure.js';
import { runBalanceExtractor } from './BalanceExtractor.js';
import { buildBalanceFetchPlan, EMPTY_PLAN } from './BalanceFetchPlanner.js';

const LOG = createLogger('balance-resolve');

/** Empty extracted map sentinel for absent-state paths. */
const EMPTY_EXTRACTED: IBalanceExtracted = new Map();

/** Empty identity map sentinel — exposed so callers branch-free. */
const EMPTY_IDENTITIES: ReadonlyMap<string, IAccountIdentity> = new Map();

/** Empty response map sentinel keyed by bankAccountUniqueId. */
const EMPTY_RESPONSES: ReadonlyMap<string, unknown> = new Map();

/** Empty template sentinel — `url === ''` ⇒ no template emitted by SCRAPE.post. */
const EMPTY_TEMPLATE: IBalanceFetchTemplate = Object.freeze({ url: '', method: 'GET' });

/**
 * Read SCRAPE.post's emitted identities from scrape state. Returns the
 * empty sentinel when scrape state or the field is absent.
 * @param input - Pipeline context.
 * @returns Identity map keyed by cardDisplayId.
 */
function readAccountIdentities(
  input: IPipelineContext | IActionContext,
): ReadonlyMap<string, IAccountIdentity> {
  const opt = (input as { readonly scrape?: IPipelineContext['scrape'] }).scrape;
  if (!opt?.has) return EMPTY_IDENTITIES;
  return opt.value.accountIdentities ?? EMPTY_IDENTITIES;
}

/**
 * Read SCRAPE.post's emitted balance fetch template. Returns the empty
 * sentinel when scrape state or the field is absent.
 * @param input - Pipeline context.
 * @returns Fetch template.
 */
function readBalanceFetchTemplate(input: IPipelineContext | IActionContext): IBalanceFetchTemplate {
  const opt = (input as { readonly scrape?: IPipelineContext['scrape'] }).scrape;
  if (!opt?.has) return EMPTY_TEMPLATE;
  return opt.value.balanceFetchTemplate ?? EMPTY_TEMPLATE;
}

/**
 * BALANCE-RESOLVE.pre — build the per-bank-account fetch plan from
 * SCRAPE-emitted identities + template. Default-deny (Procedure fail)
 * when either input is absent.
 *
 * @param input - Pipeline context after SCRAPE.
 * @returns Updated context with balanceFetchPlan committed, or Procedure fail.
 */
function executeBalanceResolvePre(input: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  const identities = readAccountIdentities(input);
  const template = readBalanceFetchTemplate(input);
  if (identities.size === 0) {
    const failure = fail(
      ScraperErrorTypes.Generic,
      'balance-resolve.pre: SCRAPE emitted no accountIdentities',
    );
    return Promise.resolve(failure);
  }
  if (template.url.length === 0) {
    const failure = fail(
      ScraperErrorTypes.Generic,
      'balance-resolve.pre: SCRAPE emitted no balanceFetchTemplate',
    );
    return Promise.resolve(failure);
  }
  const plan = buildBalanceFetchPlan(identities, template);
  input.logger.debug({
    message:
      `balance-resolve.pre identities=${String(identities.size)} ` + `plan=${String(plan.length)}`,
  });
  const next = succeed({ ...input, balanceFetchPlan: some(plan) });
  return Promise.resolve(next);
}

/**
 * Last 4 chars of an internal id — used for redacted observability logs.
 * @param id - bankAccountUniqueId / cardUniqueId.
 * @returns `***NNNN` where NNNN is the last 4 chars.
 */
function maskTail4(id: string): string {
  const tail = id.slice(-4);
  return `***${tail}`;
}

/**
 * Issue a single live fetch via the IApiFetchContext surface. POST
 * decoded from request.body JSON; GET issued by URL only.
 *
 * @param api - API fetch context.
 * @param entry - Plan entry to execute.
 * @param logger - Pipeline logger (for body-parse-failure warns).
 * @returns Procedure<unknown> wrapping the response body.
 */
async function issueOneFetch(
  api: IApiFetchContext,
  entry: IBalanceFetchPlanEntry,
  logger: IActionContext['logger'],
): Promise<Procedure<unknown>> {
  if (entry.request.method === 'POST') {
    const parsedBody = safeParseJson(entry.request.body, logger);
    return api.fetchPost<unknown>(entry.request.url, parsedBody);
  }
  return api.fetchGet<unknown>(entry.request.url);
}

/** Empty parsed-body sentinel. */
const EMPTY_PARSED_BODY: Readonly<Record<string, string | object>> = Object.freeze({});

/**
 * Narrow a parsed-JSON value to a plain record. Arrays / nulls /
 * primitives collapse to the empty sentinel so the safeParseJson
 * caller stays branch-free.
 *
 * @param parsed - JSON.parse result.
 * @returns Plain record, or the empty sentinel.
 */
function narrowParsed(parsed: unknown): Record<string, string | object> {
  if (parsed === null) return EMPTY_PARSED_BODY;
  if (typeof parsed !== 'object') return EMPTY_PARSED_BODY;
  if (Array.isArray(parsed)) return EMPTY_PARSED_BODY;
  return parsed as Record<string, string | object>;
}

/**
 * Parse a JSON string to a record without throwing across module boundaries.
 * Malformed JSON is logged as `balance-resolve.body-parse-failure` (warn) —
 * body length only, never the body itself — so silent MISSes from a planner
 * bug or hand-crafted fixture are auditable in `pipeline.log`.
 *
 * @param raw - JSON string (may be empty).
 * @param logger - Pipeline logger for the body-parse-failure warn.
 * @returns Record (empty when raw is empty / non-object / malformed).
 */
function safeParseJson(
  raw: string,
  logger: IActionContext['logger'],
): Record<string, string | object> {
  if (raw.length === 0) return EMPTY_PARSED_BODY;
  try {
    const parsed: unknown = JSON.parse(raw);
    return narrowParsed(parsed);
  } catch {
    logger.warn({
      event: 'balance-resolve.body-parse-failure',
      bodyLen: String(raw.length),
      message: 'malformed request body — sending empty payload; downstream MISS likely',
    });
    return EMPTY_PARSED_BODY;
  }
}

/**
 * Bundle holding the per-fetch correlation id plus the IActionContext
 * fields fetchAllPlanEntries reads.
 */
interface IFetchExecCtx {
  readonly api: IApiFetchContext;
  readonly logger: IActionContext['logger'];
  readonly correlationId: string;
}

/**
 * Loop the plan, issuing one fetch per entry. Quarantines individual
 * fetch failures (warn + continue). Returns the responses map keyed by
 * bankAccountUniqueId.
 *
 * @param ctx - Fetch execution context.
 * @param plan - Plan entries.
 * @returns Responses keyed by bankAccountUniqueId.
 */
async function fetchAllPlanEntries(
  ctx: IFetchExecCtx,
  plan: readonly IBalanceFetchPlanEntry[],
): Promise<ReadonlyMap<string, unknown>> {
  const dispatchPromises = plan.map((entry): Promise<IDispatchResult> => dispatchEntry(ctx, entry));
  const results = await Promise.all(dispatchPromises);
  return collectSuccesses(plan, results);
}

/**
 * Zip dispatched results with their plan entries, building a map of
 * successful responses keyed by bankAccountUniqueId.
 *
 * @param plan - Plan entries in the order they were dispatched.
 * @param results - Per-entry dispatch outcomes (same order).
 * @returns Responses keyed by bankAccountUniqueId.
 */
function collectSuccesses(
  plan: readonly IBalanceFetchPlanEntry[],
  results: readonly IDispatchResult[],
): ReadonlyMap<string, unknown> {
  const out = new Map<string, unknown>();
  for (const [idx, result] of results.entries()) {
    setIfOk(out, plan[idx].bankAccountUniqueId, result);
  }
  return out;
}

/**
 * Store a dispatched success into the response map. Skips failures so
 * the caller can keep the iteration body flat (max-depth ≤ 1).
 *
 * @param out - Response map being built.
 * @param key - bankAccountUniqueId for this plan entry.
 * @param result - Dispatch outcome.
 * @returns True when the success was stored.
 */
function setIfOk(out: Map<string, unknown>, key: string, result: IDispatchResult): boolean {
  if (!result.ok) return false;
  out.set(key, result.body);
  return true;
}

/** Result wrapper for {@link dispatchEntry}. */
interface IDispatchResult {
  readonly ok: boolean;
  readonly body: unknown;
}

/** Empty dispatch failure sentinel. */
const DISPATCH_FAILURE: IDispatchResult = Object.freeze({ ok: false, body: null });

/**
 * Dispatch a single fetch with structured start/success/failure logs.
 * Quarantines failures (logs warn, returns DISPATCH_FAILURE — caller
 * continues).
 *
 * @param ctx - Fetch execution context.
 * @param entry - Plan entry to dispatch.
 * @returns Dispatch outcome.
 */
async function dispatchEntry(
  ctx: IFetchExecCtx,
  entry: IBalanceFetchPlanEntry,
): Promise<IDispatchResult> {
  const masked = maskTail4(entry.bankAccountUniqueId);
  ctx.logger.info({
    event: 'balance-resolve.fetch.start',
    correlationId: ctx.correlationId,
    bankAccountTail4: masked,
    method: entry.request.method,
  });
  const startMs = Date.now();
  const result = await issueOneFetch(ctx.api, entry, ctx.logger);
  const elapsedMs = String(Date.now() - startMs);
  if (!isOk(result)) {
    ctx.logger.warn({
      event: 'balance-resolve.fetch.failure',
      correlationId: ctx.correlationId,
      bankAccountTail4: masked,
      elapsedMs,
      message: 'fetch failed — quarantined; downstream MISS for this bank account',
    });
    return DISPATCH_FAILURE;
  }
  ctx.logger.info({
    event: 'balance-resolve.fetch.success',
    correlationId: ctx.correlationId,
    bankAccountTail4: masked,
    elapsedMs,
  });
  return { ok: true, body: result.value };
}

/** Sentinel returned by findCardRecord when no match is present. */
const NO_CARD_RECORD: Record<string, unknown> = Object.freeze({});

/**
 * Identify the no-match sentinel returned by {@link findCardRecord}.
 * Callers branch on this to distinguish "card record found" from
 * "no per-card record in the response" without using `undefined`.
 *
 * @param rec - Candidate card record.
 * @returns True when this record is the NO_CARD_RECORD sentinel.
 */
function isNoCardRecord(rec: Record<string, unknown>): boolean {
  return rec === NO_CARD_RECORD;
}

/**
 * Find a per-card record nested inside a bank-account-level response.
 * Matches by cardUniqueId (exact) OR any display field (last-4, cardSuffix, etc).
 *
 * @param node - JSON sub-tree.
 * @param identity - Card identity to match.
 * @returns Card record, or {@link NO_CARD_RECORD} when not found.
 */
function findCardRecord(node: unknown, identity: IAccountIdentity): Record<string, unknown> {
  if (Array.isArray(node)) return findCardRecordInArray(node, identity);
  if (node === null || typeof node !== 'object') return NO_CARD_RECORD;
  const rec = node as Record<string, unknown>;
  if (matchesIdentity(rec, identity)) return rec;
  return findCardRecordInChildren(rec, identity);
}

/**
 * Walk an array looking for a card record that matches the identity.
 *
 * @param arr - Array of JSON values.
 * @param identity - Card identity to match.
 * @returns Matching card record, or {@link NO_CARD_RECORD}.
 */
function findCardRecordInArray(
  arr: readonly unknown[],
  identity: IAccountIdentity,
): Record<string, unknown> {
  const candidates = arr.map((item): Record<string, unknown> => findCardRecord(item, identity));
  return candidates.find((c): boolean => !isNoCardRecord(c)) ?? NO_CARD_RECORD;
}

/**
 * Recurse into a record's children looking for a card record match.
 *
 * @param rec - Record to recurse into.
 * @param identity - Card identity to match.
 * @returns Matching descendant card record, or {@link NO_CARD_RECORD}.
 */
function findCardRecordInChildren(
  rec: Record<string, unknown>,
  identity: IAccountIdentity,
): Record<string, unknown> {
  const values = Object.values(rec);
  const candidates = values.map((v): Record<string, unknown> => findCardRecord(v, identity));
  return candidates.find((c): boolean => !isNoCardRecord(c)) ?? NO_CARD_RECORD;
}

/** Display-id field names checked when matching a card record. */
const DISPLAY_ID_FIELDS: readonly string[] = [
  'last4Digits',
  'cardSuffix',
  'cardLast4',
  'shortCardNumber',
  'card4Number',
];

/**
 * Does the record's cardUniqueId / display fields match the identity?
 * @param rec - JSON record.
 * @param identity - Identity to match.
 * @returns True when this record represents this card.
 */
function matchesIdentity(rec: Record<string, unknown>, identity: IAccountIdentity): boolean {
  const uid = rec.cardUniqueId ?? rec.cardUniqueID;
  if (typeof uid === 'string' && uid === identity.cardUniqueId) return true;
  return DISPLAY_ID_FIELDS.some((f): boolean => matchDisplayField(rec[f], identity.cardDisplayId));
}

/**
 * Match a single display-id field value (string OR number) against
 * the identity's cardDisplayId. Hoisted so {@link matchesIdentity}
 * stays at depth 1 (max-depth rule).
 *
 * @param value - Value picked from a record's display-id field.
 * @param target - Identity's cardDisplayId.
 * @returns True when value matches (after string coercion).
 */
function matchDisplayField(value: unknown, target: string): boolean {
  if (typeof value === 'string') return value === target;
  if (typeof value === 'number') return String(value) === target;
  return false;
}

/**
 * Extract per-card balance from a bank-account-level response. First
 * finds the card record (Visa Cal nested in result.bigNumbers[].cards[],
 * Amex/Isracard at data.cardsList[]). Falls back to the bulk extractor
 * on the whole body for single-account banks.
 *
 * @param body - Response body for the card's bank account.
 * @param identity - Card identity (cardUniqueId + cardDisplayId).
 * @returns Finite balance number, or `false` for MISS.
 */
function extractPerCardBalance(body: unknown, identity: IAccountIdentity): number | false {
  const card = findCardRecord(body, identity);
  const fromCard = isNoCardRecord(card) ? false : runBalanceExtractor(card);
  if (fromCard !== false) return fromCard;
  return runBalanceExtractor(body);
}

/**
 * Iterate every card identity, look up its bank-account response,
 * and run the per-card extractor. Cards whose bank-account response
 * is missing land as 'MISS'.
 *
 * @param identities - Card identities.
 * @param responses - Responses keyed by bankAccountUniqueId.
 * @returns Per-card outcomes (number or 'MISS').
 */
function extractAllCards(
  identities: ReadonlyMap<string, IAccountIdentity>,
  responses: ReadonlyMap<string, unknown>,
): IBalanceExtracted {
  const out = new Map<string, BalanceExtractionOutcome>();
  for (const identity of identities.values()) {
    const outcome = extractOneCard(identity, responses);
    out.set(identity.cardDisplayId, outcome);
  }
  return out;
}

/**
 * Extract one card's balance from its bank-account response (if present).
 * @param identity - Card identity.
 * @param responses - Responses keyed by bankAccountUniqueId.
 * @returns Outcome.
 */
function extractOneCard(
  identity: IAccountIdentity,
  responses: ReadonlyMap<string, unknown>,
): BalanceExtractionOutcome {
  const body = responses.get(identity.bankAccountUniqueId) ?? responses.get('__BULK__');
  if (body === undefined) return 'MISS';
  const got = extractPerCardBalance(body, identity);
  if (got === false) return 'MISS';
  return got;
}

/**
 * BALANCE-RESOLVE.action — issue the per-bank-account fetches and
 * extract per-card balance.
 *
 * <p>Quarantine pattern (debugging-guidlines §5): single-fetch
 * failures do not abort the phase; affected cards land as 'MISS'.
 *
 * @param input - Sealed action context.
 * @returns Updated context with responses + extracted committed.
 */
async function executeBalanceResolveAction(
  input: IActionContext,
): Promise<Procedure<IActionContext>> {
  const plan = input.balanceFetchPlan.has ? input.balanceFetchPlan.value : EMPTY_PLAN;
  const identities = readAccountIdentities(input);
  if (plan.length === 0 || !input.api.has) {
    return succeed({
      ...input,
      balanceResponsesByBankAccount: some(EMPTY_RESPONSES),
      balanceExtracted: some(EMPTY_EXTRACTED),
    });
  }
  const correlationId = randomUUID();
  const fetchCtx: IFetchExecCtx = { api: input.api.value, logger: input.logger, correlationId };
  const responses = await fetchAllPlanEntries(fetchCtx, plan);
  const extracted = extractAllCards(identities, responses);
  return succeed({
    ...input,
    balanceResponsesByBankAccount: some(responses),
    balanceExtracted: some(extracted),
  });
}

/**
 * Partition the extracted outcomes into resolved (finite) and missed.
 * @param extracted - Extracted outcomes per accountId.
 * @returns Validation report.
 */
function partitionOutcomes(extracted: IBalanceExtracted): IBalanceValidation {
  const entries = [...extracted.entries()];
  const missed = entries.filter(([, outcome]): boolean => outcome === 'MISS');
  const resolved = entries.filter(([, outcome]): boolean => outcome !== 'MISS');
  return {
    resolvedIds: resolved.map(([id]): string => id),
    missedIds: missed.map(([id]): string => id),
    totalAccounts: extracted.size,
  };
}

/**
 * Emit a per-account 'balance.miss' warn for each missed accountId.
 * @param missedIds - Account ids with no balance found.
 * @param log - Pipeline logger.
 * @returns Number of warns emitted.
 */
function emitMissWarns(missedIds: readonly string[], log: IPipelineContext['logger']): number {
  for (const accountId of missedIds) {
    log.warn({
      event: 'balance.miss',
      account: redactAccount(accountId),
      message: 'balance unresolved — fallback to 0',
    });
  }
  return missedIds.length;
}

/**
 * Build the universal-miss failure message for BALANCE-RESOLVE.post.
 * @param totalAccounts - Total accounts that landed in missedIds.
 * @returns Fail-message string.
 */
function buildUniversalMissMessage(totalAccounts: number): string {
  return (
    `BALANCE-RESOLVE: all ${String(totalAccounts)} accounts unresolved — ` +
    'scrape miss (no fetch yielded a balance)'
  );
}

/**
 * BALANCE-RESOLVE.post — partition outcomes into resolved vs missed.
 * Soft-warns per missed account; hard-fails ONLY when every account
 * landed in missedIds (universal miss = scrape miss, not legitimate).
 * @param input - Pipeline context.
 * @returns Updated context, or fail on universal miss.
 */
function executeBalanceResolvePost(input: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  const extracted = input.balanceExtracted.has ? input.balanceExtracted.value : EMPTY_EXTRACTED;
  const report = partitionOutcomes(extracted);
  emitMissWarns(report.missedIds, input.logger);
  input.logger.debug({
    message:
      `balance-resolve.post resolved=${String(report.resolvedIds.length)} ` +
      `missed=${String(report.missedIds.length)} total=${String(report.totalAccounts)}`,
  });
  if (report.totalAccounts > 0 && report.missedIds.length === report.totalAccounts) {
    const msg = buildUniversalMissMessage(report.totalAccounts);
    const failure = fail(ScraperErrorTypes.Generic, msg);
    return Promise.resolve(failure);
  }
  const next = succeed({ ...input, balanceValidation: some(report) });
  return Promise.resolve(next);
}

/**
 * Collapse extracted outcomes to a final number map. MISS → 0;
 * legitimate zero balances preserved.
 * @param extracted - Extracted outcomes per accountId.
 * @returns Final balance map.
 */
function buildFinalMap(extracted: IBalanceExtracted): ReadonlyMap<string, number> {
  const out = new Map<string, number>();
  for (const [accountId, outcome] of extracted) {
    out.set(accountId, outcome === 'MISS' ? 0 : outcome);
  }
  return out;
}

/**
 * Emit the REVEAL info log for BALANCE-RESOLVE.final.
 * @param input - Pipeline context.
 * @param totalCount - Number of accounts in the extracted map.
 * @returns True after the log is emitted.
 */
function emitFinalReveal(input: IPipelineContext, totalCount: number): true {
  const resolvedCount = input.balanceValidation.has
    ? input.balanceValidation.value.resolvedIds.length
    : 0;
  const missedCount = input.balanceValidation.has
    ? input.balanceValidation.value.missedIds.length
    : 0;
  LOG.info({
    event: 'balance-resolve.final',
    resolvedCount: String(resolvedCount),
    missedCount: String(missedCount),
    totalCount: String(totalCount),
    message: 'balance resolution committed; ready for TERMINATE',
  });
  return true;
}

/**
 * BALANCE-RESOLVE.final — collapse the extracted outcomes to a final
 * number map. 'MISS' entries become 0; legitimate zero balances are
 * preserved. REVEAL: emit per-account audit table for traceability.
 * @param input - Pipeline context.
 * @returns Updated context with balanceResolution committed.
 */
function executeBalanceResolveFinal(input: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  const extracted = input.balanceExtracted.has ? input.balanceExtracted.value : EMPTY_EXTRACTED;
  const resolution = buildFinalMap(extracted);
  emitFinalReveal(input, extracted.size);
  const next = succeed({ ...input, balanceResolution: some(resolution) });
  return Promise.resolve(next);
}

export {
  executeBalanceResolveAction,
  executeBalanceResolveFinal,
  executeBalanceResolvePost,
  executeBalanceResolvePre,
};
