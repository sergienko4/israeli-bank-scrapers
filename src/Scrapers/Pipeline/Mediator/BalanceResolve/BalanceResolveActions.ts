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
import { PIPELINE_DISPLAY_ID_FIELDS } from '../../Registry/WK/BalanceResolveWK.js';
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
import { buildBalanceFetchPlan, BULK_KEY, EMPTY_PLAN } from './BalanceFetchPlanner.js';

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

/** Failure-procedure builder for empty SCRAPE-emitted state. */
const PRE_EMPTY_FAILS: Record<'identities' | 'template', Procedure<IPipelineContext>> = {
  identities: fail(
    ScraperErrorTypes.Generic,
    'balance-resolve.pre: SCRAPE emitted no accountIdentities',
  ),
  template: fail(
    ScraperErrorTypes.Generic,
    'balance-resolve.pre: SCRAPE emitted no balanceFetchTemplate',
  ),
};

/**
 * Pick the empty-state failure procedure when SCRAPE produced nothing
 * usable for BALANCE-RESOLVE.pre. Returns `false` when both inputs are
 * present (caller proceeds to plan-build).
 *
 * @param identities - Account identity map from `readAccountIdentities`.
 * @param template - Balance fetch template from `readBalanceFetchTemplate`.
 * @returns Pre-built failure procedure, or `false` to continue.
 */
function pickPreEmptyFailure(
  identities: ReadonlyMap<string, IAccountIdentity>,
  template: IBalanceFetchTemplate,
): Procedure<IPipelineContext> | false {
  if (identities.size === 0) return PRE_EMPTY_FAILS.identities;
  if (template.url.length === 0) return PRE_EMPTY_FAILS.template;
  return false;
}

/**
 * Build the success continuation for BALANCE-RESOLVE.pre: emit the
 * size debug log and commit `balanceFetchPlan`. Extracted so the
 * outer phase orchestrator stays a thin guard/branch.
 *
 * @param input - Pipeline context.
 * @param identities - Identities from SCRAPE.
 * @param template - Template from SCRAPE.
 * @returns Updated context with `balanceFetchPlan` populated.
 */
