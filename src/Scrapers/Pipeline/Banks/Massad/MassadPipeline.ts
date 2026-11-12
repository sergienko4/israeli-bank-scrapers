/**
 * Massad pipeline — Beinleumi group, same FIBI portal. HTTP-only
 * FIBI-family login (Transmit password, SMS code only for an unknown device,
 * portal hand-off, SSO authorization) + hard-model scrape: userData +
 * accountType identity GETs, balances GET, transactions list POST.
 * balanceKind=account.
 */

import type { ScraperOptions } from '../../../Base/Interface.js';
import { createPipelineBuilder } from '../../Core/Builder/PipelineBuilderFactory.js';
import type { IPipelineDescriptor } from '../../Core/PipelineDescriptor.js';
import { MASSAD_API_DIRECT_CALL } from '../../Registry/Config/PipelineBankConfigMassad.js';
import type { Procedure } from '../../Types/Procedure.js';
import { MASSAD_SHAPE } from './scrape/MassadShape.js';

/**
 * Build the Massad pipeline descriptor: the direct-API login
 * runs on the HTTP transport, then the hard-model scrape.
 * @param options - Scraper options from the user.
 * @returns Pipeline descriptor.
 */
function buildMassadPipeline(options: ScraperOptions): Procedure<IPipelineDescriptor> {
  return createPipelineBuilder()
    .withOptions(options)
    .withApiDirect(MASSAD_API_DIRECT_CALL, MASSAD_SHAPE)
    .build();
}

export default buildMassadPipeline;
export { buildMassadPipeline };
