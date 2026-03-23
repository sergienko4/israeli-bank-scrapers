/**
 * Discount pipeline config — TRULY MINIMAL.
 * Bank provides ONLY credential field names.
 * NO scraper file needed — generic auto-scrape via ctx.api + WellKnown.
 */

import { CompanyTypes } from '../../../../Definitions.js';
import type { ScraperOptions } from '../../../Base/Interface.js';
import type { ILoginConfig } from '../../../Base/Interfaces/Config/LoginConfig.js';
import { SCRAPER_CONFIGURATION } from '../../../Registry/Config/ScraperConfig.js';
import { createPipelineBuilder } from '../../PipelineBuilder.js';
import type { IPipelineDescriptor } from '../../PipelineDescriptor.js';
import type { Procedure } from '../../Types/Procedure.js';

const CFG = SCRAPER_CONFIGURATION.banks[CompanyTypes.Discount];

/** Discount login config — ONLY credential fields. Everything else is generic. */
const DISCOUNT_LOGIN: ILoginConfig = {
  loginUrl: CFG.urls.base || '',
  fields: [
    { credentialKey: 'id', selectors: [] },
    { credentialKey: 'password', selectors: [] },
    { credentialKey: 'num', selectors: [] },
  ],
  submit: [],
  possibleResults: { success: [] },
};

/**
 * Build the Discount pipeline descriptor.
 * NO withScraper — uses generic auto-scrape (ctx.api + WellKnown).
 * @param options - Scraper options from the user.
 * @returns Pipeline: init → home → login → dashboard → scrape → terminate.
 */
function buildDiscountPipeline(options: ScraperOptions): Procedure<IPipelineDescriptor> {
  return createPipelineBuilder()
    .withOptions(options)
    .withBrowser()
    .withDeclarativeLogin(DISCOUNT_LOGIN)
    .build();
}

export default buildDiscountPipeline;
export { buildDiscountPipeline, DISCOUNT_LOGIN };
