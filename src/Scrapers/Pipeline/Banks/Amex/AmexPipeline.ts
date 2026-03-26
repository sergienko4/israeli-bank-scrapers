/**
 * Amex (American Express Israel) pipeline config.
 *
 * ARCHITECTURE:
 *   Generic Home → Login (Pre/Action/Post) → Dashboard → Scrape flow.
 *   Credentials resolved by visible Hebrew text via WellKnown Mediator — zero hardcoded selectors.
 *
 * WELL-KNOWN MEDIATOR MAP (resolved at runtime by PIPELINE_WELL_KNOWN_LOGIN):
 *   ┌───────────┬──────────────────────────────┬─────────────────┐
 *   │ Field     │ Hebrew visible text           │ credentialKey   │
 *   ├───────────┼──────────────────────────────┼─────────────────┤
 *   │ ID        │ תעודת זהות / מספר זהות        │ id              │
 *   │ Password  │ סיסמה / קוד סודי              │ password        │
 *   │ Card6     │ 6 ספרות / ספרות הכרטיס        │ card6Digits     │
 *   └───────────┴──────────────────────────────┴─────────────────┘
 *
 * LIFECYCLE:
 *   checkReadiness → amexCheckReadiness  — waits for form fields (reuses generic WK probe)
 *   preAction      → (none)              — no Connect iframe; form is directly on the page
 *   postAction     → amexPostLogin       — guards on URL change, NOT networkidle
 *                                          avoids "Hapoalim False Timeout" on SPA transitions
 *
 * Rule #10: Zero direct Playwright selectors in this file.
 * Rule #11: Zero custom bank logic — everything via Mediator + WellKnown.
 */

import { CompanyTypes } from '../../../../Definitions.js';
import { amexCheckReadiness, amexPostLogin } from '../../../Amex/Config/AmexLoginConfig.js';
import type { ScraperOptions } from '../../../Base/Interface.js';
import type { ILoginConfig } from '../../../Base/Interfaces/Config/LoginConfig.js';
import { SCRAPER_CONFIGURATION } from '../../../Registry/Config/ScraperConfig.js';
import { createPipelineBuilder } from '../../PipelineBuilder.js';
import type { IPipelineDescriptor } from '../../PipelineDescriptor.js';
import type { Procedure } from '../../Types/Procedure.js';

const CFG = SCRAPER_CONFIGURATION.banks[CompanyTypes.Amex];

/**
 * Amex login URL — the portal's credential form (not the home page).
 * The HOME phase navigates here; LoginSteps fills fields via WellKnown mediator.
 */
const AMEX_LOGIN_URL = `${CFG.urls.base}/personalarea/Login`;

/**
 * Amex login config.
 *
 * Fields use selectors:[] — the mediator resolves each by visible Hebrew text
 * via PIPELINE_WELL_KNOWN_LOGIN fallback (id, password, card6Digits WK entries).
 *
 * submit:[] — mediator falls back to WellKnown __submit__ (xpath //button[contains(., "כניסה")]).
 *
 * checkReadiness/postAction are the only bank-specific hooks — both are navigation
 * guards, not HTML selectors.
 */
const AMEX_LOGIN: ILoginConfig = {
  loginUrl: AMEX_LOGIN_URL,
  fields: [
    { credentialKey: 'id', selectors: [] },
    { credentialKey: 'password', selectors: [] },
    { credentialKey: 'card6Digits', selectors: [] },
  ],
  submit: [],
  checkReadiness: amexCheckReadiness,
  postAction: amexPostLogin,
  possibleResults: {
    success: [/personalarea\/(?!Login)/i],
    invalidPassword: [],
  },
};

/**
 * Build the Amex pipeline descriptor.
 *
 * Chain: Init → Home → Login (Pre/Action/Post) → Dashboard → Scrape → Terminate
 *
 * The generic auto-scrape (ctx.api + WellKnown) handles account/txn discovery.
 * AmexMetadataExtractor maps the DashboardMonth response to IAmexCardAccount[].
 *
 * @param options - Scraper options from the user.
 * @returns Procedure wrapping the 6-phase pipeline descriptor.
 */
function buildAmexPipeline(options: ScraperOptions): Procedure<IPipelineDescriptor> {
  return createPipelineBuilder()
    .withOptions(options)
    .withBrowser()
    .withDeclarativeLogin(AMEX_LOGIN)
    .build();
}

export default buildAmexPipeline;
export { AMEX_LOGIN, AMEX_LOGIN_URL, buildAmexPipeline };
