/**
 * Otsar Hahayal pipeline — Beinleumi group, same FIBI portal. Browserless
 * FIBI-family login (Transmit password, SMS code only when requested by the bank,
 * portal hand-off, SSO authorization) + hard-model scrape: userData +
 * accountType identity GETs, balances GET, transactions list POST.
 * balanceKind=account.
 */

import type { ScraperOptions } from '../../../Base/Interface.js';
import { createPipelineBuilder } from '../../Core/Builder/PipelineBuilderFactory.js';
import type { IPipelineDescriptor } from '../../Core/PipelineDescriptor.js';
import { OTSAR_HAHAYAL_API_DIRECT_CALL } from '../../Registry/Config/PipelineBankConfigOtsarHahayal.js';
import type { Procedure } from '../../Types/Procedure.js';
import { OTSAR_HAHAYAL_SHAPE } from './scrape/OtsarHahayalShape.js';

/**
 * Build the Otsar Hahayal pipeline descriptor: no browser; the direct-API
 * login runs on the headless transport, then the hard-model scrape.
 * @param options - Scraper options from the user.
 * @returns Pipeline descriptor.
 */
function buildOtsarHahayalPipeline(options: ScraperOptions): Procedure<IPipelineDescriptor> {
  return createPipelineBuilder()
    .withOptions(options)
    .withHeadlessMediator()
    .withApiDirect(OTSAR_HAHAYAL_API_DIRECT_CALL, OTSAR_HAHAYAL_SHAPE)
    .build();
}

export default buildOtsarHahayalPipeline;
export { buildOtsarHahayalPipeline };
