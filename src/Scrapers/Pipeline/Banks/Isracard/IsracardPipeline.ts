/**
 * Isracard pipeline — single-file config.
 *
 * Mirrors DiscountPipeline.ts structure:
 *   createPipelineBuilder().withDeclarativeLogin(ISRACARD_LOGIN).build()
 *
 * Unique Isracard fields vs Discount:
 *   card6Digits — 6-digit card number required at login
 *   checkReadiness — wait for DOM-ready (domcontentloaded)
 *   postAction — waitForSelector guard + welcome popup dismiss
 *
 * Rule #11: Zero custom scraper logic. Auto-scrape via ctx.api + WellKnown.
 */

import type { Locator, Page } from 'playwright-core';

import { CompanyTypes } from '../../../../Definitions.js';
import type { ScraperOptions } from '../../../Base/Interface.js';
import type { LifecyclePromise } from '../../../Base/Interfaces/CallbackTypes.js';
import type { ILoginConfig } from '../../../Base/Interfaces/Config/LoginConfig.js';
import { SCRAPER_CONFIGURATION } from '../../../Registry/Config/ScraperConfig.js';
import { createPipelineBuilder } from '../../PipelineBuilder.js';
import type { IPipelineDescriptor } from '../../PipelineDescriptor.js';
import type { Procedure } from '../../Types/Procedure.js';

const CFG = SCRAPER_CONFIGURATION.banks[CompanyTypes.Isracard];

/** Dashboard indicator text — confirms the user landed on the personal area. */
const DASHBOARD_INDICATOR = 'עסקאות';

/** Timeout waiting for dashboard to appear after login (ms). */
const DASHBOARD_WAIT_MS = 35_000;

/** Candidate close-button texts for welcome popups (most specific first). */
const POPUP_CLOSE_TEXTS = ['סגור', 'ביטול', 'המשך', 'close', 'OK'];

/**
 * Click the first visible welcome-popup close button (checked in parallel, no await-in-loop).
 * @param page - Active page.
 */
async function dismissWelcomePopup(page: Page): LifecyclePromise {
  const locators: Locator[] = POPUP_CLOSE_TEXTS.map(text =>
    page.getByText(text, { exact: true }).first(),
  );
  const visibilityChecks = locators.map(btn => btn.isVisible().catch(() => false));
  const visibilities = await Promise.all(visibilityChecks);
  const visibleBtn = locators.find((_, i) => visibilities[i]);
  if (visibleBtn) {
    await visibleBtn.click().catch(() => undefined);
  }
}

/**
 * Wait for DOM-ready state — Isracard form renders synchronously on load.
 * @param page - Active page.
 */
async function checkReadiness(page: Page): LifecyclePromise {
  await page.waitForLoadState('domcontentloaded');
}

/**
 * Guard on dashboard text appearance + dismiss any welcome popup.
 * @param page - Active page.
 */
async function postAction(page: Page): LifecyclePromise {
  const hasNavigatedAway = !page.url().includes('/personalarea/Login');
  if (!hasNavigatedAway) {
    await page
      .getByText(DASHBOARD_INDICATOR)
      .first()
      .waitFor({ state: 'visible', timeout: DASHBOARD_WAIT_MS })
      .catch(() => undefined);
    await dismissWelcomePopup(page);
  }
}

export const ISRACARD_LOGIN: ILoginConfig = {
  loginUrl: CFG.urls.base || '',
  fields: [
    { credentialKey: 'id', selectors: [] },
    { credentialKey: 'password', selectors: [] },
    { credentialKey: 'card6Digits', selectors: [] },
  ],
  submit: [],
  checkReadiness,
  postAction,
  possibleResults: { success: [] },
};

/**
 * Build the Isracard pipeline descriptor.
 * @param options - Scraper options from the user.
 * @returns Pipeline: init → home → login → dashboard → scrape → terminate.
 */
function buildIsracardPipeline(options: ScraperOptions): Procedure<IPipelineDescriptor> {
  return createPipelineBuilder()
    .withOptions(options)
    .withBrowser()
    .withDeclarativeLogin(ISRACARD_LOGIN)
    .build();
}

export default buildIsracardPipeline;
export { buildIsracardPipeline };
