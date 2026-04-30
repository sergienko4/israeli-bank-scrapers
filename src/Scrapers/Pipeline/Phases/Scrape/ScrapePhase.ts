/**
 * SCRAPE phase — thin orchestration, all logic in Mediator/Scrape.
 * PRE:    forensic priming + proxy qualification + diagnostics
 * ACTION: dispatch to genericAutoScrape (proxy or SPA path)
 * POST:   audit diagnostics (forensic audit table)
 * FINAL:  stamp account count for audit trail
 */

import { SCRAPE_POST_STEP } from '../../Mediator/Scrape/ForensicAuditAction.js';
import {
  executeForensicPre,
  executeMatrixLoop,
  executeStampAccounts,
  executeValidateResults,
} from '../../Mediator/Scrape/ScrapePhaseActions.js';
import {
  genericAutoScrape,
  loadDiscovered,
} from '../../Strategy/Scrape/GenericAutoScrapeStrategy.js';
import {
  findProxyAccountTemplate,
  findProxyTxnTemplate,
} from '../../Strategy/Scrape/Proxy/ProxyScrapeReplayStrategy.js';
import { BasePhase } from '../../Types/BasePhase.js';
import type { IPipelineStep } from '../../Types/Phase.js';
import type { IActionContext, IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { succeed } from '../../Types/Procedure.js';
import {
  type ActionExecFn,
  createConfigScrapeStep,
  createCustomScrapeStep,
} from './ScrapeStepFactory.js';

/**
 * Default action — delegates to mediator's executeMatrixLoop.
 * @param _ctx - Unused.
 * @param input - Sealed action context with fetchStrategy + scrapeDiscovery.
 * @returns Updated context with scraped accounts.
 */
function defaultAction(
  _ctx: IActionContext,
  input: IActionContext,
): Promise<Procedure<IActionContext>> {
  return executeMatrixLoop(input);
}

/** SCRAPE phase — BasePhase with PRE/ACTION/POST/FINAL. */
class ScrapePhase extends BasePhase {
  public readonly name = 'scrape' as const;
  private readonly _actionExec: ActionExecFn;

  /**
   * Create scrape phase with optional custom action.
   * @param actionExec - Custom action (default: genericAutoScrape via mediator).
   */
  constructor(actionExec?: ActionExecFn) {
    super();
    this._actionExec = actionExec ?? defaultAction;
  }

  /** @inheritdoc */
  public async pre(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    void this.name;
    return executeForensicPre(input);
  }

  /** @inheritdoc */
  public async action(
    ctx: IActionContext,
    input: IActionContext,
  ): Promise<Procedure<IActionContext>> {
    void this.name;
    return this._actionExec(ctx, input);
  }

  /** @inheritdoc */
  public async post(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    void this.name;
    return executeValidateResults(input);
  }

  /** @inheritdoc */
  public final(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    void this.name;
    return executeStampAccounts(input);
  }
}

/** Default auto-scrape step. */
const SCRAPE_STEP: IPipelineStep<IPipelineContext, IPipelineContext> = {
  name: 'scrape',
  /** @inheritdoc */
  execute: async (_ctx, input): Promise<Procedure<IPipelineContext>> => {
    const actionCtx = input as unknown as IActionContext;
    const result = await defaultAction(actionCtx, actionCtx);
    if (!result.success) return result;
    return succeed(input);
  },
};

/**
 * Create the full SCRAPE phase as a BasePhase with PRE/ACTION/POST/FINAL.
 * @param actionExec - Optional custom action execute function.
 * @returns ScrapePhase extending BasePhase.
 */
function createScrapePhase(actionExec?: ActionExecFn): ScrapePhase {
  return new ScrapePhase(actionExec);
}

export type { CustomScrapeFn } from '../../Types/ScrapeConfig.js';
export default SCRAPE_STEP;
export {
  createConfigScrapeStep,
  createCustomScrapeStep,
  createScrapePhase,
  loadDiscovered as fetchDiscovered,
  findProxyAccountTemplate,
  findProxyTxnTemplate,
  genericAutoScrape,
  SCRAPE_POST_STEP,
  SCRAPE_STEP,
  ScrapePhase,
};
