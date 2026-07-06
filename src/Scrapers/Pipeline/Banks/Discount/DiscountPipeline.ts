/**
 * Discount pipeline — portal redirect handled by PRE-LOGIN phase.
 * All URLs resolved from ctx.config at runtime. Zero hardcoded strings.
 * PRE-LOGIN reads ctx.config.urls.portalUrl and navigates there.
 */

import type { ScraperOptions } from '../../../Base/Interface.js';
import type { ILoginConfig } from '../../../Base/Interfaces/Config/LoginConfig.js';
import { createPipelineBuilder } from '../../Core/Builder/PipelineBuilderFactory.js';
import type { IPipelineDescriptor } from '../../Core/PipelineDescriptor.js';
import type { Procedure } from '../../Types/Procedure.js';
import { DISCOUNT_SHAPE } from './scrape/DiscountShape.js';

/** Discount login fields — credential keys only. WellKnown resolves selectors. */
const DISCOUNT_LOGIN: ILoginConfig = {
  loginUrl: 'https://www.discountbank.co.il',
  fields: [
    { credentialKey: 'id', selectors: [] },
    { credentialKey: 'password', selectors: [] },
    { credentialKey: 'num', selectors: [] },
  ],
  submit: [],
  possibleResults: { success: [] },
};

/**
 * Build the Discount pipeline descriptor.
 * Portal redirect handled by PRE-LOGIN reading ctx.config.urls.portalUrl.
 * Post-auth data path uses the Discount hard model (api-direct scrape)
 * instead of the generic AUTH-DISCOVERY/ACCOUNT-RESOLVE/DASHBOARD chain.
 * @param options - Scraper options from the user.
 * @returns Pipeline descriptor.
 */
function buildDiscountPipeline(options: ScraperOptions): Procedure<IPipelineDescriptor> {
  return createPipelineBuilder()
    .withOptions(options)
    .withBrowser()
    .withDeclarativeLogin(DISCOUNT_LOGIN)
    .withBrowserApiDirect(DISCOUNT_SHAPE)
    .build();
}

export default buildDiscountPipeline;
export { buildDiscountPipeline, DISCOUNT_LOGIN };
