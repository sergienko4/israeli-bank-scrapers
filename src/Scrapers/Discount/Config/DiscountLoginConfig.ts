import { type Page } from 'playwright';

import { waitUntilElementFound } from '../../../Common/ElementsInteractions.js';
import { type ILoginConfig } from '../../Base/Config/LoginConfig.js';
import type { LifecyclePromise } from '../../Base/Interfaces/CallbackTypes.js';

const LOGIN_PORTAL = 'https://start.telebank.co.il/login/?multilang=he&bank=d&t=p';

/**
 * Wait for Discount post-login redirect to the Apollo dashboard.
 * @param page - The Playwright page instance.
 * @returns True when the Apollo URL is reached.
 */
async function discountPostAction(page: Page): LifecyclePromise {
  await page.waitForURL('**/apollo/**', { timeout: 30000 });
}

const DISCOUNT_FIELDS: ILoginConfig['fields'] = [
  { credentialKey: 'id', selectors: [] }, // wellKnown → #tzId
  { credentialKey: 'password', selectors: [] }, // wellKnown → #tzPassword
  { credentialKey: 'num', selectors: [] }, // wellKnown → #aidnum
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
 * Build the Discount login configuration for the given login URL.
 * @param loginUrl - The bank's login URL.
 * @returns A fully configured ILoginConfig for Discount.
 */
export default function discountConfig(loginUrl: string): ILoginConfig {
  return {
    loginUrl,
    fields: DISCOUNT_FIELDS,
    submit: [{ kind: 'textContent', value: 'שלח' }],
    /**
     * Navigate to Discount login portal and wait for the ID field.
     * @param page - The Playwright page instance.
     * @returns True when the login form is ready.
     */
    checkReadiness: async (page: Page): LifecyclePromise => {
      await page.goto(LOGIN_PORTAL);
      await waitUntilElementFound(page, 'text=מספר זהות');
    },
    postAction: discountPostAction,
    possibleResults: DISCOUNT_POSSIBLE_RESULTS,
  };
}
