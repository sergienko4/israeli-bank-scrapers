/**
 * BalanceResolveActions.Run — ACTION orchestrator. Extracted from
 * the BalanceResolveActions barrel so the per-file LoC cap is honoured
 * (phase-2e-residue split).
 */

import { randomUUID } from 'node:crypto';

import { some } from '../../Types/Option.js';
import type {
  IActionContext,
  IApiFetchContext,
  IBalanceFetchPlanEntry,
} from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { succeed } from '../../Types/Procedure.js';
import { EMPTY_PLAN } from './BalanceFetchPlanner.js';
import { fetchAllPlanEntries } from './BalanceResolveActions.Dispatch.js';
import { extractAllCards } from './BalanceResolveActions.Extract.js';
import type { IFetchExecCtx } from './BalanceResolveActions.Fetch.js';
import {
  EMPTY_EXTRACTED,
  EMPTY_RESPONSES,
  readAccountIdentities,
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
 * Run the dispatch + extract pipeline for the populated-plan path.
 * @param args - Bundled input + fetchCtx + plan.
 * @returns Action context with responses + extracted committed.
 */
async function executeDispatchChain(args: IDispatchChainArgs): Promise<Procedure<IActionContext>> {
  const identities = readAccountIdentities(args.input);
  const responses = await fetchAllPlanEntries(args.fetchCtx, args.plan);
  const extracted = extractAllCards({ identities, responses });
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
