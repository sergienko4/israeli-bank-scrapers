/**
 * BalanceResolveActions.Pre — PRE orchestrator + plan-build helpers.
 * Extracted from the BalanceResolveActions barrel so the per-file LoC
 * cap is honoured (phase-2e-residue split).
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { some } from '../../Types/Option.js';
import type {
  IAccountIdentity,
  IBalanceFetchTemplate,
  IPipelineContext,
} from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import { buildBalanceFetchPlan } from './BalanceFetchPlanner.js';
import { readAccountIdentities, readBalanceFetchTemplate } from './BalanceResolveActions.Shared.js';

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
 * Pick the empty-state failure procedure when SCRAPE produced nothing usable.
 * @param identities - Account identity map.
 * @param template - Balance fetch template.
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

/** Bundled args for the plan-build success continuation. */
interface IPrePlanArgs {
  readonly input: IPipelineContext;
  readonly identities: ReadonlyMap<string, IAccountIdentity>;
  readonly template: IBalanceFetchTemplate;
}

/**
 * Emit the `balance-resolve.pre identities=N plan=N` debug log.
 * @param input - Pipeline context.
 * @param idCount - Identity count.
 * @param planCount - Plan entry count.
 * @returns Always true (sentinel for callers).
 */
function logPrePlanSize(input: IPipelineContext, idCount: number, planCount: number): true {
  const message = `balance-resolve.pre identities=${String(idCount)} plan=${String(planCount)}`;
  input.logger.debug({ message });
  return true;
}

/**
 * Build the success continuation for BALANCE-RESOLVE.pre — emit size
 * debug + commit `balanceFetchPlan`.
 * @param args - Bundled input + identities + template.
 * @returns Updated context with `balanceFetchPlan` populated.
 */
function buildPrePlanResult(args: IPrePlanArgs): Procedure<IPipelineContext> {
  const plan = buildBalanceFetchPlan(args.identities, args.template);
  logPrePlanSize(args.input, args.identities.size, plan.length);
  return succeed({ ...args.input, balanceFetchPlan: some(plan) });
}

/**
 * BALANCE-RESOLVE.pre — build the per-bank-account fetch plan from
 * SCRAPE-emitted identities + template.
 * @param input - Pipeline context after SCRAPE.
 * @returns Updated context with balanceFetchPlan committed, or Procedure fail.
 */
function executeBalanceResolvePre(input: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  const identities = readAccountIdentities(input);
  const template = readBalanceFetchTemplate(input);
  const emptyFailure = pickPreEmptyFailure(identities, template);
  if (emptyFailure !== false) return Promise.resolve(emptyFailure);
  const next = buildPrePlanResult({ input, identities, template });
  return Promise.resolve(next);
}

export type { IPrePlanArgs };
export { executeBalanceResolvePre };
