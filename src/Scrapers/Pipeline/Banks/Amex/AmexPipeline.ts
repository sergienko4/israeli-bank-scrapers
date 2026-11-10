/**
 * Amex pipeline — API-native descriptor: the config-driven
 * API-DIRECT-CALL phase logs in over the ring app API (ID, card suffix and
 * password on a cold run; a stored device key resumes the session on a warm
 * run), then the shape-driven API-DIRECT-SCRAPE phase reads cards, the next
 * debit and transactions. No browser is launched.
 */

import type { ScraperOptions } from '../../../Base/Interface.js';
import { createPipelineBuilder } from '../../Core/Builder/PipelineBuilderFactory.js';
import type { IPipelineDescriptor } from '../../Core/PipelineDescriptor.js';
import { AMEX_API_DIRECT_CALL } from '../../Registry/Config/PipelineBankConfigAmex.js';
import type { Procedure } from '../../Types/Procedure.js';
import { AMEX_SHAPE } from './scrape/AmexShape.js';

/**
 * Build the Amex pipeline descriptor.
 * @param options - Scraper options from the user.
 * @returns Pipeline descriptor (Headless Strategy + config-driven API-DIRECT-CALL).
 */
function buildAmexPipeline(options: ScraperOptions): Procedure<IPipelineDescriptor> {
  return createPipelineBuilder()
    .withOptions(options)
    .withApiDirect(AMEX_API_DIRECT_CALL, AMEX_SHAPE)
    .build();
}

export default buildAmexPipeline;
export { buildAmexPipeline };
