/**
 * Isracard pipeline config — INDEPENDENT from AmexPipeline.
 *
 * ARCHITECTURE:
 *   Generic Home → Login (Pre/Action/Post) → Dashboard → Scrape flow.
 *   Credentials resolved by visible Hebrew text via WellKnown Mediator — zero CSS.
 *
 * ISRACARD WELL-KNOWN MEDIATOR MAP (resolved at runtime by PIPELINE_WELL_KNOWN_LOGIN):
 *   ┌───────────┬────────────────────────────────┬─────────────────┐
 *   │ Field     │ Hebrew visible text             │ credentialKey   │
 *   ├───────────┼────────────────────────────────┼─────────────────┤
 *   │ ID        │ תעודת זהות / מספר זהות          │ id              │
 *   │ Password  │ סיסמה / קוד כניסה               │ password        │
 *   │ Card 6    │ 6 ספרות / ספרות הכרטיס          │ card6Digits     │
 *   └───────────┴────────────────────────────────┴─────────────────┘
 *
 * LIFECYCLE COMPARISON (Amex vs Isracard — both independent):
 *   ┌──────────────────┬────────────────────────────┬──────────────────────────────┐
 *   │ Hook             │ Amex                       │ Isracard                     │
 *   ├──────────────────┼────────────────────────────┼──────────────────────────────┤
 *   │ checkReadiness   │ waitForFirstField (WK)     │ waitForLoadState (DOM ready) │
 *   │ preAction        │ (none — form on-page)      │ (none — form on-page)        │
 *   │ postAction       │ waitForURL (SPA navigates) │ waitForSelector + popup close│
 *   └──────────────────┴────────────────────────────┴──────────────────────────────┘
 *
 * Rule #10: Zero direct Playwright calls in this file. All HTML via Mediator/Config.
 * Rule #11: Zero custom bank logic — WellKnown drives all field resolution.
 */

import { CompanyTypes } from '../../../../Definitions.js';
import type { ScraperOptions } from '../../../Base/Interface.js';
import type { ILoginConfig } from '../../../Base/Interfaces/Config/LoginConfig.js';
import {
  isracardCheckReadiness,
  isracardPostLogin,
} from '../../../Isracard/Config/IsracardLoginConfig.js';
import { SCRAPER_CONFIGURATION } from '../../../Registry/Config/ScraperConfig.js';
import { createPipelineBuilder } from '../../PipelineBuilder.js';
import type { IPipelineDescriptor } from '../../PipelineDescriptor.js';
import type { Procedure } from '../../Types/Procedure.js';

const CFG = SCRAPER_CONFIGURATION.banks[CompanyTypes.Isracard];

/**
 * Isracard login URL — the personal-area credential form.
 * HOME phase navigates here; LoginSteps fills fields via WellKnown mediator.
 */
const ISRACARD_LOGIN_URL = `${CFG.urls.base}/personalarea/Login`;

/**
 * Isracard login config.
 *
 * submit:[] — mediator falls back to WellKnown __submit__ (xpath //button[contains(., "כניסה")]).
 * preAction is not needed — no Connect iframe, the form is directly on the page.
 * postAction uses waitForSelector (not waitForURL) for Isracard SPA behaviour.
 */
const ISRACARD_LOGIN: ILoginConfig = {
  loginUrl: ISRACARD_LOGIN_URL,
  fields: [
    { credentialKey: 'id', selectors: [] },
    { credentialKey: 'password', selectors: [] },
    { credentialKey: 'card6Digits', selectors: [] },
  ],
  submit: [],
  checkReadiness: isracardCheckReadiness,
  postAction: isracardPostLogin,
  possibleResults: {
    success: [/personalarea\/(?!Login)/i],
    invalidPassword: [],
  },
};

/**
 * Build the Isracard pipeline descriptor.
 *
 * Chain: Init → Home → Login (Pre/Action/Post) → Dashboard → Scrape → Terminate
 *
 * The generic auto-scrape (ctx.api + WellKnown) handles account/txn discovery.
 * IsracardMetadataExtractor maps the DashboardMonth response to IIsracardCardAccount[].
 *
 * @param options - Scraper options from the user.
 * @returns Procedure wrapping the 6-phase pipeline descriptor.
 */
function buildIsracardPipeline(options: ScraperOptions): Procedure<IPipelineDescriptor> {
  return createPipelineBuilder()
    .withOptions(options)
    .withBrowser()
    .withDeclarativeLogin(ISRACARD_LOGIN)
    .build();
}

export default buildIsracardPipeline;
export { buildIsracardPipeline, ISRACARD_LOGIN, ISRACARD_LOGIN_URL };
