/**
 * Mercantile pipeline — browser login + hard-model post-auth scrape.
 * Shares Discount's Titan tenant (start.telebank.co.il); the API
 * contract is identical (upstream MercantileScraper extends
 * DiscountScraper — only the `bank=m` login differs).
 */

import type { ScraperOptions } from '../../../Base/Interface.js';
import type { ILoginConfig } from '../../../Base/Interfaces/Config/LoginConfig.js';
import { createPipelineBuilder } from '../../Core/Builder/PipelineBuilderFactory.js';
import type { IPipelineDescriptor } from '../../Core/PipelineDescriptor.js';
import type { Procedure } from '../../Types/Procedure.js';
import { MERCANTILE_SHAPE } from './scrape/MercantileShape.js';

/** Mercantile login config — credential keys only. WellKnown resolves selectors. */
export const MERCANTILE_LOGIN: ILoginConfig = {
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
 * Build the Mercantile pipeline descriptor.
 * Post-auth data path uses the Mercantile hard model (api-direct scrape)
 * instead of the generic AUTH-DISCOVERY/ACCOUNT-RESOLVE/DASHBOARD chain.
 * Contract is identical to Discount (shared Titan tenant; only the
 * `bank=m` login differs, handled by the browser login phase).
 * @param options - Scraper options from the user.
 * @returns Pipeline descriptor.
 */
function buildMercantilePipeline(options: ScraperOptions): Procedure<IPipelineDescriptor> {
  return createPipelineBuilder()
    .withOptions(options)
    .withBrowser()
    .withDeclarativeLogin(MERCANTILE_LOGIN)
    .withBrowserApiDirect(MERCANTILE_SHAPE)
    .build();
}

export default buildMercantilePipeline;
export { buildMercantilePipeline };
