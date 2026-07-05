/**
 * Yahav pipeline — browser login (no OTP) + hard-model post-auth scrape.
 * Replaces the generic AUTH-DISCOVERY/ACCOUNT-RESOLVE/DASHBOARD chain with the
 * Yahav TCS BaNCS hard model (api-direct scrape): a single multiplexed
 * `/BaNCSDigitalApp/account` endpoint serves accounts, balance and
 * transactions, differentiated by the request `Payload`. balanceKind=account.
 * Login fields carry NO bank-specific selectors: each resolves purely through
 * the shared visible-text WellKnown (LoginWK) — num → `קוד משתמש`,
 * nationalID → `תעודת זהות`, password → `input[type=password]`. Yahav's form
 * hides its visible labels in `aria-hidden` sibling spans (empty `<label>`s,
 * `" "` placeholders), so LoginWK carries `textContent` variants whose
 * walk-up reaches the input; the `nationalID` concept is mapped to the
 * `nationalId` slot there. Zero CSS, zero legacy imports.
 */

import type { ScraperOptions } from '../../../Base/Interface.js';
import type { ILoginConfig } from '../../../Base/Interfaces/Config/LoginConfig.js';
import { createPipelineBuilder } from '../../Core/Builder/PipelineBuilderFactory.js';
import type { IPipelineDescriptor } from '../../Core/PipelineDescriptor.js';
import type { Procedure } from '../../Types/Procedure.js';
import { YAHAV_SHAPE } from './scrape/YahavShape.js';

/** Yahav login fields — resolved entirely via shared WellKnown (no CSS). */
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
    .withBrowserApiDirect(YAHAV_SHAPE)
    .build();
}

export default buildYahavPipeline;
export { buildYahavPipeline, YAHAV_LOGIN };
