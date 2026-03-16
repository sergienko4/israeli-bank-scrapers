import { type Page } from 'playwright-core';

import { pageEvalAll, waitUntilElementFound } from '../../../Common/ElementsInteractions.js';
import { waitForNavigation } from '../../../Common/Navigation.js';
import { CompanyTypes } from '../../../Definitions.js';
import { type ILoginConfig } from '../../Base/Config/LoginConfig.js';
import type { LifecyclePromise } from '../../Base/Interfaces/CallbackTypes.js';
import { SCRAPER_CONFIGURATION } from '../../Registry/Config/ScraperConfig.js';
import { WELL_KNOWN_DASHBOARD_SELECTORS } from '../../Registry/WellKnownSelectors.js';

const CFG = SCRAPER_CONFIGURATION.banks[CompanyTypes.Leumi];

/** Hebrew error message displayed when Leumi login credentials are invalid. */
export const LEUMI_INVALID_PASSWORD_MSG = 'אחד או יותר מפרטי ההזדהות שמסרת שגויים. ניתן לנסות שוב';
const LEUMI_ACCOUNT_BLOCKED_MSG = 'המנוי חסום';

/** Build a combined XPath matching any WELL_KNOWN loginLink text. */
const LOGIN_LINK_XPATH = buildLoginLinkXpath();

/**
 * Build an XPath that matches anchor elements containing any login text.
 * @returns A Playwright xpath= selector string.
 */
function buildLoginLinkXpath(): string {
  const texts = WELL_KNOWN_DASHBOARD_SELECTORS.loginLink.map(c => c.value);
  const conditions = texts.map(t => `contains(normalize-space(.), "${t}")`);
  return 'xpath=//a[' + conditions.join(' or ') + ']';
}

/**
 * Find the login link href using WELL_KNOWN text candidates via combined XPath.
 * @param page - The Playwright page instance.
 * @returns The login URL string.
 */
async function findLoginLinkHref(page: Page): Promise<string> {
  const loc = page.locator(LOGIN_LINK_XPATH).first();
  return loc.evaluate(el => (el as HTMLAnchorElement).href);
}

/**
 * Navigate to the Leumi login page via the login link.
 * @param page - The Playwright page instance.
 * @returns True after navigation completes.
 */
async function navigateToLeumiLogin(page: Page): Promise<boolean> {
  await page.getByText('כניסה').first().waitFor({ state: 'visible' });
  const loginUrl = await findLoginLinkHref(page);
  await page.goto(loginUrl);
  await waitForNavigation(page, { waitUntil: 'networkidle' });
  return true;
}

/**
 * Wait for all Leumi login form fields to render.
 * @param page - The Playwright page instance.
 * @returns True after all fields are visible.
 */
async function waitForLeumiFormFields(page: Page): Promise<boolean> {
  await Promise.all([
    page.getByPlaceholder('שם משתמש').first().waitFor({ state: 'visible' }),
    page.getByPlaceholder('סיסמה').first().waitFor({ state: 'visible' }),
    page.getByRole('button', { name: /כניסה/ }).first().waitFor({ state: 'visible' }),
  ]);
  return true;
}

/**
 * Navigate to the Leumi login form and wait for all input fields to render.
 * @param page - The Playwright page to check readiness on.
 * @returns True after the login form is ready.
 */
async function leumiCheckReadiness(page: Page): LifecyclePromise {
  await navigateToLeumiLogin(page);
  await waitForLeumiFormFields(page);
}

/** XPath selector for the skip-to-account link by visible text. */
const SKIP_LINK_XPATH = 'xpath=//a[contains(normalize-space(.), "דלג לחשבון")]';

/**
 * Wait for the Leumi post-login page to resolve to a known outcome.
 * @param page - The Playwright page to observe after login submission.
 * @returns True after a post-login indicator is detected.
 */
async function leumiPostAction(page: Page): LifecyclePromise {
  const errXpath = 'xpath=//div[contains(string(),"' + LEUMI_INVALID_PASSWORD_MSG + '")]';
  await Promise.race([
    waitUntilElementFound(page, SKIP_LINK_XPATH, { visible: true, timeout: 60000 }),
    page.waitForURL('**/ebanking/**', { timeout: 60000 }),
    waitUntilElementFound(page, errXpath, { timeout: 60000 }),
    page.waitForURL('**/changepassword**', { timeout: 60000 }),
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

/** XPath to find the error message container by its text content. */
const INVALID_PW_XPATH =
  'xpath=//*[contains(normalize-space(.), "' + LEUMI_INVALID_PASSWORD_MSG + '")]';

/**
 * Check whether the invalid-password error message is visible on the page.
 * @param opts - The possible-result check options with page reference.
 * @param opts.page - The Playwright page to inspect for the error message.
 * @returns True if the invalid password message is present.
 */
async function checkInvalidPassword(opts?: { page?: Page }): Promise<boolean> {
  if (!opts?.page) return false;
  const text = await pageEvalAll(opts.page, {
    selector: INVALID_PW_XPATH,
    defaultResult: '',
    callback: extractFirstInnerText,
  });
  return text.startsWith(LEUMI_INVALID_PASSWORD_MSG);
}

/**
 * Check whether the account-blocked error header is present.
 * @param opts - The possible-result check options with page reference.
 * @param opts.page - The Playwright page to inspect for the blocked header.
 * @returns True if the account blocked message is present.
 */
async function checkAccountBlocked(opts?: { page?: Page }): Promise<boolean> {
  if (!opts?.page) return false;
  return checkLeumiMessage(
    opts.page,
    `xpath=//*[contains(normalize-space(.), "${LEUMI_ACCOUNT_BLOCKED_MSG}")]`,
    LEUMI_ACCOUNT_BLOCKED_MSG,
  );
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
