/**
 * Yahav pipeline — browserless native-app login (device registration with a
 * client certificate, then the OAuth logon) + hard-model scrape against the
 * TCS BaNCS mobile API: a single multiplexed `/BaNCSDigitalApp/account` route
 * serves accounts, balance and transactions, differentiated by the request
 * `Payload`. balanceKind=account.
 *
 * `YAHAV_LOGIN` (the retired website form) stays exported for the shared
 * login-config table until the browser path is removed.
 */

import type { ScraperOptions } from '../../../Base/Interface.js';
import type { ILoginConfig } from '../../../Base/Interfaces/Config/LoginConfig.js';
import { createPipelineBuilder } from '../../Core/Builder/PipelineBuilderFactory.js';
import type { IPipelineDescriptor } from '../../Core/PipelineDescriptor.js';
import { YAHAV_API_DIRECT_CALL } from '../../Registry/Config/PipelineBankConfigYahav.js';
import type { Procedure } from '../../Types/Procedure.js';
import { YAHAV_SHAPE } from './scrape/YahavShape.js';

/** Yahav website login fields — resolved entirely via shared WellKnown (no CSS). */
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
 * Build the Yahav pipeline descriptor: no browser; the direct-API login runs
 * on the headless transport, then the hard-model scrape.
 * @param options - Scraper options from the user.
 * @returns Pipeline descriptor.
 */
function buildYahavPipeline(options: ScraperOptions): Procedure<IPipelineDescriptor> {
  return createPipelineBuilder()
    .withOptions(options)
    .withHeadlessMediator()
    .withApiDirect(YAHAV_API_DIRECT_CALL, YAHAV_SHAPE)
    .build();
}

export default buildYahavPipeline;
export { buildYahavPipeline, YAHAV_LOGIN };
