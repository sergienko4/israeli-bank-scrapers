import { type Page } from 'playwright-core';

import {
  elementPresentOnPage,
  waitUntilElementDisappear,
  waitUntilElementFound,
} from '../../../Common/ElementsInteractions.js';
import { waitForNavigation } from '../../../Common/Navigation.js';
import { CompanyTypes } from '../../../Definitions.js';
import { type ILoginConfig } from '../../Base/Config/LoginConfig.js';
import type { LifecyclePromise } from '../../Base/Interfaces/CallbackTypes.js';
import { SCRAPER_CONFIGURATION } from '../../Registry/Config/ScraperConfig.js';

const CFG = SCRAPER_CONFIGURATION.banks[CompanyTypes.Yahav];

/** XPath for the messaging container. */
const MSG_CLASS = 'messaging-links-container';
const MESSAGING_XPATH = 'xpath=//*[contains(@class, "' + MSG_CLASS + '")]';

/** XPath for the dashboard account details section. */
const ACCOUNT_DETAILS_XPATH =
  'xpath=//*[contains(@class, "account-details")' + ' or @id="AccountDetails"]';

/** XPath for the loader spinner. */
const LOADER_XPATH = 'xpath=//*[contains(@class, "loader")]';

/** XPath for the submit button. */
const BTN_XPATH = '//button[contains(@class, "btn")]';

/**
 * Dismiss the messaging popup if present by clicking its first link.
 * @param page - The Playwright page instance.
 * @returns True if dismissed, false if not present.
 */
async function dismissMessaging(page: Page): Promise<boolean> {
  const loc = page.locator(MESSAGING_XPATH).first();
  if ((await loc.count()) === 0) return false;
  const linkLoc = page.locator(MESSAGING_XPATH).locator('a').first();
  await linkLoc.click();
  return true;
}

/**
 * Yahav post-login action — waits for loader, dismisses messaging, and waits for dashboard.
 * @param page - The Playwright page instance.
 * @returns True when post-login actions complete.
 */
async function yahavPostAction(page: Page): LifecyclePromise {
  await waitForNavigation(page);
  await waitUntilElementDisappear(page, LOADER_XPATH);
  await dismissMessaging(page);
  await Promise.race([
    page.locator(ACCOUNT_DETAILS_XPATH).first().waitFor({ state: 'visible' }),
    waitUntilElementFound(page, 'input#ef_req_parameter_old_credential', {
      visible: true,
      timeout: 60000,
    }),
  ]);
}

/** Company type for Yahav — re-exported for module multi-export compliance. */
export const YAHAV_COMPANY = CompanyTypes.Yahav;

/** Declarative login configuration for Bank Yahav. */
export const YAHAV_CONFIG: ILoginConfig = {
  loginUrl: CFG.urls.base,
  fields: [
    { credentialKey: 'username', selectors: [] },
    { credentialKey: 'password', selectors: [] },
    { credentialKey: 'nationalID', selectors: [] },
  ],
  submit: [{ kind: 'xpath', value: BTN_XPATH }],
  /**
   * Wait for login form fields and submit button to appear.
   * @param page - The Playwright page instance.
   * @returns True when login form is ready.
   */
  checkReadiness: async (page: Page): LifecyclePromise => {
    const btnSelector = 'xpath=' + BTN_XPATH;
    const idReady = page.locator('input[type="password"]').first().waitFor({ state: 'attached' });
    const btnReady = waitUntilElementFound(page, btnSelector);
    await Promise.all([idReady, btnReady]);
  },
  postAction: yahavPostAction,
  possibleResults: {
    success: ['https://digital.yahav.co.il/BaNCSDigitalUI/app/index.html#/main/home'],
    invalidPassword: [
      async (opts): Promise<boolean> =>
        !!(opts?.page && (await elementPresentOnPage(opts.page, '.ui-dialog-buttons'))),
    ],
    changePassword: [
      async (opts): Promise<boolean> =>
        !!(
          opts?.page &&
          (await elementPresentOnPage(opts.page, 'input#ef_req_parameter_old_credential'))
        ),
    ],
  },
};
