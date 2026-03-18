/**
 * Scrape phase — wraps bank-specific fetchData function.
 * Stub: returns succeed(input) until Step 3.
 */

import type { IPipelineStep } from '../Types/Phase.js';
import type { IPipelineContext } from '../Types/PipelineContext.js';
import type { Procedure } from '../Types/Procedure.js';
import { succeed } from '../Types/Procedure.js';

/**
 * Stub: execute bank-specific transaction scraping.
 * @param _ctx - Pipeline context (unused in stub).
 * @param input - Input context to pass through.
 * @returns Success with unchanged context.
 */
function executeScrape(
  _ctx: IPipelineContext,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  const result = succeed(input);
  return Promise.resolve(result);
}

/** Scrape step — executes bank-specific transaction fetching. */
const SCRAPE_STEP: IPipelineStep<IPipelineContext, IPipelineContext> = {
  name: 'scrape',
  execute: executeScrape,
};

export default SCRAPE_STEP;
export { SCRAPE_STEP };
