import { type Page } from 'playwright-core';

import { pageEvalAll, waitUntilElementFound } from '../../../Common/ElementsInteractions.js';
import { waitForNavigation } from '../../../Common/Navigation.js';
import { CompanyTypes } from '../../../Definitions.js';
import { type ILoginConfig } from '../../Base/Config/LoginConfig.js';
import type { LifecyclePromise } from '../../Base/Interfaces/CallbackTypes.js';
import { SCRAPER_CONFIGURATION } from '../../Registry/Config/ScraperConfig.js';

const CFG = SCRAPER_CONFIGURATION.banks[CompanyTypes.Leumi];

/** Hebrew error message displayed when Leumi login credentials are invalid. */
export const LEUMI_INVALID_PASSWORD_MSG = 'אחד או יותר מפרטי ההזדהות שמסרת שגויים. ניתן לנסות שוב';
const LEUMI_ACCOUNT_BLOCKED_MSG = 'המנוי חסום';

/**
 * Navigate to the Leumi login form and wait for all input fields to render.
 * @param page - The Playwright page to check readiness on.
 * @returns True after the login form is ready.
 */
async function leumiCheckReadiness(page: Page): LifecyclePromise {
  await waitUntilElementFound(page, '.enter_account');
  const loginUrl = await page.$eval('.enter_account', el => (el as HTMLAnchorElement).href);
  await page.goto(loginUrl);
  await waitForNavigation(page, { waitUntil: 'networkidle' });
  await Promise.all([
    waitUntilElementFound(page, 'input[placeholder="שם משתמש"]', { visible: true }),
    waitUntilElementFound(page, 'input[placeholder="סיסמה"]', { visible: true }),
    waitUntilElementFound(page, 'button[type="submit"]', { visible: true }),
  ]);
}

/**
 * Wait for the Leumi post-login page to resolve to a known outcome.
 * @param page - The Playwright page to observe after login submission.
 * @returns True after a post-login indicator is detected.
 */
async function leumiPostAction(page: Page): LifecyclePromise {
  await Promise.race([
    waitUntilElementFound(page, 'a[title="דלג לחשבון"]', { visible: true, timeout: 60000 }),
    waitUntilElementFound(page, 'div.main-content', { visible: false, timeout: 60000 }),
    page.waitForSelector(`xpath=//div[contains(string(),"${LEUMI_INVALID_PASSWORD_MSG}")]`),
    waitUntilElementFound(page, 'form[action="/changepassword"]', {
      visible: true,
      timeout: 60000,
    }),
  ]);
}

/**
 * Extract inner text from the first element matching a selector.
 * @param elements - Array of matched DOM elements.
 * @returns The inner text of the first element.
 */
function extractFirstInnerText(elements: Element[]): string {
  return (elements[0] as HTMLElement).innerText;
}

/**
 * Extract the error or blocked message text from the Leumi page.
 * @param page - The Playwright page to evaluate.
 * @param selector - The CSS selector to find the message element.
 * @param prefix - The expected message prefix to match against.
 * @returns True if the page contains text starting with the given prefix.
 */
async function checkLeumiMessage(page: Page, selector: string, prefix: string): Promise<boolean> {
  const msg = await pageEvalAll(page, {
    selector,
    defaultResult: '',
    callback: extractFirstInnerText,
  });
  return msg.startsWith(prefix);
}

/**
 * Extract the sibling text of the Capa SVG icon for password error detection.
 * @param elements - Array of matched SVG elements.
 * @returns The inner text of the sibling element next to the icon.
 */
function extractCapaSiblingText(elements: Element[]): string {
  return (elements[0]?.parentElement?.children[1] as HTMLDivElement).innerText;
}

/**
 * Check whether the invalid-password SVG icon and message are visible.
 * @param opts - The possible-result check options with page reference.
 * @param opts.page - The Playwright page to inspect for the error icon.
 * @returns True if the invalid password message is present.
 */
async function checkInvalidPassword(opts?: { page?: Page }): Promise<boolean> {
  if (!opts?.page) return false;
  const parentText = await pageEvalAll(opts.page, {
    selector: 'svg#Capa_1',
    defaultResult: '',
    callback: extractCapaSiblingText,
  });
  return parentText.startsWith(LEUMI_INVALID_PASSWORD_MSG);
}

/**
 * Check whether the account-blocked error header is present.
 * @param opts - The possible-result check options with page reference.
 * @param opts.page - The Playwright page to inspect for the blocked header.
 * @returns True if the account blocked message is present.
 */
async function checkAccountBlocked(opts?: { page?: Page }): Promise<boolean> {
  if (!opts?.page) return false;
  return checkLeumiMessage(opts.page, '.errHeader', LEUMI_ACCOUNT_BLOCKED_MSG);
}

/** Leumi bank login configuration with field selectors and result detection. */
const LEUMI_CONFIG: ILoginConfig = {
  loginUrl: CFG.urls.base,
  fields: [
    { credentialKey: 'username', selectors: [] },
    { credentialKey: 'password', selectors: [] },
  ],
  submit: [{ kind: 'css', value: "button[type='submit']" }],
  checkReadiness: leumiCheckReadiness,
  postAction: leumiPostAction,
  possibleResults: {
    success: [/ebanking\/SO\/SPA.aspx/i],
    invalidPassword: [checkInvalidPassword],
    accountBlocked: [checkAccountBlocked],
    changePassword: ['https://hb2.bankleumi.co.il/authenticate'],
  },
};

export default LEUMI_CONFIG;
