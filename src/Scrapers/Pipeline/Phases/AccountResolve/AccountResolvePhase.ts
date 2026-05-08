/**
 * ACCOUNT-RESOLVE phase — thin orchestration, all logic in Mediator.
 *
 * Single source of truth for "the user's accounts are known": runs
 * between auth (LOGIN or OTP-FILL) and DASHBOARD, fails the run loud
 * when the pre-nav pool yields no id-bearing capture. Auto-bound by
 * the builder for every browser bank — no per-bank wiring.
 *
 * PRE:    pool-size telemetry; never mutates context.
 * ACTION: blocks on `network.waitForFirstId(20s)` so id-bearing
 *         captures landing late in auth still get into the pool.
 * POST:   commits `ctx.accountDiscovery` from `discoverAccountsInPool`
 *         on the pre-nav bucket; fail-loud on empty.
 * FINAL:  resolution telemetry; idempotent re-runs.
 */

import {
  executeAccountResolveAction,
  executeAccountResolveFinal,
  executeAccountResolvePost,
  executeAccountResolvePre,
} from '../../Mediator/AccountResolve/AccountResolveActions.js';
import { BasePhase } from '../../Types/BasePhase.js';
import type { IActionContext, IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';

/** ACCOUNT-RESOLVE phase — BasePhase with PRE/ACTION/POST/FINAL. */
class AccountResolvePhase extends BasePhase {
  public readonly name = 'account-resolve' as const;

  /** @inheritdoc */
  public async pre(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    input.logger.debug({ phase: this.name, message: 'account-resolve.pre' });
    return executeAccountResolvePre(input);
  }

  /** @inheritdoc */
  public async action(
    _ctx: IActionContext,
    input: IActionContext,
  ): Promise<Procedure<IActionContext>> {
    input.logger.debug({ phase: this.name, message: 'account-resolve.action' });
    return executeAccountResolveAction(input);
  }

  /** @inheritdoc */
  public async post(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    input.logger.debug({ phase: this.name, message: 'account-resolve.post' });
    return executeAccountResolvePost(input);
  }

  /** @inheritdoc */
  public async final(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    input.logger.debug({ phase: this.name, message: 'account-resolve.final' });
    return executeAccountResolveFinal(input);
  }
}

/**
 * Create the ACCOUNT-RESOLVE phase instance.
 * @returns AccountResolvePhase.
 */
function createAccountResolvePhase(): AccountResolvePhase {
  return Reflect.construct(AccountResolvePhase, []);
}

export { AccountResolvePhase, createAccountResolvePhase };
