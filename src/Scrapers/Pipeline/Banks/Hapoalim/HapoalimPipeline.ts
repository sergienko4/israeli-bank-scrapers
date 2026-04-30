/**
 * Hapoalim pipeline — generic with no OTP.
 * GenericAutoScrape handles everything via network traffic discovery.
 */

import type { ScraperOptions } from '../../../Base/Interface.js';
import type { ILoginConfig } from '../../../Base/Interfaces/Config/LoginConfig.js';
import { createPipelineBuilder } from '../../Core/Builder/PipelineBuilder.js';
import type { IPipelineDescriptor } from '../../Core/PipelineDescriptor.js';
import type { Procedure } from '../../Types/Procedure.js';

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
 * @param options - Scraper options from the user.
 * @returns Pipeline descriptor — no OTP.
 */
function buildHapoalimPipeline(options: ScraperOptions): Procedure<IPipelineDescriptor> {
  return createPipelineBuilder()
    .withOptions(options)
    .withBrowser()
    .withDeclarativeLogin(HAPOALIM_LOGIN)
    .withLoginAndOptCodeFill()
    .build();
}

export default buildHapoalimPipeline;
export { buildHapoalimPipeline };
