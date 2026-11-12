/**
 * Isracard pipeline — API-native descriptor: the config-driven
 * API-DIRECT-CALL phase logs in over the ring app API (ID, card suffix and
 * password on a cold run; a stored device key resumes the session on a warm
 * run), then the shape-driven API-DIRECT-SCRAPE phase reads cards, the next
 * debit and transactions. All calls use HTTP.
 */

import type { ScraperOptions } from '../../../Base/Interface.js';
import { createPipelineBuilder } from '../../Core/Builder/PipelineBuilderFactory.js';
import type { IPipelineDescriptor } from '../../Core/PipelineDescriptor.js';
import { ISRACARD_API_DIRECT_CALL } from '../../Registry/Config/PipelineBankConfigIsracard.js';
import type { Procedure } from '../../Types/Procedure.js';
import { ISRACARD_SHAPE } from './scrape/IsracardShape.js';

/**
 * Build the Isracard pipeline descriptor.
 * @param options - Scraper options from the user.
 * @returns Pipeline descriptor (HTTP transport + config-driven API-DIRECT-CALL).
 */
function buildIsracardPipeline(options: ScraperOptions): Procedure<IPipelineDescriptor> {
  return createPipelineBuilder()
    .withOptions(options)
    .withApiDirect(ISRACARD_API_DIRECT_CALL, ISRACARD_SHAPE)
    .build();
}

export default buildIsracardPipeline;
export { buildIsracardPipeline };
