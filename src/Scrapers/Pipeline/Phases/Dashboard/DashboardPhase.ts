/**
 * DASHBOARD phase — thin orchestration, all logic in Mediator/Dashboard.
 * PRE:    locate nav link (probe + resolve strategy)
 * ACTION: click trigger (dispatch strategy + build API context)
 * POST:   validate traffic delta (change-password + traffic gate)
 * FINAL:  collect endpoints + auth → signal to SCRAPE
 */

import {
  executeClickTrigger,
  executeCollectAndSignal,
  executePreLocateNav,
  executeValidateTraffic,
} from '../../Mediator/Dashboard/DashboardPhaseActions.js';
import { BasePhase } from '../../Types/BasePhase.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
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
    void this.name;
    return executePreLocateNav(input);
  }

  /** @inheritdoc */
  public async action(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    void this.name;
    return executeClickTrigger(input);
  }

  /** @inheritdoc */
  public async post(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    void this.name;
    return executeValidateTraffic(input);
  }

  /** @inheritdoc */
  public async final(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    void this.name;
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
