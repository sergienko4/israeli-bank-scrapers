/**
 * Pepper pipeline — API-native descriptor via the config-driven
 * API-DIRECT-CALL phase. The login surface is a data literal
 * (PEPPER_API_DIRECT_CALL); zero bank-side code beyond this
 * descriptor + graphql queries + scrape.
 */

// Side-effect import: register GraphQL queries into WK.
// URLs live in PIPELINE_BANK_CONFIG and are seeded by that module.
import './graphql/PepperQueries.js';

import type { ScraperOptions } from '../../../Base/Interface.js';
import { createPipelineBuilder } from '../../Core/Builder/PipelineBuilder.js';
import type { IPipelineDescriptor } from '../../Core/PipelineDescriptor.js';
import { PEPPER_API_DIRECT_CALL } from '../../Registry/Config/PipelineBankConfigPepper.js';
import type { Procedure } from '../../Types/Procedure.js';
import { pepperApiScrape } from './scrape/PepperScrape.js';

/**
 * Build the Pepper pipeline descriptor.
 * @param options - Scraper options from the user.
 * @returns Pipeline descriptor (Headless Strategy + config-driven API-DIRECT-CALL).
 */
function buildPepperPipeline(options: ScraperOptions): Procedure<IPipelineDescriptor> {
  return createPipelineBuilder()
    .withOptions(options)
    .withHeadlessMediator()
    .withConfigDrivenLogin(PEPPER_API_DIRECT_CALL)
    .withScraper(pepperApiScrape)
    .build();
}

export default buildPepperPipeline;
export { buildPepperPipeline };
