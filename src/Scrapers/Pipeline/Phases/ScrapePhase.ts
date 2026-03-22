/**
 * Scrape phase — fetches accounts + transactions.
 * Supports two modes:
 *   1. IScrapeConfig — generic: bank provides URLs + mappers, executor does fetch
 *   2. CustomScrapeFn — edge cases: bank provides full function
 */

import type { IPipelineStep } from '../Types/Phase.js';
import type { IPipelineContext } from '../Types/PipelineContext.js';
import type { Procedure } from '../Types/Procedure.js';
import { succeed } from '../Types/Procedure.js';
import type { CustomScrapeFn, IScrapeConfig } from '../Types/ScrapeConfig.js';
import { executeScrape } from './ScrapeExecutor.js';

/**
 * Create a scrape step from an IScrapeConfig (generic mode).
 * @param config - The bank's scrape configuration.
 * @returns A pipeline step that fetches and maps transactions.
 */
function createConfigScrapeStep<TA, TT>(
  config: IScrapeConfig<TA, TT>,
): IPipelineStep<IPipelineContext, IPipelineContext> {
  const step: IPipelineStep<IPipelineContext, IPipelineContext> = {
    name: 'scrape',
    /** @inheritdoc */
    execute: (_ctx, input): Promise<Procedure<IPipelineContext>> => executeScrape(input, config),
  };
  return step;
}

/**
 * Create a scrape step from a custom function (edge case mode).
 * @param scrapeFn - The bank's custom scrape function.
 * @returns A pipeline step for scraping.
 */
function createCustomScrapeStep(
  scrapeFn: CustomScrapeFn,
): IPipelineStep<IPipelineContext, IPipelineContext> {
  const step: IPipelineStep<IPipelineContext, IPipelineContext> = {
    name: 'scrape',
    /** @inheritdoc */
    execute: (_ctx, input): Promise<Procedure<IPipelineContext>> => scrapeFn(input),
  };
  return step;
}

/**
 * Default stub — passes through for testing.
 * @param _ctx - Unused.
 * @param input - Passed through.
 * @returns Success with unchanged context.
 */
function stubScrape(
  _ctx: IPipelineContext,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  const result = succeed(input);
  return Promise.resolve(result);
}

/** Default stub step. */
const SCRAPE_STEP: IPipelineStep<IPipelineContext, IPipelineContext> = {
  name: 'scrape',
  execute: stubScrape,
};

export type { CustomScrapeFn } from '../Types/ScrapeConfig.js';
export default SCRAPE_STEP;
export { createConfigScrapeStep, createCustomScrapeStep, SCRAPE_STEP };
