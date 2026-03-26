/**
 * Amex (American Express Israel) pipeline — single-file config.
 *
 * Mirrors DiscountPipeline.ts structure:
 *   createPipelineBuilder().withDeclarativeLogin(AMEX_LOGIN).build()
 *
 * Unique Amex fields vs Discount:
 *   card6Digits — 6-digit card number required at login
 *   checkReadiness — wait for WellKnown form fields before filling
 *   postAction — URL-change guard (SPA navigates away from /Login)
 *
 * Rule #11: Zero custom scraper logic. Auto-scrape via ctx.api + WellKnown.
 */

import type { Page } from 'playwright-core';

import { CompanyTypes } from '../../../../Definitions.js';
import type { ScraperOptions } from '../../../Base/Interface.js';
import type { LifecyclePromise } from '../../../Base/Interfaces/CallbackTypes.js';
import type { ILoginConfig } from '../../../Base/Interfaces/Config/LoginConfig.js';
import { SCRAPER_CONFIGURATION } from '../../../Registry/Config/ScraperConfig.js';
import { waitForFirstField } from '../../Phases/GenericPreLoginSteps.js';
import { createPipelineBuilder } from '../../PipelineBuilder.js';
import type { IPipelineDescriptor } from '../../PipelineDescriptor.js';
import type { Procedure } from '../../Types/Procedure.js';

const CFG = SCRAPER_CONFIGURATION.banks[CompanyTypes.Amex];

export const AMEX_LOGIN_URL = `${CFG.urls.base}/personalarea/Login`;

/** Timeout for post-login SPA navigation (ms). */
const POST_LOGIN_NAV_TIMEOUT = 30_000;

/**
 * Wait for a WellKnown credential field to appear before attempting to fill.
 * @param page - Active page.
 */
async function checkReadiness(page: Page): LifecyclePromise {
  await waitForFirstField(page);
}

/**
 * Guard on URL change after form submit — avoids networkidle false-timeout on SPA transitions.
 * @param page - Active page.
 */
async function postAction(page: Page): LifecyclePromise {
  const hasNavigatedAway = !page.url().includes('/personalarea/Login');
  if (!hasNavigatedAway) {
    await page
      .waitForURL(url => !url.pathname.includes('Login'), { timeout: POST_LOGIN_NAV_TIMEOUT })
      .catch(() => undefined);
  }
}

export const AMEX_LOGIN: ILoginConfig = {
  loginUrl: AMEX_LOGIN_URL,
  fields: [
    { credentialKey: 'id', selectors: [] },
    { credentialKey: 'password', selectors: [] },
    { credentialKey: 'card6Digits', selectors: [] },
  ],
  submit: [],
  checkReadiness,
  postAction,
  possibleResults: { success: [/personalarea\/(?!Login)/i], invalidPassword: [] },
};

/**
 * Build the Amex pipeline descriptor.
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
export { buildAmexPipeline };
