/**
 * Leumi pipelines — native API-direct login and WCF scraping, plus the
 * retained browser descriptor for existing browser-flow contract tests.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { ScraperOptions } from '../../../Base/Interface.js';
import type { ILoginConfig } from '../../../Base/Interfaces/Config/LoginConfig.js';
import { createPipelineBuilder } from '../../Core/Builder/PipelineBuilderFactory.js';
import type { IPipelineDescriptor } from '../../Core/PipelineDescriptor.js';
import { LEUMI_API_DIRECT_CALL } from '../../Registry/Config/PipelineBankConfigLeumi.js';
import { fail, type Procedure } from '../../Types/Procedure.js';
import { LEUMI_SHAPE } from './scrape/LeumiShape.js';

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
 * Post-auth data path uses the Leumi hard model (api-direct WCF scrape)
 * instead of the generic AUTH-DISCOVERY/ACCOUNT-RESOLVE/DASHBOARD chain.
 * @param options - Scraper options from the user.
 * @returns Pipeline descriptor (browser + declarative login, no OTP).
 */
function buildLeumiPipeline(options: ScraperOptions): Procedure<IPipelineDescriptor> {
  return createPipelineBuilder()
    .withOptions(options)
    .withBrowser()
    .withDeclarativeLogin(LEUMI_LOGIN)
    .withBrowserApiDirect(LEUMI_SHAPE)
    .build();
}

/**
 * Builds the registered native descriptor.
 * @param options - Scraper options from the user.
 * @returns Browserless pipeline descriptor.
 */
function buildLeumiNativePipeline(options: ScraperOptions): Procedure<IPipelineDescriptor> {
  const start = options.startDate;
  const time = start instanceof Date ? start.getTime() : Number.NaN;
  if (!Number.isFinite(time)) {
    return fail(ScraperErrorTypes.Generic, 'Leumi startDate must be a valid date');
  }
  return createPipelineBuilder()
    .withOptions(options)
    .withHeadlessMediator()
    .withApiDirect(LEUMI_API_DIRECT_CALL, LEUMI_SHAPE)
    .build();
}

export default buildLeumiPipeline;
export { buildLeumiNativePipeline, buildLeumiPipeline };
