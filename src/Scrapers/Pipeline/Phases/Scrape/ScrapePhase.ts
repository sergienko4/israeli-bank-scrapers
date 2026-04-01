/**
 * Scrape phase — fetches accounts + transactions.
 * Supports three modes:
 *   1. GenericAutoScrape — no bank code: uses ctx.api + WellKnown
 *   2. IScrapeConfig — bank provides URLs + mappers
 *   3. CustomScrapeFn — bank provides full function
 */

import { SCRAPE_POST_STEP } from '../../Mediator/Scrape/ForensicAuditAction.js';
import {
  genericAutoScrape,
  loadDiscovered,
} from '../../Strategy/Scrape/GenericAutoScrapeStrategy.js';
import {
  findProxyAccountTemplate,
  findProxyTxnTemplate,
} from '../../Strategy/Scrape/ProxyScrapeReplayStrategy.js';
import { executeScrape } from '../../Strategy/ScrapeExecutor.js';
import type { IPipelineStep } from '../../Types/Phase.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import type { CustomScrapeFn, IScrapeConfig } from '../../Types/ScrapeConfig.js';
import { SCRAPE_PRE_STEP } from './ScrapeDiscoveryStep.js';
import { createScrapePhase } from './ScrapePhaseImpl.js';

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

/**
 * Default auto-scrape execute handler.
 * @param _ctx - Unused.
 * @param input - Pipeline context with ctx.api.
 * @returns Updated context with scraped accounts.
 */
function autoScrapeExecute(
  _ctx: IPipelineContext,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  return genericAutoScrape(input);
}

/** Default auto-scrape step. */
const SCRAPE_STEP: IPipelineStep<IPipelineContext, IPipelineContext> = {
  name: 'scrape',
  execute: autoScrapeExecute,
};

/**
 * Create the full SCRAPE phase as a BasePhase with PRE/ACTION/POST.
 * @param actionExec - Optional custom action execute function.
 * @returns ScrapePhase extending SimplePhase with pre/post overrides.
 */
function createScrapePhaseWithDefaults(
  actionExec: IPipelineStep<IPipelineContext, IPipelineContext>['execute'] = autoScrapeExecute,
): ReturnType<typeof createScrapePhase> {
  return createScrapePhase(actionExec);
}

export type { CustomScrapeFn } from '../../Types/ScrapeConfig.js';
export default SCRAPE_STEP;
export {
  createConfigScrapeStep,
  createCustomScrapeStep,
  createScrapePhaseWithDefaults as createScrapePhase,
  loadDiscovered as fetchDiscovered,
  findProxyAccountTemplate,
  findProxyTxnTemplate,
  genericAutoScrape,
  SCRAPE_POST_STEP,
  SCRAPE_PRE_STEP,
  SCRAPE_STEP,
};
