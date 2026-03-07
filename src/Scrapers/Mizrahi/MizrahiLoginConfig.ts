import { type Page } from 'playwright';

import {
  waitUntilElementDisappear,
  waitUntilElementFound,
} from '../../Common/ElementsInteractions';
import { waitForNavigation } from '../../Common/Navigation';
import { CompanyTypes } from '../../Definitions';
import type { IDoneResult } from '../../Interfaces/Common/StepResult';
import { type ILoginConfig } from '../Base/LoginConfig';
import { SCRAPER_CONFIGURATION } from '../Registry/ScraperConfig';

const MIZRAHI_CHECKING_ACCOUNT_HE = 'עובר ושב';
const MIZRAHI_CHECKING_ACCOUNT_EN = 'Checking IAccount';
const MIZRAHI_INVALID_HREF = 'https://sc.mizrahi-tefahot.co.il/SCServices/SC/P010.aspx';
const MIZRAHI_INVALID_SELECTOR = `a[href*="${MIZRAHI_INVALID_HREF}"]`;

/**
 * Checks whether the user is already logged into the Mizrahi portal by looking for account links.
 *
 * @param opts - optional options object
 * @param opts.page - the current Playwright page to inspect
 * @returns true if the dashboard account navigation links are present
 */
async function mizrahiIsLoggedIn(opts?: { page?: Page }): Promise<boolean> {
  if (!opts?.page) return false;
  const heContains = `contains(., "${MIZRAHI_CHECKING_ACCOUNT_HE}")`;
  const enContains = `contains(., "${MIZRAHI_CHECKING_ACCOUNT_EN}")`;
  const xpath = `//a//span[${heContains} or ${enContains}]`;
  return (await opts.page.$$(`xpath=${xpath}`)).length > 0;
}

/**
 * Post-login action that waits for any known Mizrahi post-login indicators.
 *
 * @param page - the Playwright page after login form submission
 * @returns a done result after a post-login indicator appears
 */
async function mizrahiPostAction(page: Page): Promise<IDoneResult> {
  await Promise.race([
    waitUntilElementFound(page, '#dropdownBasic'),
    waitUntilElementFound(page, MIZRAHI_INVALID_SELECTOR),
    waitForNavigation(page),
  ]);
  return { done: true };
}

export const MIZRAHI_CONFIG: ILoginConfig = {
  loginUrl: SCRAPER_CONFIGURATION.banks[CompanyTypes.Mizrahi].urls.base,
  fields: [
    { credentialKey: 'username', selectors: [{ kind: 'css', value: '#userNumberDesktopHeb' }] },
    { credentialKey: 'password', selectors: [{ kind: 'css', value: '#passwordDesktopHeb' }] },
  ],
  submit: [{ kind: 'css', value: 'button.btn.btn-primary' }],
  /**
   * Navigates to the Mizrahi login route and waits for the loading overlay to disappear.
   *
   * @param page - the Playwright page to navigate to the login form
   * @returns a done result after the login form is ready
   */
  checkReadiness: async (page: Page): Promise<IDoneResult> => {
    const loginRoute = SCRAPER_CONFIGURATION.banks[CompanyTypes.Mizrahi].urls.loginRoute;
    await page.goto(loginRoute, { waitUntil: 'domcontentloaded' });
    await waitUntilElementDisappear(page, 'div.ngx-overlay.loading-foreground');
    return { done: true };
  },
  postAction: mizrahiPostAction,
  possibleResults: {
    success: [/https:\/\/mto\.mizrahi-tefahot\.co\.il\/OnlineApp\/.*/i, mizrahiIsLoggedIn],
    invalidPassword: [
      async (opts): Promise<boolean> =>
        !!(opts?.page && (await opts.page.$(MIZRAHI_INVALID_SELECTOR))),
    ],
    changePassword: [/https:\/\/www\.mizrahi-tefahot\.co\.il\/login\/index\.html#\/change-pass/],
  },
};

export default MIZRAHI_CONFIG;
