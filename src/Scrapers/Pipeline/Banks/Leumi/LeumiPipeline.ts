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
 * Checks whether scraper options carry a finite startDate.
 * @param options - Scraper options from the user.
 * @returns True when startDate is a valid Date instance.
 */
function hasValidStartDate(options: ScraperOptions): boolean {
  const start = options.startDate;
  if (!(start instanceof Date)) return false;
  const time = start.getTime();
  return Number.isFinite(time);
}

/**
 * Builds the registered native descriptor.
 * Post-auth data path uses the Leumi hard model (api-direct WCF scrape).
 * @param options - Scraper options from the user.
 * @returns Browserless pipeline descriptor.
 */
function buildLeumiNativePipeline(options: ScraperOptions): Procedure<IPipelineDescriptor> {
  if (!hasValidStartDate(options)) {
    return fail(ScraperErrorTypes.Generic, 'Leumi startDate must be a valid date');
  }
  return createPipelineBuilder()
    .withOptions(options)
    .withApiDirect(LEUMI_API_DIRECT_CALL, LEUMI_SHAPE)
    .build();
}

export default buildLeumiNativePipeline;
export { buildLeumiNativePipeline };
