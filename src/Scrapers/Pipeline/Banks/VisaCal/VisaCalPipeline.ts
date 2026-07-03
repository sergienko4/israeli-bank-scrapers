/**
 * VisaCal pipeline — browser login (WAF bypass) + the VisaCal hard model
 * for the post-auth data path. `withBrowserApiDirect` swaps the generic
 * AUTH-DISCOVERY/ACCOUNT-RESOLVE/DASHBOARD/SCRAPE/BALANCE-RESOLVE chain
 * for the single API-DIRECT-SCRAPE phase driving VISACAL_SHAPE.
 */

import type { ScraperOptions } from '../../../Base/Interface.js';
import type { ILoginConfig } from '../../../Base/Interfaces/Config/LoginConfig.js';
import { createPipelineBuilder } from '../../Core/Builder/PipelineBuilderFactory.js';
import type { IPipelineDescriptor } from '../../Core/PipelineDescriptor.js';
import type { Procedure } from '../../Types/Procedure.js';
import { VISACAL_SHAPE } from './scrape/VisaCalShape.js';

/** VisaCal login config — credential keys only. WellKnown resolves selectors. */
const VISACAL_LOGIN: ILoginConfig = {
  loginUrl: 'https://www.cal-online.co.il/',
  fields: [
    { credentialKey: 'username', selectors: [] },
    { credentialKey: 'password', selectors: [] },
  ],
  submit: [],
  possibleResults: { success: [] },
};

/**
 * Build the VisaCal pipeline descriptor.
 * Post-auth data path uses the VisaCal hard model (api-direct scrape)
 * instead of the generic AUTH-DISCOVERY/ACCOUNT-RESOLVE/DASHBOARD chain.
 * @param options - Scraper options from the user.
 * @returns Pipeline descriptor.
 */
function buildVisaCalPipeline(options: ScraperOptions): Procedure<IPipelineDescriptor> {
  return createPipelineBuilder()
    .withOptions(options)
    .withBrowser()
    .withDeclarativeLogin(VISACAL_LOGIN)
    .withPreLogin()
    .withBrowserApiDirect(VISACAL_SHAPE)
    .build();
}

export default buildVisaCalPipeline;
export { buildVisaCalPipeline, VISACAL_LOGIN };
