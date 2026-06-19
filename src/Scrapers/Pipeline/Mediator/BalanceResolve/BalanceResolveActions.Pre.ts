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
import {
  diagnoseSeed,
  EMPTY_CAPTURED,
  poolDisprovesBalance,
  readCapturedBalanceResponses,
} from './BalanceResolveActions.Captured.js';
import {
  EMPTY_TEMPLATE,
  readAccountIdentities,
  readBalanceFetchTemplate,
} from './BalanceResolveActions.Shared.js';

/** Failure procedure for the empty-identities PRE state. */
const PRE_NO_IDENTITIES: Procedure<IPipelineContext> = fail(
  ScraperErrorTypes.Generic,
  'balance-resolve.pre: SCRAPE emitted no accountIdentities',
);

/**
 * Pick the empty-state failure procedure when SCRAPE resolved no
 * account identities. An empty fetch template is NOT a failure: it
 * means the bank has no balance-bearing endpoint, so PRE commits an
 * empty plan (→ ACTION soft no-op → POST total=0 → PASS) rather than
 * hard-failing. The universal-miss POST gate still catches the real
 * failure (identities resolved but every live balance fetch missed).
 * @param identities - Account identity map.
 * @returns Pre-built failure procedure, or `false` to continue.
 */
function pickPreEmptyFailure(
  identities: ReadonlyMap<string, IAccountIdentity>,
): Procedure<IPipelineContext> | false {
  if (identities.size === 0) return PRE_NO_IDENTITIES;
  return false;
}

/** Bundled args for the plan-build success continuation. */
interface IPrePlanArgs {
  readonly input: IPipelineContext;
  readonly identities: ReadonlyMap<string, IAccountIdentity>;
  readonly template: IBalanceFetchTemplate;
  readonly captured: ReadonlyMap<string, unknown>;
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
 * Emit PII-safe seed forensics (counts/booleans only) so a live
 * BALANCE-RESOLVE miss is root-causable from the log without another run.
 * @param input - Pipeline context (PRE).
 * @param seedResolved - Whether the captured seed produced a balance body.
 * @returns Always true (sentinel for callers).
 */
function logSeedForensics(input: IPipelineContext, seedResolved: boolean): true {
  const f = diagnoseSeed(input);
  const message =
    `balance-resolve.pre seed mediator=${String(f.mediatorPresent)} ` +
    `carriedBal=${String(f.carriedBalanceCount)} ` +
    `pool=${String(f.poolLen)}/${String(f.poolBalanceCount)} resolved=${String(seedResolved)}`;
  input.logger.debug({ message });
  return true;
}

/**
 * Build the success continuation for BALANCE-RESOLVE.pre — emit size
 * debug + commit `balanceFetchPlan` and the captured-pool seed.
 * @param args - Bundled input + identities + template + captured seed.
 * @returns Updated context with `balanceFetchPlan` populated.
 */
function buildPrePlanResult(args: IPrePlanArgs): Procedure<IPipelineContext> {
  const plan = buildBalanceFetchPlan(args.identities, args.template);
  logPrePlanSize(args.input, args.identities.size, plan.length);
  return succeed({
    ...args.input,
    balanceAccountIdentities: some(args.identities),
    balanceFetchPlan: some(plan),
    balanceResponsesByBankAccount: some(args.captured),
  });
}

/**
 * Read the captured-pool balance seed — only for the single-account
 * case, so a captured body is never mis-attributed across accounts.
 * @param input - Pipeline context (PRE — has the mediator).
 * @param identities - Resolved account identities.
 * @returns Captured balance responses, or the empty sentinel.
 */
function readCapturedSeed(
  input: IPipelineContext,
  identities: ReadonlyMap<string, IAccountIdentity>,
): ReadonlyMap<string, unknown> {
  if (identities.size !== 1) return EMPTY_CAPTURED;
  return readCapturedBalanceResponses(input);
}

/**
 * Resolve the live fetch template — suppressing it unless the bank is
 * declared a real account-balance bank (`config.balanceKind === 'account'`,
 * via {@link poolDisprovesBalance}). Card companies (`'card-cycle'`) and
 * not-yet-declared banks no-op: the suppressed template yields an empty plan
 * → ACTION soft no-op → POST total=0 → PASS, instead of a futile non-balance
 * live re-fetch that would universal-miss. Declared account banks honour the
 * SCRAPE-emitted template, so the real live fetch (and its tests) keep
 * working. Balance recognition still uses the in-cluster {@link
 * runBalanceExtractor} superset, so a folded `BalanceDisplay` is honoured.
 * @param input - Pipeline context (PRE).
 * @returns SCRAPE template, or EMPTY_TEMPLATE when balance is not declared.
 */
function resolveFetchTemplate(input: IPipelineContext): IBalanceFetchTemplate {
  if (poolDisprovesBalance(input)) return EMPTY_TEMPLATE;
  return readBalanceFetchTemplate(input);
}

/**
 * BALANCE-RESOLVE.pre — build the per-bank-account fetch plan from
 * SCRAPE-emitted identities + a response-aware template.
 * @param input - Pipeline context after SCRAPE.
 * @returns Updated context with balanceFetchPlan committed, or Procedure fail.
 */
function executeBalanceResolvePre(input: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  const identities = readAccountIdentities(input);
  const template = resolveFetchTemplate(input);
  const emptyFailure = pickPreEmptyFailure(identities);
  if (emptyFailure !== false) return Promise.resolve(emptyFailure);
  const captured = readCapturedSeed(input, identities);
  logSeedForensics(input, captured.size > 0);
  const next = buildPrePlanResult({ input, identities, template, captured });
  return Promise.resolve(next);
}

export type { IPrePlanArgs };
export { executeBalanceResolvePre };
