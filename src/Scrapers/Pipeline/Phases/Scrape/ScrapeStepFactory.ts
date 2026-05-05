/**
 * Scrape step factories — create pipeline steps for config and custom scrape.
 * Extracted from ScrapePhase.ts to respect max-lines.
 */

import { executeScrape } from '../../Strategy/Scrape/ScrapeExecutor.js';
import type { IPipelineStep } from '../../Types/Phase.js';
import type { IActionContext, IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import type { CustomScrapeFn, IScrapeConfig } from '../../Types/ScrapeConfig.js';

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
 * Default action — delegates to mediator's executeMatrixLoop.
 * @param _ctx - Unused.
 * @param input - Pipeline context.
 * @returns Updated context with scraped accounts.
 */
type ActionExecFn = (
  ctx: IActionContext,
  input: IActionContext,
) => Promise<Procedure<IActionContext>>;

export type { ActionExecFn };
export { createConfigScrapeStep, createCustomScrapeStep };
