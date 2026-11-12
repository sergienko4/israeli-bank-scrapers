/**
 * Discount pipeline — API-native descriptor: the config-driven
 * API-DIRECT-CALL phase logs in with the id, password and user code over the
 * bank's web API and opens the retail app, then the shape-driven
 * API-DIRECT-SCRAPE phase reads the Titan accounts, balances and
 * transactions. All calls use HTTP.
 */

import type { ScraperOptions } from '../../../Base/Interface.js';
import { createPipelineBuilder } from '../../Core/Builder/PipelineBuilderFactory.js';
import type { IPipelineDescriptor } from '../../Core/PipelineDescriptor.js';
import { DISCOUNT_API_DIRECT_CALL } from '../../Registry/Config/PipelineBankConfigDiscount.js';
import type { Procedure } from '../../Types/Procedure.js';
import { DISCOUNT_SHAPE } from './scrape/DiscountShape.js';

/**
 * Build the Discount pipeline descriptor: the direct-API login
 * runs on the HTTP transport, then the hard-model scrape.
 * @param options - Scraper options from the user.
 * @returns Pipeline descriptor.
 */
function buildDiscountPipeline(options: ScraperOptions): Procedure<IPipelineDescriptor> {
  return createPipelineBuilder()
    .withOptions(options)
    .withApiDirect(DISCOUNT_API_DIRECT_CALL, DISCOUNT_SHAPE)
    .build();
}

export default buildDiscountPipeline;
export { buildDiscountPipeline };
