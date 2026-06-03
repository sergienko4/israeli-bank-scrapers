/**
 * BalanceResolveActions.Dispatch — plan-loop dispatch + structured
 * fetch lifecycle logs. Extracted from the BalanceResolveActions
 * barrel so the per-file LoC cap is honoured (phase-2e-residue split).
 */

import type { IBalanceFetchPlanEntry } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { isOk } from '../../Types/Procedure.js';
import type { IFetchExecCtx } from './BalanceResolveActions.Fetch.js';
import { safeIssueOneFetch } from './BalanceResolveActions.Fetch.js';

/**
 * Last 4 chars of an internal id — used for redacted observability logs.
 * @param id - bankAccountUniqueId / cardUniqueId.
 * @returns `***NNNN` where NNNN is the last 4 chars.
 */
function maskTail4(id: string): string {
  return `***${id.slice(-4)}`;
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
 * Emit the `balance-resolve.fetch.start` info log.
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
 * Emit the `balance-resolve.fetch.failure` warn.
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
 * Emit the `balance-resolve.fetch.success` info log.
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

/** Bundled args for the dispatch outcome completion helper. */
interface ICompleteOutcomeArgs {
  readonly logArgs: Pick<IFetchLogArgs, 'ctx' | 'masked'>;
  readonly elapsedMs: string;
  readonly result: Procedure<unknown>;
}

/**
 * Complete the fetch dispatch lifecycle: emit success/failure log and
 * return the matching dispatch result.
 * @param args - Bundled log args + elapsed + procedure outcome.
 * @returns Dispatch outcome (`DISPATCH_FAILURE` on fail).
 */
function completeFetchOutcome(args: ICompleteOutcomeArgs): IDispatchResult {
  if (isOk(args.result)) {
    emitFetchSuccess(args.logArgs, args.elapsedMs);
    return { ok: true, body: args.result.value };
  }
  emitFetchFailure(args.logArgs, args.elapsedMs);
  return DISPATCH_FAILURE;
}

/** Bundled args for {@link dispatchEntry}. */
interface IDispatchEntryArgs {
  readonly ctx: IFetchExecCtx;
  readonly entry: IBalanceFetchPlanEntry;
}

/**
 * Dispatch a single fetch with structured start/success/failure logs.
 * Quarantines failures (returns DISPATCH_FAILURE).
 * @param args - Bundled fetch context + plan entry.
 * @returns Dispatch outcome.
 */
async function dispatchEntry(args: IDispatchEntryArgs): Promise<IDispatchResult> {
  const { ctx, entry } = args;
  const masked = maskTail4(entry.bankAccountUniqueId);
  emitFetchStart({ ctx, entry, masked });
  const startMs = Date.now();
  const result = await safeIssueOneFetch(ctx, entry);
  const elapsedMs = String(Date.now() - startMs);
  return completeFetchOutcome({ logArgs: { ctx, masked }, elapsedMs, result });
}

/**
 * Store a dispatched success into the response map.
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

/**
 * Zip dispatched results with their plan entries.
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
 * Loop the plan, issuing one fetch per entry. Quarantines individual
 * fetch failures (warn + continue).
 * @param ctx - Fetch execution context.
 * @param plan - Plan entries.
 * @returns Responses keyed by bankAccountUniqueId.
 */
async function fetchAllPlanEntries(
  ctx: IFetchExecCtx,
  plan: readonly IBalanceFetchPlanEntry[],
): Promise<ReadonlyMap<string, unknown>> {
  const dispatchPromises = plan.map(
    (entry): Promise<IDispatchResult> => dispatchEntry({ ctx, entry }),
  );
  const results = await Promise.all(dispatchPromises);
  return collectSuccesses(plan, results);
}

export type { IDispatchResult };
export { fetchAllPlanEntries };
