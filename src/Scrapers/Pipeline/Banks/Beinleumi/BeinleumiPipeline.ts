/**
 * Beinleumi (FIBI) pipeline — browserless FIBI-family login (Transmit
 * password, SMS code only for an unknown device, portal hand-off, SSO
 * authorization) + hard-model scrape: userData + accountType identity GETs,
 * balances GET, transactions list POST. balanceKind=account.
 */

import type { ScraperOptions } from '../../../Base/Interface.js';
import { createPipelineBuilder } from '../../Core/Builder/PipelineBuilderFactory.js';
import type { IPipelineDescriptor } from '../../Core/PipelineDescriptor.js';
import { BEINLEUMI_API_DIRECT_CALL } from '../../Registry/Config/PipelineBankConfigBeinleumi.js';
import type { Procedure } from '../../Types/Procedure.js';
import { BEINLEUMI_SHAPE } from './scrape/BeinleumiShape.js';

/**
 * Build the Beinleumi pipeline descriptor: no browser; the direct-API login
 * runs on the headless transport, then the hard-model scrape.
 * @param options - Scraper options from the user.
 * @returns Pipeline descriptor.
 */
function buildBeinleumiPipeline(options: ScraperOptions): Procedure<IPipelineDescriptor> {
  return createPipelineBuilder()
    .withOptions(options)
    .withApiDirect(BEINLEUMI_API_DIRECT_CALL, BEINLEUMI_SHAPE)
    .build();
}

export default buildBeinleumiPipeline;
export { buildBeinleumiPipeline };
