import { type Page } from 'playwright';

import { elementPresentOnPage } from '../../../Common/ElementsInteractions.js';
import { type ILoginConfig } from '../../Base/Config/LoginConfig.js';
import { DOM_OTP } from '../../Registry/Config/ScraperConfigDefaults.js';

/** Playwright text selector for the login trigger link. */
const LOGIN_TRIGGER_SEL = 'role=link[name=/כניסה/]';

/**
 * Wait for any of the known post-login dashboard indicators to appear.
 * @param page - The Playwright page to check for dashboard elements.
 * @returns True once the race completes.
 */
async function beinleumiPostAction(
  page: Page,
): ReturnType<NonNullable<ILoginConfig['postAction']>> {
  await Promise.race([
    page.waitForSelector('text=כרטיס'),
    page.waitForSelector('text=מספר חשבון'),
    page.waitForSelector('role=link[name=/יציאה|התנתק/]'),
    page.waitForSelector('text=שגיאה'),
    page.waitForSelector('text=סיכום חשבון', { timeout: 30000 }),
  ]).catch(() => {
    // intentionally ignore timeout — any matched selector is sufficient
  });
}

/** Login field declarations for Beinleumi — wellKnown resolves username and password. */
export const BEINLEUMI_FIELDS: ILoginConfig['fields'] = [
  { credentialKey: 'username', selectors: [] },
  { credentialKey: 'password', selectors: [] },
];

const BEINLEUMI_SUBMIT: ILoginConfig['submit'] = [
  { kind: 'textContent', value: 'המשך' },
  { kind: 'textContent', value: 'כניסה' },
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
  const hasTrigger = await elementPresentOnPage(page, LOGIN_TRIGGER_SEL);
  if (hasTrigger) {
    await page.locator(LOGIN_TRIGGER_SEL).first().click();
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
