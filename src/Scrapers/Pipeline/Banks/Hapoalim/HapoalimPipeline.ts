/**
 * Hapoalim pipeline — HTTP-only direct-API login (sealed password, SMS
 * OTP when the bank asks) + hard-model scrape: accounts + balance GET,
 * transactions anti-replay POST. balanceKind=account.
 */

import type { ScraperOptions } from '../../../Base/Interface.js';
import { createPipelineBuilder } from '../../Core/Builder/PipelineBuilderFactory.js';
import type { IPipelineDescriptor } from '../../Core/PipelineDescriptor.js';
import { HAPOALIM_API_DIRECT_CALL } from '../../Registry/Config/PipelineBankConfigHapoalim.js';
import type { Procedure } from '../../Types/Procedure.js';
import { HAPOALIM_SHAPE } from './scrape/HapoalimShape.js';

/**
 * Build the Hapoalim pipeline descriptor: the direct-API login
 * runs on the HTTP transport, then the hard-model scrape.
 * @param options - Scraper options from the user.
 * @returns Pipeline descriptor.
 */
function buildHapoalimPipeline(options: ScraperOptions): Procedure<IPipelineDescriptor> {
  return createPipelineBuilder()
    .withOptions(options)
    .withApiDirect(HAPOALIM_API_DIRECT_CALL, HAPOALIM_SHAPE)
    .build();
}

export default buildHapoalimPipeline;
export { buildHapoalimPipeline };
