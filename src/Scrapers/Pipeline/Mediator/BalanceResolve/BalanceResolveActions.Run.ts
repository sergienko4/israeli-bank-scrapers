/**
 * BalanceResolveActions.Run — ACTION orchestrator. Extracted from
 * the BalanceResolveActions barrel so the per-file LoC cap is honoured
 * (phase-2e-residue split).
 */

import { randomUUID } from 'node:crypto';

import { scopedResolveBalanceAliases } from '../../Registry/WK/BalanceResolveWK.js';
import { some } from '../../Types/Option.js';
import type {
  IActionContext,
  IApiFetchContext,
  IBalanceFetchPlanEntry,
} from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { succeed } from '../../Types/Procedure.js';
import { EMPTY_PLAN } from './BalanceFetchPlanner.js';
import { hasBalance } from './BalanceResolveActions.Captured.js';
import { fetchAllPlanEntries } from './BalanceResolveActions.Dispatch.js';
import { extractAllCards } from './BalanceResolveActions.Extract.js';
import type { IFetchExecCtx } from './BalanceResolveActions.Fetch.js';
import {
  EMPTY_EXTRACTED,
  EMPTY_RESPONSES,
  readCarriedIdentities,
} from './BalanceResolveActions.Shared.js';

/**
 * Build the fetch-context bundle used by every dispatched plan entry.
 * @param api - Unwrapped API fetch context.
 * @param logger - Pipeline logger sink.
 * @returns Fetch-context bundle including a fresh correlation id.
 */
function buildFetchCtx(api: IApiFetchContext, logger: IActionContext['logger']): IFetchExecCtx {
  return { api, logger, correlationId: randomUUID() };
}

/**
 * Build the early-return shape when there is nothing to dispatch.
 * @param input - Action context.
 * @returns Success procedure carrying the empty-commit action context.
 */
function commitEmptyAction(input: IActionContext): Procedure<IActionContext> {
  const next = {
    ...input,
    balanceResponsesByBankAccount: some(EMPTY_RESPONSES),
    balanceExtracted: some(EMPTY_EXTRACTED),
  };
  return succeed(next);
}

/** Bundled args for the populated-plan dispatch chain. */
interface IDispatchChainArgs {
  readonly input: IActionContext;
  readonly fetchCtx: IFetchExecCtx;
  readonly plan: readonly IBalanceFetchPlanEntry[];
}

/** Bundled args for the dispatch-result commit step. */
interface ICommitDispatchArgs {
  readonly input: IActionContext;
  readonly responses: ReadonlyMap<string, unknown>;
  readonly extracted: ReturnType<typeof extractAllCards>;
}

/**
 * Commit responses + extracted onto the action context, wrapped in `some`.
 * @param args - Bundled input + responses + extracted.
 * @returns Success procedure carrying the cloned action context.
 */
function commitDispatchResult(args: ICommitDispatchArgs): Procedure<IActionContext> {
  const next = {
    ...args.input,
    balanceResponsesByBankAccount: some(args.responses),
    balanceExtracted: some(args.extracted),
  };
  return succeed(next);
}

/**
 * Read the captured-pool seed committed by PRE (single-account rescue).
 * @param input - Action context.
 * @returns Captured responses, or the empty sentinel.
 */
function readSeededCaptured(input: IActionContext): ReadonlyMap<string, unknown> {
  const seed = input.balanceResponsesByBankAccount;
  return seed.has ? seed.value : EMPTY_RESPONSES;
}

/** Response map keyed by bankAccountUniqueId (or BULK_KEY for the bulk seed). */
type ResponseMap = ReadonlyMap<string, unknown>;

/**
 * Choose the merged body for a key present in BOTH the captured seed and the
 * live fetch: the live fetch wins ONLY when it carries a balance. A
 * wrong-endpoint / 4xx live response (captured as a "success" with a
 * balance-less body) therefore can never shadow the captured pool's real
 * balance at the shared {@link BULK_KEY} — the FIBI/Beinleumi universal-miss.
 * @param capturedBody - Captured-seed body for this key (undefined when none).
 * @param fetchedBody - Live fetch body for this key.
 * @returns The body to keep for this key.
 */
function pickMergedBody(capturedBody: unknown, fetchedBody: unknown): unknown {
  if (capturedBody === undefined) return fetchedBody;
  return hasBalance(fetchedBody) ? fetchedBody : capturedBody;
}

/**
 * Apply live fetches onto the captured-seed copy, balance-aware per key.
 * @param out - Mutable copy of the captured seed (mutated in place).
 * @param fetched - Live fetch responses.
 * @returns The merged map (same reference as `out`).
 */
function applyFetched(out: Map<string, unknown>, fetched: ResponseMap): Map<string, unknown> {
  for (const [key, body] of fetched) {
    const existing = out.get(key);
    const merged = pickMergedBody(existing, body);
    out.set(key, merged);
  }
  return out;
}

/**
 * Merge captured-pool seed with live fetches — a live fetch wins only when it
 * carries a balance, else the captured balance is preserved (fills genuine
 * fetch misses AND balance-less "successful" responses at the shared key).
 * @param captured - Captured-pool seed.
 * @param fetched - Live fetch responses.
 * @returns Merged response map.
 */
function mergeCaptured(captured: ResponseMap, fetched: ResponseMap): ResponseMap {
  if (captured.size === 0) return fetched;
  const out = new Map<string, unknown>(captured);
  return applyFetched(out, fetched);
}

/**
 * Run the dispatch + extract pipeline for the populated-plan path.
 * @param args - Bundled input + fetchCtx + plan.
 * @returns Action context with responses + extracted committed.
 */
async function executeDispatchChain(args: IDispatchChainArgs): Promise<Procedure<IActionContext>> {
  const identities = readCarriedIdentities(args.input);
  const fetched = await fetchAllPlanEntries(args.fetchCtx, args.plan);
  const captured = readSeededCaptured(args.input);
  const responses = mergeCaptured(captured, fetched);
  const balanceAliases = scopedResolveBalanceAliases(args.input.config.balanceKind);
  const extracted = extractAllCards({ identities, responses, balanceAliases });
  return commitDispatchResult({ input: args.input, responses, extracted });
}

/**
 * BALANCE-RESOLVE.action — issue the per-bank-account fetches and
 * extract per-card balance.
 * @param input - Sealed action context.
 * @returns Updated context with responses + extracted committed.
 */
async function executeBalanceResolveAction(
  input: IActionContext,
): Promise<Procedure<IActionContext>> {
  const plan = input.balanceFetchPlan.has ? input.balanceFetchPlan.value : EMPTY_PLAN;
  if (plan.length === 0 || !input.api.has) return commitEmptyAction(input);
  const fetchCtx = buildFetchCtx(input.api.value, input.logger);
  return executeDispatchChain({ input, fetchCtx, plan });
}

export { executeBalanceResolveAction };
export type { IDispatchChainArgs };
