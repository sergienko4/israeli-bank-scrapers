/**
 * Hapoalim pipeline — browser login (no OTP) + hard-model post-auth
 * scrape. Replaces the generic AUTH-DISCOVERY/ACCOUNT-RESOLVE/DASHBOARD
 * chain with the Hapoalim hard model (api-direct scrape): accounts +
 * balance GET, transactions anti-replay POST. balanceKind=account.
 */

import type { ScraperOptions } from '../../../Base/Interface.js';
import type { ILoginConfig } from '../../../Base/Interfaces/Config/LoginConfig.js';
import { createPipelineBuilder } from '../../Core/Builder/PipelineBuilderFactory.js';
import type { IPipelineDescriptor } from '../../Core/PipelineDescriptor.js';
import type { Procedure } from '../../Types/Procedure.js';
import { HAPOALIM_SHAPE } from './scrape/HapoalimShape.js';

/** Hapoalim login config — credential keys only. WellKnown resolves selectors. */
const HAPOALIM_LOGIN: ILoginConfig = {
  loginUrl: '',
  fields: [
    { credentialKey: 'userCode', selectors: [] },
    { credentialKey: 'password', selectors: [] },
  ],
  submit: [],
  possibleResults: { success: [] },
};

/**
 * Build the Hapoalim pipeline descriptor.
 * Post-auth data path uses the Hapoalim hard model (api-direct scrape)
 * instead of the generic AUTH-DISCOVERY/ACCOUNT-RESOLVE/DASHBOARD chain.
 * @param options - Scraper options from the user.
 * @returns Pipeline descriptor — no OTP.
 */
function buildHapoalimPipeline(options: ScraperOptions): Procedure<IPipelineDescriptor> {
  return createPipelineBuilder()
    .withOptions(options)
    .withBrowser()
    .withDeclarativeLogin(HAPOALIM_LOGIN)
    .withOtpFill(false)
    .withBrowserApiDirect(HAPOALIM_SHAPE)
    .build();
}

export default buildHapoalimPipeline;
export { buildHapoalimPipeline, HAPOALIM_LOGIN };
