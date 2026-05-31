import { type Page } from 'playwright-core';

import { waitUntilElementDisappear } from '../../../Common/ElementsInteractions.js';
import { waitForNavigation } from '../../../Common/Navigation.js';
import { CompanyTypes } from '../../../Definitions.js';
import { type ILoginConfig } from '../../Base/Config/LoginConfig.js';
import type { LifecyclePromise } from '../../Base/Interfaces/CallbackTypes.js';
import { SCRAPER_CONFIGURATION } from '../../Registry/Config/ScraperConfig.js';
import { WELL_KNOWN_DASHBOARD_SELECTORS } from '../../Registry/WellKnownSelectors.js';

const MIZRAHI_CHECKING_ACCOUNT_HE = 'עובר ושב';
const MIZRAHI_CHECKING_ACCOUNT_EN = 'Checking IAccount';

/** Hebrew text fragments indicating invalid credentials on Mizrahi. */
const ERROR_TEXT_CANDIDATES = WELL_KNOWN_DASHBOARD_SELECTORS.errorIndicator.map(c => c.value);

/** WELL_KNOWN account selector text candidates for post-login detection. */
const ACCOUNT_TEXT_CANDIDATES = WELL_KNOWN_DASHBOARD_SELECTORS.accountSelector
  .filter((c): c is typeof c & { kind: 'textContent' } => c.kind === 'textContent')
  .map(c => c.value);

/**
 * Check if any text candidate is visible on the page.
 * @param page - The Playwright page to check.
 * @param texts - Array of Hebrew text strings to look for.
 * @returns True if any text is visible.
 */
async function isAnyTextVisible(page: Page, texts: string[]): Promise<boolean> {
  const checks = texts.map(t =>
    page
      .getByText(t)
      .first()
      .isVisible()
      .catch(() => false),
  );
  const results = await Promise.all(checks);
  return results.some(Boolean);
}

/**
 * Check if the Mizrahi dashboard is already showing a checking account link.
 * @param opts - Optional object containing the Playwright page.
 * @param opts.page - The Playwright page to check for logged-in indicators.
 * @returns True if the checking account link is found on the page.
 */
async function mizrahiIsLoggedIn(opts?: { page?: Page }): Promise<boolean> {
  if (!opts?.page) return false;
  const heOrEn =
    `"${MIZRAHI_CHECKING_ACCOUNT_HE}") or contains(., ` + `"${MIZRAHI_CHECKING_ACCOUNT_EN}"`;
  const xpath = `//a//span[contains(., ${heOrEn})]`;
  return (await opts.page.locator(`xpath=${xpath}`).all()).length > 0;
}

/**
 * Build text-based waiters for post-login detection.
 * @param page - The Playwright page instance.
 * @returns Array of promises that resolve when text is found.
 */
function buildPostLoginWaiters(page: Page): Promise<boolean>[] {
  return ACCOUNT_TEXT_CANDIDATES.map(async text => {
    await page.getByText(text).first().waitFor({ state: 'visible', timeout: 30000 });
    return true;
  });
}

/**
 * Wait for Mizrahi post-login navigation or error indicators.
 * @param page - The Playwright page instance.
 * @returns True when a post-login element or navigation completes.
 */
async function mizrahiPostAction(page: Page): LifecyclePromise {
  const errorWaiters = ERROR_TEXT_CANDIDATES.map(async text => {
    await page.getByText(text).first().waitFor({ state: 'visible', timeout: 30000 });
    return true;
  });
  await Promise.race([...buildPostLoginWaiters(page), ...errorWaiters, waitForNavigation(page)]);
}

/** Declarative login configuration for Mizrahi-Tefahot. */
const MIZRAHI_CONFIG: ILoginConfig = {
  loginUrl: SCRAPER_CONFIGURATION.banks[CompanyTypes.Mizrahi].urls.base,
  fields: [
    { credentialKey: 'username', selectors: [] },
    { credentialKey: 'password', selectors: [] },
  ],
  submit: [{ kind: 'css', value: 'button.btn.btn-primary' }],
  /**
   * Navigate to the Mizrahi SPA login route and wait for loader to disappear.
   * @param page - The Playwright page instance.
   * @returns True when the login form is ready.
   */
  checkReadiness: async (page: Page): LifecyclePromise => {
    const loginRoute = SCRAPER_CONFIGURATION.banks[CompanyTypes.Mizrahi].urls.loginRoute;
    await page.goto(loginRoute, { waitUntil: 'domcontentloaded' });
    await waitUntilElementDisappear(page, 'div.ngx-overlay.loading-foreground');
  },
  postAction: mizrahiPostAction,
  possibleResults: {
    success: [/https:\/\/mto\.mizrahi-tefahot\.co\.il\/OnlineApp\/.*/i, mizrahiIsLoggedIn],
    invalidPassword: [
      async (opts): Promise<boolean> => {
        if (!opts?.page) return false;
        return isAnyTextVisible(opts.page, ERROR_TEXT_CANDIDATES);
      },
    ],
    changePassword: [/https:\/\/www\.mizrahi-tefahot\.co\.il\/login\/index\.html#\/change-pass/],
  },
};

export { MIZRAHI_CONFIG };
export default MIZRAHI_CONFIG;
