import { type Page } from 'playwright';

import { waitUntilElementFound } from '../../Common/ElementsInteractions';
import { waitForNavigation } from '../../Common/Navigation';
import { CompanyTypes } from '../../Definitions';
import type { IDoneResult } from '../../Interfaces/Common/StepResult';
import { type ILoginConfig } from '../Base/LoginConfig';
import { SCRAPER_CONFIGURATION } from '../Registry/ScraperConfig';

/**
 * Post-login action for Discount Bank that waits for navigation after submit.
 *
 * @param page - the Playwright page after login form submission
 * @returns a done result after the post-login state is reached
 */
async function discountPostAction(page: Page): Promise<IDoneResult> {
  try {
    await waitForNavigation(page);
  } catch {
    await waitUntilElementFound(page, '#general-error', { visible: false, timeout: 100 });
  }
  return { done: true };
}

const DISCOUNT_FIELDS: ILoginConfig['fields'] = [
  { credentialKey: 'id', selectors: [{ kind: 'css', value: '#tzId' }] },
  { credentialKey: 'password', selectors: [{ kind: 'css', value: '#tzPassword' }] },
  { credentialKey: 'num', selectors: [{ kind: 'css', value: '#aidnum' }] }, // "קוד מזהה"
];

const DISCOUNT_POSSIBLE_RESULTS: ILoginConfig['possibleResults'] = {
  success: [
    'https://start.telebank.co.il/apollo/retail/#/MY_ACCOUNT_HOMEPAGE',
    'https://start.telebank.co.il/apollo/retail2/#/MY_ACCOUNT_HOMEPAGE',
    'https://start.telebank.co.il/apollo/retail2/',
  ],
  invalidPassword: [
    'https://start.telebank.co.il/apollo/core/templates/lobby/masterPage.html#/LOGIN_PAGE',
  ],
  changePassword: [
    'https://start.telebank.co.il/apollo/core/templates/lobby/masterPage.html#/PWD_RENEW',
  ],
};

/**
 * Builds the ILoginConfig for Discount Bank.
 *
 * @param loginUrl - the login URL for the Discount Bank portal
 * @returns a ILoginConfig for Discount Bank login
 */
export function discountConfig(loginUrl: string): ILoginConfig {
  return {
    loginUrl,
    fields: DISCOUNT_FIELDS,
    submit: [{ kind: 'css', value: '.sendBtn' }],
    /**
     * Navigates to the Discount Bank telebank login portal before filling credentials.
     *
     * @param page - the Playwright page to navigate to the login form
     * @returns a done result after the login form is ready
     */
    checkReadiness: async (page: Page): Promise<IDoneResult> => {
      // loginUrl is the public home page; the actual login form lives on the telebank portal.
      // Navigate there first (mirrors Mizrahi's pattern with loginRoute).
      const loginRoute = SCRAPER_CONFIGURATION.banks[CompanyTypes.Discount].urls.loginRoute;
      await page.goto(loginRoute, { waitUntil: 'domcontentloaded' });
      await waitUntilElementFound(page, '#tzId');
      return { done: true };
    },
    postAction: discountPostAction,
    possibleResults: DISCOUNT_POSSIBLE_RESULTS,
  };
}

export default discountConfig;
