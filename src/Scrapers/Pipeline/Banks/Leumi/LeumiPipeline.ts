/**
 * Leumi pipeline — native API-direct login and WCF scraping, no browser.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { ScraperOptions } from '../../../Base/Interface.js';
import { createPipelineBuilder } from '../../Core/Builder/PipelineBuilderFactory.js';
import type { IPipelineDescriptor } from '../../Core/PipelineDescriptor.js';
import { LEUMI_API_DIRECT_CALL } from '../../Registry/Config/PipelineBankConfigLeumi.js';
import { fail, type Procedure } from '../../Types/Procedure.js';
import { LEUMI_SHAPE } from './scrape/LeumiShape.js';

/**
 * Builds the registered native descriptor.
 * Post-auth data path uses the Leumi hard model (api-direct WCF scrape).
 * @param options - Scraper options from the user.
 * @returns Browserless pipeline descriptor.
 */
function buildLeumiNativePipeline(options: ScraperOptions): Procedure<IPipelineDescriptor> {
  const start = options.startDate;
  const time = start instanceof Date ? start.getTime() : Number.NaN;
  if (!Number.isFinite(time)) {
    return fail(ScraperErrorTypes.Generic, 'Leumi startDate must be a valid date');
  }
  return createPipelineBuilder()
    .withOptions(options)
    .withHeadlessMediator()
    .withApiDirect(LEUMI_API_DIRECT_CALL, LEUMI_SHAPE)
    .build();
}

export default buildLeumiNativePipeline;
export { buildLeumiNativePipeline };
