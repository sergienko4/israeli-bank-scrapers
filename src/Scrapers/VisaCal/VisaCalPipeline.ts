/**
 * VisaCal pipeline config — login + builder.
 * Scrape logic in Pipeline/VisaCalScrape.ts.
 * Fully rewritten — zero imports from old VisaCal code.
 *
 * Login flow:
 *   checkReadiness: wait for "כניסה לחשבון" link (WellKnown)
 *   preAction:      click link → connect iframe appears → click inside to open form
 *   loginAction:    fill username + password via WellKnown labelText → click submit
 *   postLogin:      generic checkFrameForErrors (WellKnown errorIndicator in frame)
 *                   + postAction waits for page to settle after auth
 */

import type { Frame, Page } from 'playwright-core';

import { waitUntilIframeFound } from '../../Common/ElementsInteractions.js';
import { CompanyTypes } from '../../Definitions.js';
import type { ScraperOptions } from '../Base/Interface.js';
import type { ILoginConfig } from '../Base/Interfaces/Config/LoginConfig.js';
import { PipelineBuilder } from '../Pipeline/PipelineBuilder.js';
import type { IPipelineDescriptor } from '../Pipeline/PipelineDescriptor.js';
import { PIPELINE_WELL_KNOWN_DASHBOARD } from '../Pipeline/Registry/PipelineWellKnown.js';
import { SCRAPER_CONFIGURATION } from '../Registry/Config/ScraperConfig.js';
import { visaCalFetchData } from './Pipeline/VisaCalScrape.js';

const CFG = SCRAPER_CONFIGURATION.banks[CompanyTypes.VisaCal];

/**
 * Wait for the login button to be visible on the VisaCal homepage.
 * Uses PIPELINE_WELL_KNOWN_DASHBOARD.loginLink — bank provides no text.
 * @param page - Browser page.
 * @returns True when login link is visible.
 */
async function checkReadiness(page: Page): Promise<boolean> {
  const candidates = PIPELINE_WELL_KNOWN_DASHBOARD.loginLink;
  const textCandidates = candidates.filter(c => c.kind === 'textContent');
  const waiters = textCandidates.map(c =>
    page.getByText(c.value).first().waitFor({ state: 'visible', timeout: 30000 }),
  );
  await Promise.any(waiters);
  return true;
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
  const textCandidates = candidates.filter(c => c.kind === 'textContent');
  const locators = textCandidates.map(c => pageOrFrame.getByText(c.value).first());
  const waiters = locators.map(async (loc, i): Promise<number> => {
    await loc.waitFor({ state: 'visible', timeout: 15000 });
    return i;
  });
  const idx = await Promise.any(waiters);
  await locators[idx].click();
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
  checkReadiness: async page => {
    await checkReadiness(page);
  },
  /**
   * Click login link → wait for connect iframe → click inside to open form.
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
    await openLoginForm(frame);
    return frame;
  },
  /**
   * Wait for page to settle after connect-iframe authentication.
   * Error detection is handled generically by checkFrameForErrors in postLogin.
   * @param page - Browser page.
   */
  postAction: async page => {
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
function buildVisaCalPipeline(options: ScraperOptions): IPipelineDescriptor {
  return new PipelineBuilder()
    .withOptions(options)
    .withBrowser()
    .withDeclarativeLogin(VISACAL_LOGIN)
    .withScraper(visaCalFetchData)
    .build();
}

export default buildVisaCalPipeline;
export { buildVisaCalPipeline };
