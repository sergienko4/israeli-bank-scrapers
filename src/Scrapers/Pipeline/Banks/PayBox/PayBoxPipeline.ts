/**
 * PayBox pipeline — API-native descriptor via the config-driven
 * API-DIRECT-CALL phase + the shape-driven API-DIRECT-SCRAPE phase.
 *
 * The login surface is a data literal (PAYBOX_API_DIRECT_CALL); zero
 * bank-side code beyond this descriptor + scrape shape. PayBox is
 * REST-only post-login — no GraphQL queries to register.
 */

import type { ScraperOptions } from '../../../Base/Interface.js';
import { createPipelineBuilder } from '../../Core/Builder/PipelineBuilderFactory.js';
import type { IPipelineDescriptor } from '../../Core/PipelineDescriptor.js';
import { PAYBOX_API_DIRECT_CALL } from '../../Registry/Config/PipelineBankConfigPayBox.js';
import type { Procedure } from '../../Types/Procedure.js';
import { PAYBOX_SHAPE } from './scrape/PayBoxShape.js';

/**
 * Build the PayBox pipeline descriptor.
 * @param options - Scraper options from the user.
 * @returns Pipeline descriptor (Headless Strategy + config-driven API-DIRECT-CALL).
 */
function buildPayBoxPipeline(options: ScraperOptions): Procedure<IPipelineDescriptor> {
  return createPipelineBuilder()
    .withOptions(options)
    .withHeadlessMediator()
    .withApiDirect(PAYBOX_API_DIRECT_CALL, PAYBOX_SHAPE)
    .build();
}

export default buildPayBoxPipeline;
export { buildPayBoxPipeline };
