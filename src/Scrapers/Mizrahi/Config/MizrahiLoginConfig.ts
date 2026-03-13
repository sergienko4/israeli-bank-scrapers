import { type Page } from 'playwright';

import {
  waitUntilElementDisappear,
  waitUntilElementFound,
} from '../../../Common/ElementsInteractions.js';
import { waitForNavigation } from '../../../Common/Navigation.js';
import { CompanyTypes } from '../../../Definitions.js';
import { type ILoginConfig } from '../../Base/Config/LoginConfig.js';
import type { LifecyclePromise } from '../../Base/Interfaces/CallbackTypes.js';
import { SCRAPER_CONFIGURATION } from '../../Registry/Config/ScraperConfig.js';

const MIZRAHI_CHECKING_ACCOUNT_HE = 'עובר ושב';
const MIZRAHI_CHECKING_ACCOUNT_EN = 'Checking IAccount';
const MIZRAHI_INVALID_XPATH =
  'xpath=//a[contains(@href,"sc.mizrahi-tefahot.co.il/SCServices/SC/P010.aspx")]';

/** Playwright selector for the loading overlay (role-based). */
const LOADER_SEL = 'xpath=//*[@aria-busy="true" or contains(@class,"ngx-overlay")]';

/** Text selector for the account dropdown — signals successful login. */
const ACCOUNT_DROPDOWN_SEL = 'text=בחר חשבון';

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
  return (await opts.page.$$(`xpath=${xpath}`)).length > 0;
}

/**
 * Wait for Mizrahi post-login navigation or error indicators.
 * @param page - The Playwright page instance.
 * @returns True when a post-login element or navigation completes.
 */
async function mizrahiPostAction(page: Page): LifecyclePromise {
  await Promise.race([
    waitUntilElementFound(page, ACCOUNT_DROPDOWN_SEL),
    waitUntilElementFound(page, MIZRAHI_INVALID_XPATH),
    waitForNavigation(page),
  ]);
}

/** Declarative login configuration for Mizrahi-Tefahot. */
const MIZRAHI_CONFIG: ILoginConfig = {
  loginUrl: SCRAPER_CONFIGURATION.banks[CompanyTypes.Mizrahi].urls.base,
  fields: [
    { credentialKey: 'username', selectors: [] },
    { credentialKey: 'password', selectors: [] },
  ],
  submit: [{ kind: 'textContent', value: 'כניסה' }],
  /**
   * Navigate to the Mizrahi SPA login route and wait for loader to disappear.
   * @param page - The Playwright page instance.
   * @returns True when the login form is ready.
   */
  checkReadiness: async (page: Page): LifecyclePromise => {
    const loginRoute = SCRAPER_CONFIGURATION.banks[CompanyTypes.Mizrahi].urls.loginRoute;
    await page.goto(loginRoute, { waitUntil: 'domcontentloaded' });
    await waitUntilElementDisappear(page, LOADER_SEL);
  },
  postAction: mizrahiPostAction,
  possibleResults: {
    success: [/https:\/\/mto\.mizrahi-tefahot\.co\.il\/OnlineApp\/.*/i, mizrahiIsLoggedIn],
    invalidPassword: [
      async (opts): Promise<boolean> =>
        !!(opts?.page && (await opts.page.$$(MIZRAHI_INVALID_XPATH)).length > 0),
    ],
    changePassword: [/https:\/\/www\.mizrahi-tefahot\.co\.il\/login\/index\.html#\/change-pass/],
  },
};

export { MIZRAHI_CONFIG };
export default MIZRAHI_CONFIG;
