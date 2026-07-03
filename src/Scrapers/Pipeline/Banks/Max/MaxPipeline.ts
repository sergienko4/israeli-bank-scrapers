/**
 * Max pipeline — browser login (WAF bypass) + the Max registered-API hard
 * model for the post-auth data path. `withBrowserApiDirect` swaps the generic
 * AUTH-DISCOVERY/ACCOUNT-RESOLVE/DASHBOARD/SCRAPE/BALANCE-RESOLVE chain for the
 * single API-DIRECT-SCRAPE phase driving MAX_SHAPE.
 */

import type { ScraperOptions } from '../../../Base/Interface.js';
import type { ILoginConfig } from '../../../Base/Interfaces/Config/LoginConfig.js';
import { createPipelineBuilder } from '../../Core/Builder/PipelineBuilderFactory.js';
import type { IPipelineDescriptor } from '../../Core/PipelineDescriptor.js';
import type { Procedure } from '../../Types/Procedure.js';
import { MAX_SHAPE } from './scrape/MaxShape.js';

/** Max login config — credential keys only. WellKnown resolves selectors. */
export const MAX_LOGIN: ILoginConfig = {
  loginUrl: '',
  fields: [
    { credentialKey: 'username', selectors: [] },
    { credentialKey: 'password', selectors: [] },
  ],
  submit: [],
  possibleResults: { success: [] },
};

/**
 * Build the Max pipeline descriptor.
 * Post-auth data path uses the Max hard model (api-direct scrape)
 * instead of the generic AUTH-DISCOVERY/ACCOUNT-RESOLVE/DASHBOARD chain.
 * @param options - Scraper options from the user.
 * @returns Pipeline descriptor.
 */
function buildMaxPipeline(options: ScraperOptions): Procedure<IPipelineDescriptor> {
  return createPipelineBuilder()
    .withOptions(options)
    .withBrowser()
    .withDeclarativeLogin(MAX_LOGIN)
    .withPreLogin()
    .withBrowserApiDirect(MAX_SHAPE)
    .build();
}

export default buildMaxPipeline;
export { buildMaxPipeline };
