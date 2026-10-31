/**
 * Hapoalim pipeline — browserless direct-API login (sealed password, SMS
 * OTP when the bank asks) + hard-model scrape: accounts + balance GET,
 * transactions anti-replay POST. balanceKind=account.
 */

import type { ScraperOptions } from '../../../Base/Interface.js';
import type { ILoginConfig } from '../../../Base/Interfaces/Config/LoginConfig.js';
import { createPipelineBuilder } from '../../Core/Builder/PipelineBuilderFactory.js';
import type { IPipelineDescriptor } from '../../Core/PipelineDescriptor.js';
import { HAPOALIM_API_DIRECT_CALL } from '../../Registry/Config/PipelineBankConfigHapoalim.js';
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
 * Build the Hapoalim pipeline descriptor: no browser; the direct-API login
 * runs on the headless transport, then the hard-model scrape.
 * @param options - Scraper options from the user.
 * @returns Pipeline descriptor.
 */
function buildHapoalimPipeline(options: ScraperOptions): Procedure<IPipelineDescriptor> {
  return createPipelineBuilder()
    .withOptions(options)
    .withHeadlessMediator()
    .withApiDirect(HAPOALIM_API_DIRECT_CALL, HAPOALIM_SHAPE)
    .build();
}

export default buildHapoalimPipeline;
export { buildHapoalimPipeline, HAPOALIM_LOGIN };