function buildPrePlanResult(
  input: IPipelineContext,
  identities: ReadonlyMap<string, IAccountIdentity>,
  template: IBalanceFetchTemplate,
): Procedure<IPipelineContext> {
  const plan = buildBalanceFetchPlan(identities, template);
  const idCount = String(identities.size);
  const planCount = String(plan.length);
  const message = `balance-resolve.pre identities=${idCount} plan=${planCount}`;
  input.logger.debug({ message });
  return succeed({ ...input, balanceFetchPlan: some(plan) });
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
  const emptyFailure = pickPreEmptyFailure(identities, template);
  if (emptyFailure !== false) return Promise.resolve(emptyFailure);
  const next = buildPrePlanResult(input, identities, template);
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

/**
 * Wraps {@link issueOneFetch} so a *thrown* exception from
 * `api.fetchPost` / `api.fetchGet` is converted to a `Procedure` fail
 * instead of propagating up through `Promise.all` and aborting every
 * sibling fetch. Without this guard one bank account's network error
 * cancels the whole BALANCE-RESOLVE.action run — breaking the
 * quarantine contract (debugging-guidlines §5).
 *
 * @param ctx - Fetch execution context.
 * @param entry - Plan entry being dispatched.
 * @returns Procedure wrapping success or a typed failure.
 */
async function safeIssueOneFetch(
  ctx: IFetchExecCtx,
  entry: IBalanceFetchPlanEntry,
): Promise<Procedure<unknown>> {
  try {
    return await issueOneFetch(ctx.api, entry, ctx.logger);
  } catch {
    return fail(
      ScraperErrorTypes.Generic,
      'balance-resolve.action: api.fetch threw — quarantined per Promise.all contract',
    );
  }
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
 * Emit the structured warn fired when JSON.parse threw inside
 * {@link safeParseJson}. Splitting it out keeps the parser body at
 * the project's per-function LoC budget.
 *
 * @param raw - The original JSON string (only its length is logged).
 * @param logger - Pipeline logger sink.
 * @returns Always true (sentinel for callers).
 */
function warnBodyParseFailure(raw: string, logger: IActionContext['logger']): true {
  logger.warn({
    event: 'balance-resolve.body-parse-failure',
    bodyLen: String(raw.length),
    message: 'malformed request body — sending empty payload; downstream MISS likely',
  });
  return true;
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
    warnBodyParseFailure(raw, logger);
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

/** Args bundle for the fetch lifecycle log helpers. */
interface IFetchLogArgs {
  readonly ctx: IFetchExecCtx;
  readonly entry: IBalanceFetchPlanEntry;
  readonly masked: string;
}

/**
 * Emit the structured `balance-resolve.fetch.start` info log fired
 * before a single plan-entry dispatch. Extracted so {@link dispatchEntry}
 * stays within the per-function LoC budget.
 *
 * @param args - Bundle holding ctx, entry, and masked tail4.
 * @returns Always true (sentinel for callers).
 */
function emitFetchStart(args: IFetchLogArgs): true {
  args.ctx.logger.info({
    event: 'balance-resolve.fetch.start',
    correlationId: args.ctx.correlationId,
    bankAccountTail4: args.masked,
    method: args.entry.request.method,
  });
  return true;
}

/**
 * Emit the structured `balance-resolve.fetch.failure` warn fired when
 * {@link safeIssueOneFetch} returns a Procedure fail. Quarantines the
 * outcome: the caller still returns {@link DISPATCH_FAILURE} so siblings
 * continue.
 *
 * @param args - Bundle holding ctx and masked tail4.
 * @param elapsedMs - String form of the dispatch elapsed time.
 * @returns Always true (sentinel for callers).
 */
function emitFetchFailure(args: Pick<IFetchLogArgs, 'ctx' | 'masked'>, elapsedMs: string): true {
  args.ctx.logger.warn({
    event: 'balance-resolve.fetch.failure',
    correlationId: args.ctx.correlationId,
    bankAccountTail4: args.masked,
    elapsedMs,
    message: 'fetch failed — quarantined; downstream MISS for this bank account',
  });
  return true;
}

/**
 * Emit the structured `balance-resolve.fetch.success` info log fired
 * when {@link safeIssueOneFetch} returns a Procedure success.
 *
 * @param args - Bundle holding ctx and masked tail4.
 * @param elapsedMs - String form of the dispatch elapsed time.
 * @returns Always true (sentinel for callers).
 */
function emitFetchSuccess(args: Pick<IFetchLogArgs, 'ctx' | 'masked'>, elapsedMs: string): true {
  args.ctx.logger.info({
    event: 'balance-resolve.fetch.success',
    correlationId: args.ctx.correlationId,
    bankAccountTail4: args.masked,
    elapsedMs,
  });
  return true;
}

/**
 * Complete the fetch dispatch lifecycle: emit success/failure log
 * based on the procedure outcome and return the matching dispatch
 * result. Extracted so {@link dispatchEntry} stays within the per-
 * function LoC budget.
 *
 * @param args - Bundle holding ctx + masked tail4.
 * @param elapsedMs - String form of the dispatch elapsed time.
 * @param result - Outcome from {@link safeIssueOneFetch}.
 * @returns Dispatch outcome (`DISPATCH_FAILURE` on fail).
 */
function completeFetchOutcome(
  args: Pick<IFetchLogArgs, 'ctx' | 'masked'>,
  elapsedMs: string,
  result: Procedure<unknown>,
): IDispatchResult {
  if (!isOk(result)) {
    emitFetchFailure(args, elapsedMs);
    return DISPATCH_FAILURE;
  }
  emitFetchSuccess(args, elapsedMs);
  return { ok: true, body: result.value };
}

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
  emitFetchStart({ ctx, entry, masked });
  const startMs = Date.now();
  const result = await safeIssueOneFetch(ctx, entry);
  const elapsedMs = String(Date.now() - startMs);
  return completeFetchOutcome({ ctx, masked }, elapsedMs, result);
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

/**
 * Does the record's cardUniqueId / display fields match the identity?
 * @param rec - JSON record.
 * @param identity - Identity to match.
 * @returns True when this record represents this card.
 */
function matchesIdentity(rec: Record<string, unknown>, identity: IAccountIdentity): boolean {
  const uid = rec.cardUniqueId ?? rec.cardUniqueID;
  if (typeof uid === 'string' && uid === identity.cardUniqueId) return true;
  return PIPELINE_DISPLAY_ID_FIELDS.some((f): boolean =>
    matchDisplayField(rec[f], identity.cardDisplayId),
  );
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
  const body = responses.get(identity.bankAccountUniqueId) ?? responses.get(BULK_KEY);
  if (body === undefined) return 'MISS';
  const got = extractPerCardBalance(body, identity);
  if (got === false) return 'MISS';
  return got;
}

/**
 * Build the fetch-context bundle used by every dispatched plan entry.
 * Splitting the construction keeps {@link executeBalanceResolveAction}
 * within the per-function LoC budget.
 *
 * @param api - Unwrapped API fetch context (caller verified `.has`).
 * @param logger - Pipeline logger sink for downstream lifecycle logs.
 * @returns Fetch-context bundle including a fresh correlation id.
 */
function buildFetchCtx(api: IApiFetchContext, logger: IActionContext['logger']): IFetchExecCtx {
  return { api, logger, correlationId: randomUUID() };
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
  if (plan.length === 0 || !input.api.has) {
    const empty = commitEmptyAction(input);
    return succeed(empty);
  }
  const fetchCtx = buildFetchCtx(input.api.value, input.logger);
  return executeDispatchChain(input, fetchCtx, plan);
}

/**
 * Build the early-return shape when there is nothing to dispatch
 * (empty plan, or api absent). Both empty sentinels committed so
 * downstream `.post` / `.final` see consistent state.
 *
 * @param input - Action context.
 * @returns Action context with empty extracted + responses committed.
 */
function commitEmptyAction(input: IActionContext): IActionContext {
  return {
    ...input,
    balanceResponsesByBankAccount: some(EMPTY_RESPONSES),
    balanceExtracted: some(EMPTY_EXTRACTED),
  };
}

/**
 * Run the dispatch + extract pipeline for the populated-plan path.
 * Hoisted so {@link executeBalanceResolveAction} stays at ≤10 lines
 * (project convention).
 *
 * @param input - Sealed action context.
 * @param fetchCtx - Pre-built fetch execution context.
 * @param plan - Per-bank-account plan entries.
 * @returns Action context with responses + extracted committed.
 */
async function executeDispatchChain(
  input: IActionContext,
  fetchCtx: IFetchExecCtx,
  plan: readonly IBalanceFetchPlanEntry[],
): Promise<Procedure<IActionContext>> {
  const identities = readAccountIdentities(input);
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
/**
 * Detect the universal-miss POST condition: every account landed in
 * `missedIds`, with at least one identity present. Pulled out so the
 * orchestrator stays a thin guard/branch.
 *
 * @param report - Partitioned outcome from {@link partitionOutcomes}.
 * @returns True when every account missed.
 */
function isUniversalMiss(report: IBalanceValidation): boolean {
  return report.totalAccounts > 0 && report.missedIds.length === report.totalAccounts;
}

/**
 * Emit the `balance-resolve.post` debug summary covering counts for
 * resolved / missed / total accounts. Pulled out so the orchestrator
 * body stays within the per-function LoC budget.
 *
 * @param log - Pipeline logger sink.
 * @param report - Partitioned validation report.
 * @returns Always true (sentinel for callers).
 */
function emitPostSummary(log: IPipelineContext['logger'], report: IBalanceValidation): true {
  const message =
    `balance-resolve.post resolved=${String(report.resolvedIds.length)} ` +
    `missed=${String(report.missedIds.length)} total=${String(report.totalAccounts)}`;
  log.debug({ message });
  return true;
}

/**
 * Build the `ACCOUNT_RESOLUTION_FAILED`-style universal-miss failure
 * procedure for BALANCE-RESOLVE.post. Pulled out so the orchestrator
 * stays a flat dispatch and the nested-call lint passes.
 *
 * @param report - Partitioned validation report.
 * @returns Failure procedure carrying the diagnostic message.
 */
function buildUniversalMissFailure(report: IBalanceValidation): Procedure<IPipelineContext> {
  const msg = buildUniversalMissMessage(report.totalAccounts);
  return fail(ScraperErrorTypes.Generic, msg);
}

/**
 * BALANCE-RESOLVE.post — partition outcomes into resolved vs missed.
 * Soft-warns per missed account; hard-fails ONLY when every account
 * landed in missedIds (universal miss = scrape miss, not legitimate).
 * @param input - Pipeline context.
 * @returns Updated context, or fail on universal miss.
 */
/**
 * Pick the success / fail procedure for BALANCE-RESOLVE.post based on
 * whether the report exhibits the universal-miss invariant. Pure
 * helper — the orchestrator stays a thin gather-and-dispatch flow.
 *
 * @param input - Pipeline context.
 * @param report - Partitioned validation report.
 * @returns Failure for universal-miss, otherwise the commit success.
 */
function chooseBalancePostOutcome(
  input: IPipelineContext,
  report: IBalanceValidation,
): Procedure<IPipelineContext> {
  if (isUniversalMiss(report)) return buildUniversalMissFailure(report);
  return succeed({ ...input, balanceValidation: some(report) });
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
  emitPostSummary(input.logger, report);
  const outcome = chooseBalancePostOutcome(input, report);
  return Promise.resolve(outcome);
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

/** Counts surfaced from `ctx.balanceValidation` for FINAL reveal logging. */
interface IFinalRevealCounts {
  readonly resolvedCount: number;
  readonly missedCount: number;
}

/**
 * Read resolved/missed counts from the optional balance-validation
 * record, collapsing to zeros when the option is absent. Pulled out
 * so {@link emitFinalReveal} stays within the per-function LoC budget.
 *
 * @param input - Pipeline context.
 * @returns Counts bundle (zeros when validation option is empty).
 */
function readFinalRevealCounts(input: IPipelineContext): IFinalRevealCounts {
  if (!input.balanceValidation.has) return { resolvedCount: 0, missedCount: 0 };
  const validation = input.balanceValidation.value;
  return { resolvedCount: validation.resolvedIds.length, missedCount: validation.missedIds.length };
}

/** Diagnostic payload for `balance-resolve.final` REVEAL log. */
interface IFinalRevealDiag {
  readonly event: 'balance-resolve.final';
  readonly resolvedCount: string;
  readonly missedCount: string;
  readonly totalCount: string;
  readonly message: string;
}

/**
 * Build the structured REVEAL log payload from the counts bundle.
 * Pulled out so {@link emitFinalReveal} stays within the per-function
 * LoC budget and the diagnostic shape is greppable on its own.
 *
 * @param counts - Resolved/missed counts from `readFinalRevealCounts`.
 * @param totalCount - Total account count from the extracted map.
 * @returns REVEAL diagnostic payload ready for `LOG.info`.
 */
function buildFinalRevealDiag(counts: IFinalRevealCounts, totalCount: number): IFinalRevealDiag {
  return {
    event: 'balance-resolve.final',
    resolvedCount: String(counts.resolvedCount),
    missedCount: String(counts.missedCount),
    totalCount: String(totalCount),
    message: 'balance resolution committed; ready for TERMINATE',
  };
}

/**
 * Emit the REVEAL info log for BALANCE-RESOLVE.final.
 * @param input - Pipeline context.
 * @param totalCount - Number of accounts in the extracted map.
 * @returns True after the log is emitted.
 */
function emitFinalReveal(input: IPipelineContext, totalCount: number): true {
  const counts = readFinalRevealCounts(input);
  const diag = buildFinalRevealDiag(counts, totalCount);
  LOG.info(diag);
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
