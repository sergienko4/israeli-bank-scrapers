import { type Page } from 'playwright';

import { elementPresentOnPage } from '../../../Common/ElementsInteractions.js';
import { type ILoginConfig } from '../../Base/Config/LoginConfig.js';
import { DOM_OTP } from '../../Registry/Config/ScraperConfigDefaults.js';

/**
 * Wait for any of the known post-login dashboard selectors to appear.
 * @param page - The Playwright page to check for dashboard elements.
 * @returns True once the race completes.
 */
async function beinleumiPostAction(
  page: Page,
): ReturnType<NonNullable<ILoginConfig['postAction']>> {
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

/** Login field declarations for Beinleumi — wellKnown resolves #username and #password. */
export const BEINLEUMI_FIELDS: ILoginConfig['fields'] = [
  { credentialKey: 'username', selectors: [] }, // wellKnown → #username
  { credentialKey: 'password', selectors: [] }, // wellKnown → #password
];

const BEINLEUMI_SUBMIT: ILoginConfig['submit'] = [
  { kind: 'css', value: '#continueBtn' },
  // textContent 'המשך'/'כניסה' fallback is in wellKnownSelectors.__submit__
];

const BEINLEUMI_POSSIBLE_RESULTS: ILoginConfig['possibleResults'] = {
  success: [/fibi.*accountSummary/, /Resources\/PortalNG\/shell/, /FibiMenu\/Online/],
  invalidPassword: [/FibiMenu\/Marketing\/Private\/Home/],
};

/**
 * Click the login trigger if present, then wait for the form to render.
 * @param page - The Playwright page to interact with.
 * @returns The login iframe if found, or undefined.
 */
async function beinleumiPreAction(page: Page): ReturnType<NonNullable<ILoginConfig['preAction']>> {
  const hasTrigger = await elementPresentOnPage(page, 'a.login-trigger');
  if (hasTrigger) {
    await page.evaluate(() => {
      const el = document.querySelector('a.login-trigger');
      if (el instanceof HTMLElement) el.click();
    });
    await page.waitForTimeout(2000);
    const loginFrame = page.frames().find(f => f.url().includes('login'));
    return loginFrame;
  }
  await page.waitForTimeout(1000);
  const loginFrame = page.frames().find(f => f.url().includes('login'));
  return loginFrame;
}

/**
 * Build the login configuration for Beinleumi bank.
 * @param loginUrl - The bank's login page URL.
 * @returns A complete ILoginConfig for the Beinleumi login flow.
 */
export function beinleumiConfig(loginUrl: string): ILoginConfig {
  return {
    loginUrl,
    fields: BEINLEUMI_FIELDS,
    submit: BEINLEUMI_SUBMIT,
    otp: DOM_OTP,
    preAction: beinleumiPreAction,
    postAction: beinleumiPostAction,
    possibleResults: BEINLEUMI_POSSIBLE_RESULTS,
  };
}
