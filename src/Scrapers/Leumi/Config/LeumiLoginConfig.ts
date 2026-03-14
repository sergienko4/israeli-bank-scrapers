import { type Page } from 'playwright';

import {
  elementPresentOnPage,
  pageEvalAll,
  waitUntilElementFound,
} from '../../../Common/ElementsInteractions.js';
import { waitForNavigation } from '../../../Common/Navigation.js';
import { CompanyTypes } from '../../../Definitions.js';
import { type ILoginConfig } from '../../Base/Config/LoginConfig.js';
import type { LifecyclePromise } from '../../Base/Interfaces/CallbackTypes.js';
import { SCRAPER_CONFIGURATION } from '../../Registry/Config/ScraperConfig.js';

const CFG = SCRAPER_CONFIGURATION.banks[CompanyTypes.Leumi];

const LEUMI_INVALID_PASSWORD_MSG = 'אחד או יותר מפרטי ההזדהות שמסרת שגויים. ניתן לנסות שוב';
const LEUMI_ACCOUNT_BLOCKED_MSG = 'המנוי חסום';

/** Text-based selector for the login entry link. */
const ENTER_ACCOUNT_SEL = 'role=link[name="כניסה לחשבון"]';

/** Selector for the skip-to-account link. */
const SKIP_TO_ACCOUNT_SEL = 'role=link[name="דלג לחשבון"]';

/** Selector for the change-password form. */
const CHANGE_PASSWORD_SEL = 'text=שינוי סיסמה';

/**
 * Navigate to the Leumi login form and wait for all input fields to render.
 * @param page - The Playwright page to check readiness on.
 * @returns True after the login form is ready.
 */
async function leumiCheckReadiness(page: Page): LifecyclePromise {
  await waitUntilElementFound(page, ENTER_ACCOUNT_SEL);
  const loginUrl = (await page.locator(ENTER_ACCOUNT_SEL).first().getAttribute('href')) ?? '';
  await page.goto(loginUrl);
  await waitForNavigation(page, { waitUntil: 'networkidle' });
  await Promise.all([
    waitUntilElementFound(page, 'role=textbox[name="שם משתמש"]', { visible: true }),
    waitUntilElementFound(page, 'role=textbox[name="סיסמה"]', { visible: true }),
    waitUntilElementFound(page, 'role=button[name="כניסה"]', { visible: true }),
  ]);
}

/**
 * Wait for the Leumi post-login page to resolve to a known outcome.
 * @param page - The Playwright page to observe after login submission.
 * @returns True after a post-login indicator is detected.
 */
async function leumiPostAction(page: Page): LifecyclePromise {
  await Promise.race([
    waitUntilElementFound(page, SKIP_TO_ACCOUNT_SEL, { visible: true, timeout: 60000 }),
    waitUntilElementFound(page, 'text=תוכן ראשי', { visible: false, timeout: 60000 }),
    waitUntilElementFound(page, `text=${LEUMI_INVALID_PASSWORD_MSG}`, { timeout: 60000 }),
    waitUntilElementFound(page, CHANGE_PASSWORD_SEL, {
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
 * @param selector - The selector to find the message element.
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
 * Check whether the invalid-password error message is visible.
 * @param opts - The possible-result check options with page reference.
 * @param opts.page - The Playwright page to inspect for the error message.
 * @returns True if the invalid password message is present.
 */
async function checkInvalidPassword(opts?: { page?: Page }): Promise<boolean> {
  if (!opts?.page) return false;
  return elementPresentOnPage(opts.page, `text=${LEUMI_INVALID_PASSWORD_MSG}`);
}

/**
 * Check whether the account-blocked error header is present.
 * @param opts - The possible-result check options with page reference.
 * @param opts.page - The Playwright page to inspect for the blocked header.
 * @returns True if the account blocked message is present.
 */
async function checkAccountBlocked(opts?: { page?: Page }): Promise<boolean> {
  if (!opts?.page) return false;
  return checkLeumiMessage(opts.page, 'text=שגיאה', LEUMI_ACCOUNT_BLOCKED_MSG);
}

/** Leumi bank login configuration with field selectors and result detection. */
const LEUMI_CONFIG: ILoginConfig = {
  loginUrl: CFG.urls.base,
  fields: [
    { credentialKey: 'username', selectors: [] },
    { credentialKey: 'password', selectors: [] },
  ],
  submit: [{ kind: 'textContent', value: 'כניסה' }],
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
