/**
 * Massad pipeline — Beinleumi group, same Mataf Angular portal. Browser
 * login with OTP + hard-model post-auth scrape. Replaces the generic
 * AUTH-DISCOVERY/ACCOUNT-RESOLVE/DASHBOARD chain with the Massad hard
 * model (api-direct scrape): userData + accountType identity GETs,
 * balances GET, transactions list POST. balanceKind=account.
 */

import type { ScraperOptions } from '../../../Base/Interface.js';
import type { ILoginConfig } from '../../../Base/Interfaces/Config/LoginConfig.js';
import { createPipelineBuilder } from '../../Core/Builder/PipelineBuilderFactory.js';
import type { IPipelineDescriptor } from '../../Core/PipelineDescriptor.js';
import type { Procedure } from '../../Types/Procedure.js';
import { MASSAD_SHAPE } from './scrape/MassadShape.js';

/** Massad login config — credential keys only. WellKnown resolves selectors. */
const MASSAD_LOGIN: ILoginConfig = {
  loginUrl: '',
  fields: [
    { credentialKey: 'username', selectors: [] },
    { credentialKey: 'password', selectors: [] },
  ],
  submit: [],
  possibleResults: { success: [] },
};

/**
 * Build the Massad pipeline descriptor.
 * Post-auth data path uses the Massad hard model (api-direct scrape)
 * instead of the generic AUTH-DISCOVERY/ACCOUNT-RESOLVE/DASHBOARD chain.
 * @param options - Scraper options from the user.
 * @returns Pipeline descriptor with OTP phase enabled.
 */
function buildMassadPipeline(options: ScraperOptions): Procedure<IPipelineDescriptor> {
  return createPipelineBuilder()
    .withOptions(options)
    .withBrowser()
    .withDeclarativeLogin(MASSAD_LOGIN)
    .withOtpTrigger()
    .withOtpFill()
    .withBrowserApiDirect(MASSAD_SHAPE)
    .build();
}

export default buildMassadPipeline;
export { buildMassadPipeline, MASSAD_LOGIN };
