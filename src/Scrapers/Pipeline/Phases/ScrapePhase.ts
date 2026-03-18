/**
 * Scrape phase — calls a bank-provided scrape function.
 * Each bank extracts its fetchData() into a standalone function.
 * Default stub passes through for testing.
 */

import type { IPipelineStep } from '../Types/Phase.js';
import type { IPipelineContext } from '../Types/PipelineContext.js';
import type { Procedure } from '../Types/Procedure.js';
import { succeed } from '../Types/Procedure.js';

/** Bank-provided scrape function signature. */
type ScrapeFn = (ctx: IPipelineContext) => Promise<Procedure<IPipelineContext>>;

/**
 * Create a scrape step bound to a bank-provided function.
 * @param scrapeFn - The bank's transaction fetching function.
 * @returns A pipeline step for scraping.
 */
function createScrapeStep(scrapeFn: ScrapeFn): IPipelineStep<IPipelineContext, IPipelineContext> {
  return {
    name: 'scrape',
    /** @inheritdoc */
    execute: (_ctx, input) => scrapeFn(input),
  };
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

export type { ScrapeFn };
export default SCRAPE_STEP;
export { createScrapeStep, SCRAPE_STEP };
