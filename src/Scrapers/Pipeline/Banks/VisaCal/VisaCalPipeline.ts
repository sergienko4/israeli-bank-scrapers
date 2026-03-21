/**
 * VisaCal pipeline config — login + builder.
 * Scrape logic in Pipeline/VisaCalScraper.ts.
 * Fully rewritten — zero imports from old VisaCal code.
 *
 * Login flow:
 *   checkReadiness: wait for "כניסה לחשבון" link (WellKnown)
 *   preAction:      click homepage link → connect iframe appears (returned as activeFrame)
 *   preLogin:       generic tryClickLoginMethodTab — if iframe is on send-otp, clicks
 *                   "כניסה עם שם משתמש" tab to navigate to credentials form; skips if
 *                   iframe is already on regular-login (A/B test — both paths handled)
 *   loginAction:    fill username + password via WellKnown labelText → click submit
 *   postLogin:      generic checkFrameForErrors (WellKnown errorIndicator in frame)
 *                   + postAction waits for page to settle after auth
 */

import type { Frame, Locator, Page } from 'playwright-core';

import { waitUntilIframeFound } from '../../../../Common/ElementsInteractions.js';
import { CompanyTypes } from '../../../../Definitions.js';
import type { SelectorCandidate } from '../../../Base/Config/LoginConfigTypes.js';
import type { ScraperOptions } from '../../../Base/Interface.js';
import type { ILoginConfig } from '../../../Base/Interfaces/Config/LoginConfig.js';
import { SCRAPER_CONFIGURATION } from '../../../Registry/Config/ScraperConfig.js';
import { createPipelineBuilder } from '../../PipelineBuilder.js';
import type { IPipelineDescriptor } from '../../PipelineDescriptor.js';
import { PIPELINE_WELL_KNOWN_DASHBOARD } from '../../Registry/PipelineWellKnown.js';
import type { Procedure } from '../../Types/Procedure.js';
import { visaCalFetchData } from './VisaCalScraper.js';

const CFG = SCRAPER_CONFIGURATION.banks[CompanyTypes.VisaCal];

/**
 * Build a Playwright locator from a SelectorCandidate based on its kind.
 * Supports all text-based kinds: textContent, ariaLabel, placeholder, name.
 * @param ctx - Page or Frame to build the locator on.
 * @param candidate - The selector candidate.
 * @returns First-match Playwright Locator.
 */
function buildLocator(ctx: Page | Frame, candidate: SelectorCandidate): Locator {
  if (candidate.kind === 'ariaLabel') return ctx.getByLabel(candidate.value).first();
  if (candidate.kind === 'placeholder') return ctx.getByPlaceholder(candidate.value).first();
  return ctx.getByText(candidate.value).first();
}

/**
 * Wait for the login button to be visible on the VisaCal homepage.
 * Uses PIPELINE_WELL_KNOWN_DASHBOARD.loginLink — bank provides no text.
 * @param page - Browser page.
 * @returns True when login link is visible.
 */
async function checkReadiness(page: Page): Promise<boolean> {
  const candidates = PIPELINE_WELL_KNOWN_DASHBOARD.loginLink;
  const waiters = candidates.map(
    (c): Promise<boolean> =>
      buildLocator(page, c)
        .waitFor({ state: 'visible', timeout: 30000 })
        .then((): boolean => true),
  );
  const results = await Promise.allSettled(waiters);
  const hasVisible = results.some((r): boolean => r.status === 'fulfilled');
  return hasVisible;
}

/**
 * Wait for post-login page to settle after connect-iframe authentication.
 * Uses networkidle — SPA may not change URL visibly until all requests complete.
 * @param page - Browser page.
 * @returns True when page has settled.
 */
async function postAction(page: Page): Promise<boolean> {
  await page.waitForLoadState('networkidle', { timeout: 30000 });
  return true;
}

/**
 * Click the login link to reveal the connect iframe.
 * @param pageOrFrame - Main page OR the connect iframe (called twice in preAction).
 * @returns True after clicking.
 */
async function openLoginForm(pageOrFrame: Page | Frame): Promise<boolean> {
  const candidates = PIPELINE_WELL_KNOWN_DASHBOARD.loginLink;
  const locators = candidates.map((c): Locator => buildLocator(pageOrFrame, c));
  const waiters = locators.map(async (loc, i): Promise<number> => {
    await loc.waitFor({ state: 'visible', timeout: 15000 });
    return i;
  });
  const results = await Promise.allSettled(waiters);
  const fulfilled = results.find((r): boolean => r.status === 'fulfilled');
  if (fulfilled?.status !== 'fulfilled') return false;
  await locators[fulfilled.value].click();
  return true;
}

/** VisaCal login config — WellKnown resolves fields generically. */
const VISACAL_LOGIN: ILoginConfig = {
  loginUrl: CFG.urls.base || '',
  fields: [
    { credentialKey: 'username', selectors: [] },
    { credentialKey: 'password', selectors: [] },
  ],
  submit: [
    { kind: 'ariaLabel', value: 'כניסה' },
    { kind: 'xpath', value: '//button[contains(., "כניסה")]' },
    { kind: 'textContent', value: 'כניסה' },
  ],
  /**
   * Wait for login link to be visible on homepage.
   * @param page - Browser page.
   */
  checkReadiness: async (page): Promise<void> => {
    await checkReadiness(page);
  },
  /**
   * Click homepage login link → wait for connect iframe → return iframe as activeFrame.
   * Tab navigation (send-otp → regular-login) is handled generically by tryClickLoginMethodTab
   * in executePreLogin after this callback returns.
   * @param page - Browser page.
   * @returns The connect iframe as activeFrame for field resolution.
   */
  preAction: async (page): Promise<Frame | undefined> => {
    await openLoginForm(page);
    /**
     * Test if frame is the VisaCal connect login iframe.
     * @param f - Frame to test.
     * @returns True if URL contains 'connect'.
     */
    const isConnect = (f: Frame): boolean => f.url().includes('connect');
    const iframeOpts = { timeout: 45000, description: 'connect iframe' };
    const frame = await waitUntilIframeFound(page, isConnect, iframeOpts);
    return frame;
  },
  /**
   * Wait for page to settle after connect-iframe authentication.
   * Error detection is handled generically by checkFrameForErrors in postLogin.
   * @param page - Browser page.
   */
  postAction: async (page): Promise<void> => {
    await postAction(page);
  },
  /**
   * possibleResults is not used for error detection — checkFrameForErrors handles it.
   * Kept for interface compatibility.
   */
  possibleResults: {
    success: [/dashboard/i],
  },
};

/**
 * Build the VisaCal pipeline descriptor.
 * @param options - Scraper options.
 * @returns Pipeline: init → login → scrape → terminate.
 */
function buildVisaCalPipeline(options: ScraperOptions): Procedure<IPipelineDescriptor> {
  return createPipelineBuilder()
    .withOptions(options)
    .withBrowser()
    .withDeclarativeLogin(VISACAL_LOGIN)
    .withScraper(visaCalFetchData)
    .build();
}

export default buildVisaCalPipeline;
export { buildLocator, buildVisaCalPipeline, VISACAL_LOGIN };
