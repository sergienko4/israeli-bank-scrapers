/**
 * Mizrahi pipeline — API-native descriptor: the config-driven API-DIRECT-CALL
 * phase logs in with the username and password over Mizrahi's web API and
 * hands the session to the online-banking host, then the shape-driven
 * API-DIRECT-SCRAPE phase switches to each account and reads its balance and
 * transactions. No browser is launched.
 */

import type { ScraperOptions } from '../../../Base/Interface.js';
import { createPipelineBuilder } from '../../Core/Builder/PipelineBuilderFactory.js';
import type { IPipelineDescriptor } from '../../Core/PipelineDescriptor.js';
import { MIZRAHI_API_DIRECT_CALL } from '../../Registry/Config/PipelineBankConfigMizrahi.js';
import type { Procedure } from '../../Types/Procedure.js';
import { MIZRAHI_SHAPE } from './scrape/MizrahiShape.js';

/**
 * Build the Mizrahi pipeline descriptor.
 * @param options - Scraper options from the user.
 * @returns Pipeline descriptor (Headless Strategy + config-driven API-DIRECT-CALL).
 */
function buildMizrahiPipeline(options: ScraperOptions): Procedure<IPipelineDescriptor> {
  return createPipelineBuilder()
    .withOptions(options)
    .withApiDirect(MIZRAHI_API_DIRECT_CALL, MIZRAHI_SHAPE)
    .build();
}

export default buildMizrahiPipeline;
export { buildMizrahiPipeline };
