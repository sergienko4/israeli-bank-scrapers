/**
 * Pagi pipeline — Beinleumi group, same FIBI portal. HTTP-only
 * FIBI-family login (Transmit password, SMS code only when requested by the bank,
 * portal hand-off, SSO authorization) + hard-model scrape: userData +
 * accountType identity GETs, balances GET, transactions list POST.
 * balanceKind=account.
 */

import type { ScraperOptions } from '../../../Base/Interface.js';
import { createPipelineBuilder } from '../../Core/Builder/PipelineBuilderFactory.js';
import type { IPipelineDescriptor } from '../../Core/PipelineDescriptor.js';
import { PAGI_API_DIRECT_CALL } from '../../Registry/Config/PipelineBankConfigPagi.js';
import type { Procedure } from '../../Types/Procedure.js';
import { PAGI_SHAPE } from './scrape/PagiShape.js';

/**
 * Build the Pagi pipeline descriptor: the direct-API login runs
 * on the HTTP transport, then the hard-model scrape.
 * @param options - Scraper options from the user.
 * @returns Pipeline descriptor.
 */
function buildPagiPipeline(options: ScraperOptions): Procedure<IPipelineDescriptor> {
  return createPipelineBuilder()
    .withOptions(options)
    .withApiDirect(PAGI_API_DIRECT_CALL, PAGI_SHAPE)
    .build();
}

export default buildPagiPipeline;
export { buildPagiPipeline };
