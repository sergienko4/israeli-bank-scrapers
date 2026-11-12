/**
 * VisaCal pipeline — API-native descriptor: the config-driven
 * API-DIRECT-CALL phase logs in over CAL's login API (username + password
 * on a cold run; a stored login hash resumes the session on a warm run),
 * then the shape-driven API-DIRECT-SCRAPE phase reads cards, balances and
 * transactions. All calls use HTTP.
 */

import type { ScraperOptions } from '../../../Base/Interface.js';
import { createPipelineBuilder } from '../../Core/Builder/PipelineBuilderFactory.js';
import type { IPipelineDescriptor } from '../../Core/PipelineDescriptor.js';
import { VISACAL_API_DIRECT_CALL } from '../../Registry/Config/PipelineBankConfigVisaCal.js';
import type { Procedure } from '../../Types/Procedure.js';
import { VISACAL_SHAPE } from './scrape/VisaCalShape.js';

/**
 * Build the VisaCal pipeline descriptor.
 * @param options - Scraper options from the user.
 * @returns Pipeline descriptor (HTTP transport + config-driven API-DIRECT-CALL).
 */
function buildVisaCalPipeline(options: ScraperOptions): Procedure<IPipelineDescriptor> {
  return createPipelineBuilder()
    .withOptions(options)
    .withApiDirect(VISACAL_API_DIRECT_CALL, VISACAL_SHAPE)
    .build();
}

export default buildVisaCalPipeline;
export { buildVisaCalPipeline };
