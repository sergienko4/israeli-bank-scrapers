/**
 * Mercantile pipeline — API-native descriptor: the config-driven
 * API-DIRECT-CALL phase logs in with the id, password and user code over the
 * bank's web API and opens the retail app, then the shape-driven
 * API-DIRECT-SCRAPE phase reads the Titan accounts, balances and
 * transactions. Mercantile shares Discount's Telebank flow; only its brand
 * values differ. No browser is launched.
 */

import type { ScraperOptions } from '../../../Base/Interface.js';
import type { ILoginConfig } from '../../../Base/Interfaces/Config/LoginConfig.js';
import { createPipelineBuilder } from '../../Core/Builder/PipelineBuilderFactory.js';
import type { IPipelineDescriptor } from '../../Core/PipelineDescriptor.js';
import { MERCANTILE_API_DIRECT_CALL } from '../../Registry/Config/PipelineBankConfigMercantile.js';
import type { Procedure } from '../../Types/Procedure.js';
import { MERCANTILE_SHAPE } from './scrape/MercantileShape.js';

/**
 * Mercantile browser login fields — credential keys only. No longer wired;
 * kept for the browser integration fixtures until they are removed.
 */
const MERCANTILE_LOGIN: ILoginConfig = {
  loginUrl: '',
  fields: [
    { credentialKey: 'id', selectors: [] },
    { credentialKey: 'password', selectors: [] },
    { credentialKey: 'num', selectors: [] },
  ],
  submit: [],
  possibleResults: { success: [] },
};

/**
 * Build the Mercantile pipeline descriptor: no browser; the direct-API login
 * runs on the headless transport, then the hard-model scrape.
 * @param options - Scraper options from the user.
 * @returns Pipeline descriptor.
 */
function buildMercantilePipeline(options: ScraperOptions): Procedure<IPipelineDescriptor> {
  return createPipelineBuilder()
    .withOptions(options)
    .withHeadlessMediator()
    .withApiDirect(MERCANTILE_API_DIRECT_CALL, MERCANTILE_SHAPE)
    .build();
}

export default buildMercantilePipeline;
export { buildMercantilePipeline, MERCANTILE_LOGIN };
