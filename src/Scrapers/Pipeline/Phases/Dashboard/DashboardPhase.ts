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
import type { IPreludeSpec } from '../../Mediator/Elements/PagePrelude.js';
import { PRELUDE_NONE } from '../../Mediator/Elements/PagePrelude.js';
import { DASHBOARD_PRELUDE_TIMEOUT_MS } from '../../Mediator/Timing/TimingConfig.js';
import { BasePhase } from '../../Types/BasePhase.js';
import type { IActionContext, IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';

export { probeDashboardReveal } from '../../Mediator/Dashboard/DashboardDiscovery.js';

/** DASHBOARD prelude spec — SPA-ready for PRE + ACTION. */
const DASHBOARD_SPA: IPreludeSpec = { level: 'spa', timeoutMs: DASHBOARD_PRELUDE_TIMEOUT_MS };

/** DASHBOARD prelude table — PRE/ACTION wait for SPA-ready; POST/FINAL no-op. */
const DASHBOARD_PRELUDE_TABLE: Record<'PRE' | 'ACTION' | 'POST' | 'FINAL', IPreludeSpec> = {
  PRE: DASHBOARD_SPA,
  ACTION: DASHBOARD_SPA,
  POST: PRELUDE_NONE,
  FINAL: PRELUDE_NONE,
};

/** DASHBOARD phase — BasePhase with PRE/ACTION/POST/FINAL. */
class DashboardPhase extends BasePhase {
  public readonly name = 'dashboard' as const;
  private readonly _preludeTable = DASHBOARD_PRELUDE_TABLE;

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

  /**
   * DASHBOARD requires SPA-ready before scanning navigation targets (PRE)
   * and before clicking (ACTION). Bank dashboards are SPA-heavy
   * (Backbase modules on Amex / Isracard); the click must land after JS
   * hydration so the SPA router responds.
   *
   * @param stage - The stage about to execute.
   * @returns SPA prelude for PRE / ACTION; none otherwise.
   */
  /**
   * DASHBOARD requires SPA-ready before scanning navigation targets (PRE)
   * and before clicking (ACTION). Bank dashboards are SPA-heavy
   * (Backbase modules on Amex / Isracard); the click must land after JS
   * hydration so the SPA router responds.
   *
   * @param stage - The stage about to execute.
   * @returns SPA prelude for PRE / ACTION; none otherwise.
   */
  protected override prelude(stage: 'PRE' | 'ACTION' | 'POST' | 'FINAL'): IPreludeSpec {
    return this._preludeTable[stage];
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
