/**
 * Yahav pipeline — HTTP-only native-app login (device registration with a
 * client certificate, then the OAuth logon) + hard-model scrape against the
 * TCS BaNCS mobile API: a single multiplexed `/BaNCSDigitalApp/account` route
 * serves accounts, balance and transactions, differentiated by the request
 * `Payload`. balanceKind=account.
 */

import type { ScraperOptions } from '../../../Base/Interface.js';
import { createPipelineBuilder } from '../../Core/Builder/PipelineBuilderFactory.js';
import type { IPipelineDescriptor } from '../../Core/PipelineDescriptor.js';
import { YAHAV_API_DIRECT_CALL } from '../../Registry/Config/PipelineBankConfigYahav.js';
import type { Procedure } from '../../Types/Procedure.js';
import { YAHAV_SHAPE } from './scrape/YahavShape.js';

/**
 * Build the Yahav pipeline descriptor: the direct-API login runs
 * on the HTTP transport, then the hard-model scrape.
 * @param options - Scraper options from the user.
 * @returns Pipeline descriptor.
 */
function buildYahavPipeline(options: ScraperOptions): Procedure<IPipelineDescriptor> {
  return createPipelineBuilder()
    .withOptions(options)
    .withApiDirect(YAHAV_API_DIRECT_CALL, YAHAV_SHAPE)
    .build();
}

export default buildYahavPipeline;
export { buildYahavPipeline };
