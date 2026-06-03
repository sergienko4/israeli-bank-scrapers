/**
 * AccountResolveActions.Post — POST dispatcher + FINAL telemetry.
 * Extracted from the AccountResolveActions barrel so the per-file LoC
 * cap is honoured (phase-2e-residue split).
 */

import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { succeed } from '../../Types/Procedure.js';
import type { IElementMediator } from '../Elements/ElementMediator.js';
import { discoverAccountsInPool } from './AccountFromPool.js';
import type { ResolveClassification } from './AccountResolveActions.Classify.js';
import { classifyAccountResolveResult } from './AccountResolveActions.Classify.js';
import { buildAccountResolveSuccess } from './AccountResolveActions.Discovery.js';
import {
  failAccountResolutionFailed,
  failAccountResolutionIncomplete,
} from './AccountResolveActions.Failures.js';
import { isMockModeAccountResolveActive } from './AccountResolveActions.Wait.js';

/** Handler map for {@link ResolveClassification} kinds — OCP-style. */
type ResolveDispatchMap = {
  readonly [K in ResolveClassification['kind']]: (
    input: IPipelineContext,
    classification: Extract<ResolveClassification, { kind: K }>,
  ) => Procedure<IPipelineContext>;
};

const RESOLVE_DISPATCH: ResolveDispatchMap = {
  /**
   * Skip branch — passes the context through unchanged.
   * @param input - Pipeline context.
   * @returns Pass-through success.
   */
  skip: (input): Procedure<IPipelineContext> => succeed(input),
  /**
   * Empty-pool branch — emits `ACCOUNT_RESOLUTION_FAILED`.
   * @param _input - Unused pipeline context.
   * @param c - Classification with `poolSize`.
   * @returns Failure procedure.
   */
  failEmpty: (_input, c): Procedure<IPipelineContext> => failAccountResolutionFailed(c.poolSize),
  /**
   * Partial-resolution branch — emits `ACCOUNT_RESOLUTION_INCOMPLETE`.
   * @param _input - Unused pipeline context.
   * @param c - Classification with resolved/expected/containers.
   * @returns Failure procedure.
   */
  failIncomplete: (_input, c): Procedure<IPipelineContext> =>
    failAccountResolutionIncomplete({
      resolved: c.resolved,
      expected: c.expected,
      containers: c.containers,
    }),
  /**
   * Commit branch — packages the discovery payload onto the context.
   * @param input - Pipeline context.
   * @param c - Classification carrying pool + result.
   * @returns Success procedure with `accountDiscovery` populated.
   */
  commit: (input, c): Procedure<IPipelineContext> =>
    buildAccountResolveSuccess(input, c.pool, c.result),
};

/**
 * Dispatch the classification's `kind` via the {@link RESOLVE_DISPATCH} map.
 * @param input - Pipeline context.
 * @param classification - Outcome of {@link classifyAccountResolveResult}.
 * @returns The success / fail procedure for this branch.
 */
function dispatchAccountResolveClassification(
  input: IPipelineContext,
  classification: ResolveClassification,
): Procedure<IPipelineContext> {
  const handler = RESOLVE_DISPATCH[classification.kind] as (
    input: IPipelineContext,
    classification: ResolveClassification,
  ) => Procedure<IPipelineContext>;
  return handler(input, classification);
}

/**
 * Resolve the success/fail procedure from the live mediator state.
 * @param input - Pipeline context.
 * @param mediator - Unwrapped element mediator.
 * @returns Procedure for this run — success/fail.
 */
function buildAccountResolvePostResult(
  input: IPipelineContext,
  mediator: IElementMediator,
): Procedure<IPipelineContext> {
  const pool = mediator.network.getPreNavCaptures();
  const result = discoverAccountsInPool(pool);
  const classification = classifyAccountResolveResult(pool, result);
  return dispatchAccountResolveClassification(input, classification);
}

/**
 * POST — extracts ids from the pre-nav pool, commits
 * `ctx.accountDiscovery`, or fails loud when the resolution is empty
 * or partial.
 * @param input - Pipeline context.
 * @returns Updated context with the discovery option populated, or
 *   one of the two fail-loud procedures.
 */
function executeAccountResolvePost(input: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  if (!input.mediator.has || isMockModeAccountResolveActive) {
    const passThrough = succeed(input);
    return Promise.resolve(passThrough);
  }
  const dispatched = buildAccountResolvePostResult(input, input.mediator.value);
  return Promise.resolve(dispatched);
}

export type { ResolveDispatchMap };
export { executeAccountResolvePost };
