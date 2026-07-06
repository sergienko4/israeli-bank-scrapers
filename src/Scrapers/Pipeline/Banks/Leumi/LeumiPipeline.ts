/**
 * Leumi pipeline — browser login (WAF bypass) + hard-model post-auth
 * data path. INIT/HOME/LOGIN stay generic; ACCOUNT-RESOLVE/DASHBOARD/
 * generic-SCRAPE/BALANCE-RESOLVE are replaced by the Leumi hard model
 * (WCF Broker api-direct scrape). No OTP.
 */

import type { ScraperOptions } from '../../../Base/Interface.js';
import type { ILoginConfig } from '../../../Base/Interfaces/Config/LoginConfig.js';
import { createPipelineBuilder } from '../../Core/Builder/PipelineBuilderFactory.js';
import type { IPipelineDescriptor } from '../../Core/PipelineDescriptor.js';
import type { Procedure } from '../../Types/Procedure.js';
import { LEUMI_SHAPE } from './scrape/LeumiShape.js';

/** Leumi login config — credential keys only. WellKnown resolves selectors. */
export const LEUMI_LOGIN: ILoginConfig = {
  loginUrl: '',
  fields: [
    { credentialKey: 'username', selectors: [] },
    { credentialKey: 'password', selectors: [] },
  ],
  submit: [],
  possibleResults: { success: [] },
};

/**
 * Build the Leumi pipeline descriptor.
 * Post-auth data path uses the Leumi hard model (api-direct WCF scrape)
 * instead of the generic AUTH-DISCOVERY/ACCOUNT-RESOLVE/DASHBOARD chain.
 * @param options - Scraper options from the user.
 * @returns Pipeline descriptor (browser + declarative login, no OTP).
 */
function buildLeumiPipeline(options: ScraperOptions): Procedure<IPipelineDescriptor> {
  return createPipelineBuilder()
    .withOptions(options)
    .withBrowser()
    .withDeclarativeLogin(LEUMI_LOGIN)
    .withBrowserApiDirect(LEUMI_SHAPE)
    .build();
}

export default buildLeumiPipeline;
export { buildLeumiPipeline };
