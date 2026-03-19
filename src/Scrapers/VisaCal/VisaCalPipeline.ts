/**
 * VisaCal pipeline config — login + builder.
 * Scrape logic in Pipeline/VisaCalScrape.ts.
 * Fully rewritten — zero imports from old VisaCal code.
 *
 * Login is on the MAIN PAGE (not iframe). WellKnown selectors
 * resolve "שם משתמש" and "סיסמה" via labelText → mat-input.
 * The Mediator (black box) handles resolution generically.
 */

import type { Frame, Page } from 'playwright-core';

import { waitUntilIframeFound } from '../../Common/ElementsInteractions.js';
import { CompanyTypes } from '../../Definitions.js';
import type { ScraperOptions } from '../Base/Interface.js';
import type { ILoginConfig } from '../Base/Interfaces/Config/LoginConfig.js';
import { PipelineBuilder } from '../Pipeline/PipelineBuilder.js';
import type { IPipelineDescriptor } from '../Pipeline/PipelineDescriptor.js';
import { SCRAPER_CONFIGURATION } from '../Registry/Config/ScraperConfig.js';
import { WELL_KNOWN_DASHBOARD_SELECTORS } from '../Registry/WellKnownSelectors.js';
import { visaCalFetchData } from './Pipeline/VisaCalScrape.js';

const CFG = SCRAPER_CONFIGURATION.banks[CompanyTypes.VisaCal];

/**
 * Wait for the login button using WellKnown dashboard selectors.
 * @param page - Browser page.
 * @returns True when login link is visible.
 */
async function checkReadiness(page: Page): Promise<boolean> {
  const candidates = WELL_KNOWN_DASHBOARD_SELECTORS.loginLink;
  const textCandidates = candidates.filter(c => c.kind === 'textContent');
  const waiters = textCandidates.map(c =>
    page.getByText(c.value).first().waitFor({ state: 'visible', timeout: 15000 }),
  );
  await Promise.any(waiters);
  return true;
}

/**
 * Wait for post-login navigation or detect already logged in.
 * @param page - Browser page.
 * @returns True when navigation complete.
 */
async function postAction(page: Page): Promise<boolean> {
  const url = page.url();
  const isLoggedIn = url.includes('dashboard') || url.includes('cal-online.co.il/#');
  if (!isLoggedIn) {
    await page.waitForURL(/dashboard|cal-online\.co\.il\/#/, { timeout: 30000 });
  }
  return true;
}

/**
 * Detect invalid password via URL pattern (async fn result condition).
 * @param opts - Options with page.
 * @param opts.page - Browser page.
 * @returns True if still on login page after submit.
 */
function detectInvalidPw(opts?: { page?: Page }): boolean {
  const page = opts?.page;
  if (!page) return false;
  const url = page.url();
  const isOnDashboard = url.includes('dashboard');
  const isOnHashRoute = url.includes('#');
  if (isOnDashboard || isOnHashRoute) return false;
  return url.includes('cal-online.co.il');
}

/**
 * Click the login link to reveal the login form on the main page.
 * @param page - Browser page.
 * @returns Undefined (no iframe — form appears on main page).
 */
async function openLoginForm(page: Page | Frame): Promise<boolean> {
  const candidates = WELL_KNOWN_DASHBOARD_SELECTORS.loginLink;
  const textCandidates = candidates.filter(c => c.kind === 'textContent');
  const locators = textCandidates.map(c => page.getByText(c.value).first());
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
   * Wait for login link, click to reveal form, wait for username field.
   * @param page - Browser page.
   */
  checkReadiness: async page => {
    await checkReadiness(page);
  },
  /**
   * Click login link, wait for connect iframe, click inside to reveal form.
   * @param page - Browser page.
   * @returns The connect iframe (resolver also searches main page).
   */
  preAction: async (page): Promise<Frame | undefined> => {
    await openLoginForm(page);
    /**
     * Test if frame is the connect login iframe.
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
   * Wait for dashboard after login.
   * @param page - Browser page.
   */
  postAction: async page => {
    await postAction(page);
  },
  possibleResults: {
    success: [/dashboard/i, /cal-online\.co\.il\/#/],
    invalidPassword: [detectInvalidPw],
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
