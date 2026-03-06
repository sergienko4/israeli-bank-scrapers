import { type Frame, type Page } from 'playwright';

import { elementPresentOnPage } from '../../Common/ElementsInteractions';
import { sleep } from '../../Common/Waiting';
import { type LoginConfig } from '../Base/LoginConfig';

/**
 * Post-login action that waits for any known Beinleumi dashboard selector to appear.
 *
 * @param page - the Playwright page after login form submission
 */
async function beinleumiPostAction(page: Page): Promise<void> {
  await Promise.race([
    page.waitForSelector('#card-header'),
    page.waitForSelector('#account_num'),
    page.waitForSelector('#matafLogoutLink'),
    page.waitForSelector('#validationMsg'),
    page.waitForSelector('[class*="account-summary"]', { timeout: 30000 }),
  ]).catch(() => {
    // intentionally ignore timeout — any matched selector is sufficient
  });
}

const BEINLEUMI_FIELDS: LoginConfig['fields'] = [
  { credentialKey: 'username', selectors: [] }, // wellKnown → #username
  { credentialKey: 'password', selectors: [] }, // wellKnown → #password
];

const BEINLEUMI_SUBMIT: LoginConfig['submit'] = [
  { kind: 'css', value: '#continueBtn' },
  // ariaLabel 'כניסה' fallback is now in wellKnownSelectors.__submit__
];

const BEINLEUMI_POSSIBLE_RESULTS: LoginConfig['possibleResults'] = {
  success: [/fibi.*accountSummary/, /Resources\/PortalNG\/shell/, /FibiMenu\/Online/],
  invalidPassword: [/FibiMenu\/Marketing\/Private\/Home/],
};

/**
 * Pre-login action that opens the login popup if a trigger link is present.
 *
 * @param page - the Playwright page before filling in the login form
 * @returns undefined (login form is on the main page, not in a frame)
 */
async function beinleumiPreAction(page: Page): Promise<Frame | undefined> {
  const hasTrigger = await elementPresentOnPage(page, 'a.login-trigger');
  if (hasTrigger) {
    await page.evaluate(() => {
      const el = document.querySelector('a.login-trigger');
      if (el instanceof HTMLElement) el.click();
    });
    await sleep(2000);
  } else {
    await sleep(1000);
  }
  return undefined;
}

/**
 * Builds the LoginConfig for the Beinleumi group banks.
 *
 * @param loginUrl - the login URL for the specific bank variant
 * @returns a LoginConfig for Beinleumi-style login
 */
export function beinleumiConfig(loginUrl: string): LoginConfig {
  return {
    loginUrl,
    fields: BEINLEUMI_FIELDS,
    submit: BEINLEUMI_SUBMIT,
    preAction: beinleumiPreAction,
    postAction: beinleumiPostAction,
    possibleResults: BEINLEUMI_POSSIBLE_RESULTS,
  };
}

export default beinleumiConfig;
