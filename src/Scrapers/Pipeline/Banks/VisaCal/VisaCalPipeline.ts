/**
 * VisaCal pipeline config — MINIMAL.
 * Generic HOME → LOGIN → SCRAPE flow.
 * Credentials are generic (WellKnown text-based).
 * Lifecycle hooks reused from VISACAL_LOGIN_CONFIG — no duplication.
 */

import { CompanyTypes } from '../../../../Definitions.js';
import type { ScraperOptions } from '../../../Base/Interface.js';
import type { ILoginConfig } from '../../../Base/Interfaces/Config/LoginConfig.js';
import { SCRAPER_CONFIGURATION } from '../../../Registry/Config/ScraperConfig.js';
import { VISACAL_LOGIN_CONFIG } from '../../../VisaCal/Config/VisaCalLoginConfig.js';
import { createPipelineBuilder } from '../../PipelineBuilder.js';
import type { IPipelineDescriptor } from '../../PipelineDescriptor.js';
import type { Procedure } from '../../Types/Procedure.js';

const CFG = SCRAPER_CONFIGURATION.banks[CompanyTypes.VisaCal];

/**
 * VisaCal login config — generic credentials + reused lifecycle hooks.
 * submit: [] → mediator falls back to WellKnown __submit__ (xpath //button[contains(., "כניסה")]).
 * checkReadiness/preAction/postAction reused from old config — zero duplication.
 */
const VISACAL_LOGIN: ILoginConfig = {
  loginUrl: CFG.urls.base || '',
  fields: [
    { credentialKey: 'username', selectors: [] },
    { credentialKey: 'password', selectors: [] },
  ],
  submit: [],
  checkReadiness: VISACAL_LOGIN_CONFIG.checkReadiness,
  preAction: VISACAL_LOGIN_CONFIG.preAction,
  postAction: VISACAL_LOGIN_CONFIG.postAction,
  possibleResults: VISACAL_LOGIN_CONFIG.possibleResults,
};

/**
 * Build the VisaCal pipeline descriptor.
 * NO withScraper — uses generic auto-scrape (ctx.api + WellKnown).
 * @param options - Scraper options from the user.
 * @returns Pipeline: init → home → login → dashboard → scrape → terminate.
 */
function buildVisaCalPipeline(options: ScraperOptions): Procedure<IPipelineDescriptor> {
  return createPipelineBuilder()
    .withOptions(options)
    .withBrowser()
    .withDeclarativeLogin(VISACAL_LOGIN)
    .build();
}

export default buildVisaCalPipeline;
export { buildVisaCalPipeline, VISACAL_LOGIN };
