/**
 * Isracard pipeline — browser login (WAF bypass) + the Isracard DigitalV3
 * hard model for the post-auth data path. `withBrowserApiDirect` swaps the
 * generic AUTH-DISCOVERY/ACCOUNT-RESOLVE/DASHBOARD/SCRAPE/BALANCE-RESOLVE
 * chain for the single API-DIRECT-SCRAPE phase driving ISRACARD_SHAPE.
 */

import type { ScraperOptions } from '../../../Base/Interface.js';
import type { ILoginConfig } from '../../../Base/Interfaces/Config/LoginConfig.js';
import { createPipelineBuilder } from '../../Core/Builder/PipelineBuilderFactory.js';
import type { IPipelineDescriptor } from '../../Core/PipelineDescriptor.js';
import type { Procedure } from '../../Types/Procedure.js';
import { ISRACARD_SHAPE } from './scrape/IsracardShape.js';

/** Isracard login config — credential keys only. WellKnown resolves selectors. */
export const ISRACARD_LOGIN: ILoginConfig = {
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
 * Build the Isracard pipeline descriptor.
 * Post-auth data path uses the Isracard hard model (api-direct scrape)
 * instead of the generic AUTH-DISCOVERY/ACCOUNT-RESOLVE/DASHBOARD chain.
 * @param options - Scraper options from the user.
 * @returns Pipeline descriptor.
 */
function buildIsracardPipeline(options: ScraperOptions): Procedure<IPipelineDescriptor> {
  return createPipelineBuilder()
    .withOptions(options)
    .withBrowser()
    .withDeclarativeLogin(ISRACARD_LOGIN)
    .withPreLogin()
    .withBrowserApiDirect(ISRACARD_SHAPE)
    .build();
}

export default buildIsracardPipeline;
export { buildIsracardPipeline };
