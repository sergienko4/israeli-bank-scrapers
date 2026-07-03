/**
 * Yahav pipeline — 100% generic, no OTP. BaNCS Digital backend.
 * GenericAutoScrape handles everything via network traffic discovery.
 * WellKnown resolves login selectors — num (visible label קוד משתמש),
 * nationalID (#pinno / תעודת זהות), password — and success/error indicators.
 * Zero hardcoded selectors, zero legacy imports.
 */

import type { ScraperOptions } from '../../../Base/Interface.js';
import type { ILoginConfig } from '../../../Base/Interfaces/Config/LoginConfig.js';
import { createPipelineBuilder } from '../../Core/Builder/PipelineBuilderFactory.js';
import type { IPipelineDescriptor } from '../../Core/PipelineDescriptor.js';
import type { Procedure } from '../../Types/Procedure.js';

/** Yahav login fields — credential keys only. WellKnown resolves selectors. */
const YAHAV_LOGIN: ILoginConfig = {
  loginUrl: 'https://www.yahav.co.il',
  fields: [
    { credentialKey: 'num', selectors: [] },
    { credentialKey: 'nationalID', selectors: [] },
    { credentialKey: 'password', selectors: [] },
  ],
  submit: [],
  possibleResults: { success: [] },
};

/**
 * Build the Yahav pipeline descriptor.
 * @param options - Scraper options from the user.
 * @returns Pipeline descriptor (browser + declarative login, no OTP).
 */
function buildYahavPipeline(options: ScraperOptions): Procedure<IPipelineDescriptor> {
  return createPipelineBuilder()
    .withOptions(options)
    .withBrowser()
    .withDeclarativeLogin(YAHAV_LOGIN)
    .build();
}

export default buildYahavPipeline;
export { buildYahavPipeline, YAHAV_LOGIN };
