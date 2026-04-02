/**
 * DASHBOARD phase — Hard-Gated Strategy-Driven Pipeline.
 * PRE step in DashboardPreStep.ts. POST step in DashboardPostStep.ts.
 * Action helpers in DashboardActions.ts.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { BasePhase } from '../../Types/BasePhase.js';
import { some } from '../../Types/Option.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import { executeDashboardAction, executeDashboardPost } from './DashboardActions.js';
import { executePre } from './DashboardPreStep.js';

export { probeDashboardReveal } from '../../Mediator/Dashboard/DashboardDiscovery.js';

/** DASHBOARD phase — Hard-Gated with BYPASS/TRIGGER strategy. */
class DashboardPhase extends BasePhase {
  public readonly name = 'dashboard' as const;

  /**
   * PRE: Resolve strategy + extract href for TRIGGER.
   * @param _ctx - Unused.
   * @param input - Pipeline context.
   * @returns Updated context.
   */
  public async pre(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    void this.name;
    if (!input.browser.has) return fail(ScraperErrorTypes.Generic, 'No browser for DASHBOARD PRE');
    if (!input.mediator.has)
      return fail(ScraperErrorTypes.Generic, 'No mediator for DASHBOARD PRE');
    return await executePre(input.mediator.value, input);
  }

  /**
   * ACTION: Execute strategy then build API context.
   * @param _ctx - Unused.
   * @param input - Pipeline context.
   * @returns Updated context with api populated.
   */
  public async action(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    void this.name;
    return await executeDashboardAction(input);
  }

  /**
   * POST: Validate traffic + change-password + store dashboard state.
   * @param _ctx - Unused.
   * @param input - Pipeline context.
   * @returns Updated context or hard failure.
   */
  public async post(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    void this.name;
    return await executeDashboardPost(input);
  }

  /**
   * SIGNAL: Validate PRIMED state.
   * @param _ctx - Unused.
   * @param input - Pipeline context.
   * @returns Succeed with finalUrl, fail if not ready.
   */
  public final(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    void this.name;
    if (!input.dashboard.has) {
      const err = fail(ScraperErrorTypes.Generic, 'DASHBOARD SIGNAL: not ready');
      return Promise.resolve(err);
    }
    const dashUrl = input.dashboard.value.pageUrl;
    const diag = { ...input.diagnostics, finalUrl: some(dashUrl) };
    const result = succeed({ ...input, diagnostics: diag });
    return Promise.resolve(result);
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
