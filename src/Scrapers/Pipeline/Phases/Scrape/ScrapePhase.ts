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
import { executeScrape } from '../../Strategy/Scrape/ScrapeExecutor.js';
import { BasePhase } from '../../Types/BasePhase.js';
import type { IPipelineStep } from '../../Types/Phase.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import type { CustomScrapeFn, IScrapeConfig } from '../../Types/ScrapeConfig.js';

/** Action execute function signature. */
type ActionExecFn = (
  ctx: IPipelineContext,
  input: IPipelineContext,
) => Promise<Procedure<IPipelineContext>>;

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
    ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
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

/**
 * Default action — delegates to mediator's executeMatrixLoop.
 * @param _ctx - Unused.
 * @param input - Pipeline context.
 * @returns Updated context with scraped accounts.
 */
function defaultAction(
  _ctx: IPipelineContext,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  return executeMatrixLoop(input);
}

/**
 * Create a scrape step from IScrapeConfig.
 * @param config - The bank's scrape configuration.
 * @returns A pipeline step that fetches transactions.
 */
function createConfigScrapeStep<TA, TT>(
  config: IScrapeConfig<TA, TT>,
): IPipelineStep<IPipelineContext, IPipelineContext> {
  return {
    name: 'scrape',
    /** @inheritdoc */
    execute: async (_ctx, input): Promise<Procedure<IPipelineContext>> =>
      await executeScrape(input, config),
  };
}

/**
 * Create a scrape step from a custom function.
 * @param scrapeFn - The bank's custom scrape function.
 * @returns A pipeline step for scraping.
 */
function createCustomScrapeStep(
  scrapeFn: CustomScrapeFn,
): IPipelineStep<IPipelineContext, IPipelineContext> {
  return {
    name: 'scrape',
    /** @inheritdoc */
    execute: (_ctx, input): Promise<Procedure<IPipelineContext>> => scrapeFn(input),
  };
}

/** Default auto-scrape step. */
const SCRAPE_STEP: IPipelineStep<IPipelineContext, IPipelineContext> = {
  name: 'scrape',
  execute: defaultAction,
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
