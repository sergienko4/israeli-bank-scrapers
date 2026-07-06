/**
 * Pagi pipeline — Beinleumi group, same Mataf Angular portal. Browser
 * login with OTP + hard-model post-auth scrape. Replaces the generic
 * AUTH-DISCOVERY/ACCOUNT-RESOLVE/DASHBOARD chain with the Pagi hard model
 * (api-direct scrape): userData + accountType identity GETs, balances GET,
 * transactions list POST. balanceKind=account.
 */

import type { ScraperOptions } from '../../../Base/Interface.js';
import type { ILoginConfig } from '../../../Base/Interfaces/Config/LoginConfig.js';
import { createPipelineBuilder } from '../../Core/Builder/PipelineBuilderFactory.js';
import type { IPipelineDescriptor } from '../../Core/PipelineDescriptor.js';
import type { Procedure } from '../../Types/Procedure.js';
import { PAGI_SHAPE } from './scrape/PagiShape.js';

/** Pagi login config — credential keys only. WellKnown resolves selectors. */
const PAGI_LOGIN: ILoginConfig = {
  loginUrl: '',
  fields: [
    { credentialKey: 'username', selectors: [] },
    { credentialKey: 'password', selectors: [] },
  ],
  submit: [],
  possibleResults: { success: [] },
};

/**
 * Build the Pagi pipeline descriptor.
 * Post-auth data path uses the Pagi hard model (api-direct scrape)
 * instead of the generic AUTH-DISCOVERY/ACCOUNT-RESOLVE/DASHBOARD chain.
 * @param options - Scraper options from the user.
 * @returns Pipeline descriptor with OTP phase enabled.
 */
function buildPagiPipeline(options: ScraperOptions): Procedure<IPipelineDescriptor> {
  return createPipelineBuilder()
    .withOptions(options)
    .withBrowser()
    .withDeclarativeLogin(PAGI_LOGIN)
    .withOtpTrigger()
    .withOtpFill()
    .withBrowserApiDirect(PAGI_SHAPE)
    .build();
}

export default buildPagiPipeline;
export { buildPagiPipeline, PAGI_LOGIN };
