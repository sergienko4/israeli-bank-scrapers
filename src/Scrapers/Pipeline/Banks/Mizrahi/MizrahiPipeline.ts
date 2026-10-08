/**
 * Mizrahi pipeline — browser login (username + password, no OTP) + the
 * hard-model API-direct scrape. INIT/HOME/LOGIN stay generic: HOME reveals
 * the login modal and LOGIN fills the same-origin login iframe. After
 * login, `.withBrowserApiDirect(MIZRAHI_SHAPE)` replaces the generic
 * discovery chain with Mizrahi's exact `mto` API calls.
 */

import type { ScraperOptions } from '../../../Base/Interface.js';
import type { ILoginConfig } from '../../../Base/Interfaces/Config/LoginConfig.js';
import { createPipelineBuilder } from '../../Core/Builder/PipelineBuilderFactory.js';
import type { IPipelineDescriptor } from '../../Core/PipelineDescriptor.js';
import type { Procedure } from '../../Types/Procedure.js';
import { MIZRAHI_SHAPE } from './scrape/MizrahiShape.js';

/** Mizrahi login config — credential keys only. WellKnown resolves selectors. */
export const MIZRAHI_LOGIN: ILoginConfig = {
  loginUrl: '',
  fields: [
    { credentialKey: 'username', selectors: [] },
    { credentialKey: 'password', selectors: [] },
  ],
  submit: [],
  possibleResults: { success: [] },
};

/**
 * Build the Mizrahi pipeline descriptor.
 * @param options - Scraper options from the user.
 * @returns Pipeline descriptor (browser + declarative login + hard model, no OTP).
 */
function buildMizrahiPipeline(options: ScraperOptions): Procedure<IPipelineDescriptor> {
  return createPipelineBuilder()
    .withOptions(options)
    .withBrowser()
    .withDeclarativeLogin(MIZRAHI_LOGIN)
    .withBrowserApiDirect(MIZRAHI_SHAPE)
    .build();
}

export default buildMizrahiPipeline;
export { buildMizrahiPipeline };
