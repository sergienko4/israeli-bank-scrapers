/**
 * Max pipeline — API-native descriptor: the config-driven API-DIRECT-CALL
 * phase primes the session and logs in with the username and password over
 * Max's web API, then the shape-driven API-DIRECT-SCRAPE phase reads cards,
 * each card's cycle debit and transactions. No browser is launched.
 */

import type { ScraperOptions } from '../../../Base/Interface.js';
import { createPipelineBuilder } from '../../Core/Builder/PipelineBuilderFactory.js';
import type { IPipelineDescriptor } from '../../Core/PipelineDescriptor.js';
import { MAX_API_DIRECT_CALL } from '../../Registry/Config/PipelineBankConfigMax.js';
import type { Procedure } from '../../Types/Procedure.js';
import { MAX_SHAPE } from './scrape/MaxShape.js';

/**
 * Build the Max pipeline descriptor.
 * @param options - Scraper options from the user.
 * @returns Pipeline descriptor (Headless Strategy + config-driven API-DIRECT-CALL).
 */
function buildMaxPipeline(options: ScraperOptions): Procedure<IPipelineDescriptor> {
  return createPipelineBuilder()
    .withOptions(options)
    .withHeadlessMediator()
    .withApiDirect(MAX_API_DIRECT_CALL, MAX_SHAPE)
    .build();
}

export default buildMaxPipeline;
export { buildMaxPipeline };
