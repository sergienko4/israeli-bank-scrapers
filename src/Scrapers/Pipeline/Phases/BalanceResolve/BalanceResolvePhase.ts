/**
 * BALANCE-RESOLVE phase — thin orchestrator, all logic in Mediator.
 *
 * v4 phase between SCRAPE and TERMINATE. Resolves per-account
 * balance values from the captured network pool, applying the
 * widened WK alias list + deep BFS + string coercion + ILS-first
 * currency policy. Strict input/output isolation per
 * general-phases-view-guidlines.md.
 *
 * PRE:    builds per-account candidate endpoints from the pool
 * ACTION: extracts balance per accountId from the candidate map
 *         (sealed action context — no mediator)
 * POST:   validates resolved vs missed; hard-fails on universal miss
 * FINAL:  emits ctx.balanceResolution for PipelineResult to consume;
 *         REVEAL via 'balance-resolve.final' info log; signal TERMINATE.
 *
 * api-direct banks bypass this phase — they emit ctx.balanceResolution
 * from ApiDirectScrapePhase.final via per-bank shape extractors.
 */

import {
  executeBalanceResolveAction,
  executeBalanceResolveFinal,
  executeBalanceResolvePost,
  executeBalanceResolvePre,
} from '../../Mediator/BalanceResolve/BalanceResolveActions.js';
import { BasePhase } from '../../Types/BasePhase.js';
import type { IActionContext, IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';

/** BALANCE-RESOLVE phase — BasePhase with PRE/ACTION/POST/FINAL. */
class BalanceResolvePhase extends BasePhase {
  public readonly name = 'balance-resolve' as const;

  /** @inheritdoc */
  public async pre(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    input.logger.debug({ phase: this.name, message: 'balance-resolve.pre' });
    return executeBalanceResolvePre(input);
  }

  /** @inheritdoc */
  public async action(
    _ctx: IActionContext,
    input: IActionContext,
  ): Promise<Procedure<IActionContext>> {
    input.logger.debug({ phase: this.name, message: 'balance-resolve.action' });
    return executeBalanceResolveAction(input);
  }

  /** @inheritdoc */
  public async post(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    input.logger.debug({ phase: this.name, message: 'balance-resolve.post' });
    return executeBalanceResolvePost(input);
  }

  /** @inheritdoc */
  public async final(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    input.logger.debug({ phase: this.name, message: 'balance-resolve.final' });
    return executeBalanceResolveFinal(input);
  }
}

/**
 * Create the BALANCE-RESOLVE phase instance.
 * @returns BalanceResolvePhase.
 */
function createBalanceResolvePhase(): BalanceResolvePhase {
  return Reflect.construct(BalanceResolvePhase, []);
}

export { BalanceResolvePhase, createBalanceResolvePhase };
