/**
 * DASHBOARD phase — thin orchestration, all logic in Mediator/Dashboard.
 * PRE:    locate nav link (probe + resolve candidate list)
 * ACTION: candidate-iteration loop (click → URL pattern check → goback → next)
 * POST:   validate traffic gate (change-password + any-endpoint check)
 * FINAL:  collect endpoints + auth → signal to SCRAPE
 */

import {
  executeCollectAndSignal,
  executeDashboardNavigationSealed,
  executePreLocateNav,
  executeValidateTraffic,
} from '../../Mediator/Dashboard/DashboardPhaseActions.js';
import { BasePhase } from '../../Types/BasePhase.js';
import type { IActionContext, IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';

export { probeDashboardReveal } from '../../Mediator/Dashboard/DashboardDiscovery.js';

/** DASHBOARD phase — BasePhase with PRE/ACTION/POST/FINAL. */
class DashboardPhase extends BasePhase {
  public readonly name = 'dashboard' as const;

  /** @inheritdoc */
  public async pre(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    input.logger.debug({ phase: this.name, message: 'dashboard.pre' });
    return executePreLocateNav(input);
  }

  /** @inheritdoc */
  public async action(
    _ctx: IActionContext,
    input: IActionContext,
  ): Promise<Procedure<IActionContext>> {
    input.logger.debug({ phase: this.name, message: 'dashboard.action' });
    return executeDashboardNavigationSealed(input);
  }

  /** @inheritdoc */
  public async post(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    input.logger.debug({ phase: this.name, message: 'dashboard.post' });
    return executeValidateTraffic(input);
  }

  /** @inheritdoc */
  public async final(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    input.logger.debug({ phase: this.name, message: 'dashboard.final' });
    return executeCollectAndSignal(input);
  }
}

/**
 * Create the DASHBOARD phase instance.
 * @returns DashboardPhase.
 */
function createDashboardPhase(): DashboardPhase {
  return new DashboardPhase();
}

export { createDashboardPhase, DashboardPhase };
