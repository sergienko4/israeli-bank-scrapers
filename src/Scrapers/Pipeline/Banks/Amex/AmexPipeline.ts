/**
 * Amex pipeline — browser login (WAF bypass) + the Amex DigitalV3 hard
 * model for the post-auth data path. `withBrowserApiDirect` swaps the
 * generic AUTH-DISCOVERY/ACCOUNT-RESOLVE/DASHBOARD/SCRAPE/BALANCE-RESOLVE
 * chain for the single API-DIRECT-SCRAPE phase driving AMEX_SHAPE.
 */

import type { ScraperOptions } from '../../../Base/Interface.js';
import type { ILoginConfig } from '../../../Base/Interfaces/Config/LoginConfig.js';
import { createPipelineBuilder } from '../../Core/Builder/PipelineBuilderFactory.js';
import type { IPipelineDescriptor } from '../../Core/PipelineDescriptor.js';
import type { Procedure } from '../../Types/Procedure.js';
import { AMEX_SHAPE } from './scrape/AmexShape.js';

/** Amex login config — credential keys only. WellKnown resolves selectors. */
export const AMEX_LOGIN: ILoginConfig = {
  loginUrl: '',
  fields: [
    { credentialKey: 'id', selectors: [] },
    { credentialKey: 'password', selectors: [] },
    { credentialKey: 'card6Digits', selectors: [] },
  ],
  submit: [],
  possibleResults: { success: [] },
};

/**
 * Build the Amex pipeline descriptor.
 * Post-auth data path uses the Amex hard model (api-direct scrape)
 * instead of the generic AUTH-DISCOVERY/ACCOUNT-RESOLVE/DASHBOARD chain.
 * @param options - Scraper options from the user.
 * @returns Pipeline descriptor.
 */
function buildAmexPipeline(options: ScraperOptions): Procedure<IPipelineDescriptor> {
  return createPipelineBuilder()
    .withOptions(options)
    .withBrowser()
    .withDeclarativeLogin(AMEX_LOGIN)
    .withPreLogin()
    .withBrowserApiDirect(AMEX_SHAPE)
    .build();
}

export default buildAmexPipeline;
export { buildAmexPipeline };
