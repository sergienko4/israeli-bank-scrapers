/**
 * Beinleumi (FIBI) pipeline — browser login with OTP + hard-model
 * post-auth scrape. Replaces the generic
 * AUTH-DISCOVERY/ACCOUNT-RESOLVE/DASHBOARD chain with the Beinleumi hard
 * model (api-direct scrape): userData + accountType identity GETs,
 * balances GET, transactions list POST. balanceKind=account.
 */

import type { ScraperOptions } from '../../../Base/Interface.js';
import type { ILoginConfig } from '../../../Base/Interfaces/Config/LoginConfig.js';
import { createPipelineBuilder } from '../../Core/Builder/PipelineBuilderFactory.js';
import type { IPipelineDescriptor } from '../../Core/PipelineDescriptor.js';
import type { Procedure } from '../../Types/Procedure.js';
import { BEINLEUMI_SHAPE } from './scrape/BeinleumiShape.js';

/** Beinleumi login config — credential keys only. WellKnown resolves selectors. */
export const BEINLEUMI_LOGIN: ILoginConfig = {
  loginUrl: '',
  fields: [
    { credentialKey: 'username', selectors: [] },
    { credentialKey: 'password', selectors: [] },
  ],
  submit: [],
  possibleResults: { success: [] },
};

/**
 * Build the Beinleumi pipeline descriptor.
 * Post-auth data path uses the Beinleumi hard model (api-direct scrape)
 * instead of the generic AUTH-DISCOVERY/ACCOUNT-RESOLVE/DASHBOARD chain.
 * @param options - Scraper options from the user.
 * @returns Pipeline descriptor with OTP phase enabled.
 */
function buildBeinleumiPipeline(options: ScraperOptions): Procedure<IPipelineDescriptor> {
  return createPipelineBuilder()
    .withOptions(options)
    .withBrowser()
    .withDeclarativeLogin(BEINLEUMI_LOGIN)
    .withOtpTrigger()
    .withOtpFill()
    .withBrowserApiDirect(BEINLEUMI_SHAPE)
    .build();
}

export default buildBeinleumiPipeline;
export { buildBeinleumiPipeline };
