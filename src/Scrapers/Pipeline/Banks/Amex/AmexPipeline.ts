/**
 * Amex pipeline config — MINIMAL.
 * Generic HOME → LOGIN → SCRAPE flow.
 * Bank provides ONLY credential field names.
 * Everything else via mediator + WellKnown (black box).
 */

import { CompanyTypes } from '../../../../Definitions.js';
import type { ScraperOptions } from '../../../Base/Interface.js';
import type { ILoginConfig } from '../../../Base/Interfaces/Config/LoginConfig.js';
import { SCRAPER_CONFIGURATION } from '../../../Registry/Config/ScraperConfig.js';
import { createPipelineBuilder } from '../../PipelineBuilder.js';
import type { IPipelineDescriptor } from '../../PipelineDescriptor.js';
import type { Procedure } from '../../Types/Procedure.js';

const CFG = SCRAPER_CONFIGURATION.banks[CompanyTypes.Amex];

/** Amex login config — ONLY credential fields. Everything else is generic. */
const AMEX_LOGIN: ILoginConfig = {
  loginUrl: CFG.urls.base || '',
  fields: [
    { credentialKey: 'id', selectors: [] },
    { credentialKey: 'password', selectors: [] },
    { credentialKey: 'card6Digits', selectors: [] },
  ],
  submit: [],
  possibleResults: { success: [] },
};

/**
 * Build the Amex pipeline descriptor.
 * NO withScraper — uses generic auto-scrape (ctx.api + WellKnown).
 * @param options - Scraper options from the user.
 * @returns Pipeline: init → home → login → dashboard → scrape → terminate.
 */
function buildAmexPipeline(options: ScraperOptions): Procedure<IPipelineDescriptor> {
  return createPipelineBuilder()
    .withOptions(options)
    .withBrowser()
    .withDeclarativeLogin(AMEX_LOGIN)
    .build();
}

export default buildAmexPipeline;
export { AMEX_LOGIN, buildAmexPipeline };
