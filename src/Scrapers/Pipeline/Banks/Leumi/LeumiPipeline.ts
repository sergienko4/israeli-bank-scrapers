/**
 * Leumi pipeline — 100% generic, no OTP.
 * GenericAutoScrape handles everything via network traffic discovery.
 */

import type { ScraperOptions } from '../../../Base/Interface.js';
import type { ILoginConfig } from '../../../Base/Interfaces/Config/LoginConfig.js';
import { createPipelineBuilder } from '../../Core/Builder/PipelineBuilderFactory.js';
import type { IPipelineDescriptor } from '../../Core/PipelineDescriptor.js';
import type { Procedure } from '../../Types/Procedure.js';

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
 * @param options - Scraper options from the user.
 * @returns Pipeline descriptor (browser + declarative login, no OTP).
 */
function buildLeumiPipeline(options: ScraperOptions): Procedure<IPipelineDescriptor> {
  return createPipelineBuilder()
    .withOptions(options)
    .withBrowser()
    .withDeclarativeLogin(LEUMI_LOGIN)
    .build();
}

export default buildLeumiPipeline;
export { buildLeumiPipeline };
