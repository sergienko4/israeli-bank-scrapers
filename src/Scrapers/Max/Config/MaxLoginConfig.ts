import { type Page } from 'playwright';

import { getDebug } from '../../../Common/Debug.js';
import {
  clickButton,
  elementPresentOnPage,
  fillInput,
  waitUntilElementFound,
} from '../../../Common/ElementsInteractions.js';
import { resolveFieldContext } from '../../../Common/SelectorResolver.js';
import { CompanyTypes } from '../../../Definitions.js';
import { type IFieldConfig, type ILoginConfig } from '../../Base/Config/LoginConfig.js';
import type { LifecyclePromise } from '../../Base/Interfaces/CallbackTypes.js';
import { SCRAPER_CONFIGURATION } from '../../Registry/Config/ScraperConfig.js';

const LOG = getDebug('max-login');
const CFG = SCRAPER_CONFIGURATION.banks[CompanyTypes.Max];

const MAX_USERNAME_FIELD: IFieldConfig = { credentialKey: 'username', selectors: [] };
const MAX_PASSWORD_FIELD: IFieldConfig = { credentialKey: 'password', selectors: [] };
const MAX_ID_FIELD: IFieldConfig = { credentialKey: 'id', selectors: [] };

/**
 * Resolve a login field via SelectorResolver and fill it with the given value.
 * @param page - The Playwright page to resolve and fill in.
 * @param field - The field config with credential key and selectors.
 * @param value - The text value to enter into the input.
 * @returns True if the field was found and filled, false if not resolved.
 */
async function resolveAndFill(page: Page, field: IFieldConfig, value: string): Promise<boolean> {
  const pageUrl = page.url();
  const ctx = await resolveFieldContext(page, field, pageUrl);
  if (!ctx.isResolved) return false;
  await fillInput(ctx.context, ctx.selector, value);
  return true;
}

/** Max login credentials with optional national ID. */
export interface IMaxCredentials {
  username: string;
  password: string;
  id?: string;
}

/** Hebrew phrases that indicate Max is asking for ID verification. */
const ID_FORM_INDICATORS = ['תעודת הזהות', 'תעודת זהות', 'ת.ז.'];

/**
 * Detect the Max ID verification form by scanning visible page text.
 * Waits briefly for the page to settle, then checks for ID-related Hebrew text.
 * @param page - The Playwright page to check.
 * @returns True if the page contains ID verification text.
 */
async function detectIdForm(page: Page): Promise<boolean> {
  await page.waitForTimeout(2000);
  const currentUrl = page.url();
  const bodyText = await page.evaluate(() => document.body.innerText);
  const snippet = bodyText.slice(0, 200).replace(/\n/g, ' ');
  const hasIdText = ID_FORM_INDICATORS.some(phrase => bodyText.includes(phrase));
  LOG.info('detectIdForm: url=%s hasIdText=%s snippet="%s"', currentUrl, hasIdText, snippet);
  return hasIdText;
}

/**
 * Fill the ID form: re-fill username + password + ID, then submit again.
 * @param page - The Playwright page with the ID form.
 * @param credentials - The user's Max credentials including ID.
 * @returns True after the form is submitted.
 */
async function fillIdFormAndSubmit(page: Page, credentials: IMaxCredentials): Promise<boolean> {
  await resolveAndFill(page, MAX_USERNAME_FIELD, credentials.username);
  await resolveAndFill(page, MAX_PASSWORD_FIELD, credentials.password);
  if (credentials.id) await resolveAndFill(page, MAX_ID_FIELD, credentials.id);
  const submitXpath = 'xpath=//button[contains(., "כניסה")]';
  await clickButton(page, submitXpath);
  await page.waitForTimeout(1000);
  return true;
}

/**
 * Try to click the first visible locator matching one of the given texts.
 * @param page - The Playwright page to search in.
 * @param text - The button text to look for.
 * @returns True if a visible element was clicked, false otherwise.
 */
async function tryClickVisible(page: Page, text: string): Promise<boolean> {
  const loc = page.locator(`text=${text}`).first();
  const isVisible = await loc.isVisible({ timeout: 3000 }).catch(() => false);
  if (isVisible) {
    await loc.click();
    return true;
  }
  return false;
}

/**
 * Force-click the first DOM element matching the given text.
 * @param page - The Playwright page to search in.
 * @param text - The button text to look for.
 * @returns True if an element was force-clicked, false otherwise.
 */
async function tryForceClick(page: Page, text: string): Promise<boolean> {
  const loc = page.locator(`text=${text}`).first();
  const count = await loc.count();
  if (count > 0) {
    await loc.click({ force: true });
    return true;
  }
  return false;
}

/**
 * Click the first visible or present element matching one of the given texts.
 * @param page - The Playwright page to search in.
 * @param texts - Ordered list of button texts to try.
 * @returns True if any element was clicked.
 */
async function clickFirstVisible(page: Page, texts: string[]): Promise<boolean> {
  const visibleChecks = texts.map(text => tryClickVisible(page, text));
  const visibleResults = await Promise.all(visibleChecks);
  if (visibleResults.some(Boolean)) return true;
  const forceChecks = texts.map(text => tryForceClick(page, text));
  const forceResults = await Promise.all(forceChecks);
  return forceResults.some(Boolean);
}

/**
 * Close the popup overlay if present on the page.
 * @param page - The Playwright page to check.
 * @returns True after the popup is closed or confirmed absent.
 */
async function closePopupIfPresent(page: Page): Promise<boolean> {
  const hasPopup = await elementPresentOnPage(page, '#closePopup');
  if (hasPopup) {
    await page.$eval('#closePopup', (el: HTMLElement) => {
      el.click();
    });
  }
  return true;
}

/**
 * Navigate the Max login flow: personal area → private customers → password login.
 * @param page - The Playwright page to navigate.
 * @returns The login frame if found, or undefined when Max uses the main page.
 */
async function maxPreAction(page: Page): ReturnType<NonNullable<ILoginConfig['preAction']>> {
  await closePopupIfPresent(page);
  await clickFirstVisible(page, ['כניסה לאיזור האישי']);
  await page.waitForTimeout(1500);
  await clickFirstVisible(page, ['לקוחות פרטיים']);
  await page.waitForTimeout(500);
  await clickFirstVisible(page, ['כניסה עם סיסמה']);
  await page.waitForSelector('input[placeholder*="שם משתמש"]', {
    state: 'visible',
    timeout: 15000,
  });
  // Max login uses the main page — no iframe needed
  const noFrame = page.frames().find(f => f.name() === '__nonexistent__');
  return noFrame;
}

/**
 * Wait for the Max dashboard or error indicator after submit.
 * @param page - The Playwright page to observe after login submission.
 * @returns True after a post-login indicator is detected.
 */
async function waitForDashboardOrError(page: Page): LifecyclePromise {
  const currentUrl = page.url();
  if (currentUrl.startsWith('https://www.max.co.il/homepage')) return;
  LOG.info('waitForDashboardOrError: url=%s', currentUrl);
  await Promise.race([
    page.waitForURL('**/homepage/**', { timeout: 60000 }),
    waitUntilElementFound(page, '#popupWrongDetails', { visible: true }),
    waitUntilElementFound(page, '#popupCardHoldersLoginError', { visible: true }),
  ]);
}

/**
 * Build the Max post-action: if ID field visible → fill all 3 fields → submit → dashboard.
 * @param credentials - The user's Max credentials with optional ID.
 * @returns An async post-action function for the login config.
 */
export function buildMaxPostAction(credentials: IMaxCredentials): (page: Page) => LifecyclePromise {
  const hasId = !!credentials.id;
  return async (page: Page): LifecyclePromise => {
    const entryUrl = page.url();
    LOG.info('postAction entry: url=%s hasId=%s', entryUrl, hasId);
    if (entryUrl.startsWith('https://www.max.co.il/homepage')) return;
    if (!credentials.id) return waitForDashboardOrError(page);
    const hasIdForm = await detectIdForm(page);
    if (!hasIdForm) return waitForDashboardOrError(page);
    LOG.info('postAction: ID form detected — filling username+password+ID');
    await fillIdFormAndSubmit(page, credentials);
    return waitForDashboardOrError(page);
  };
}

/**
 * Check readiness by waiting for the login entry point to appear.
 * @param page - The Playwright page to check.
 * @returns True when the entry point is visible.
 */
async function maxCheckReadiness(page: Page): LifecyclePromise {
  await page.waitForSelector('text=כניסה לאיזור האישי', {
    state: 'visible',
    timeout: 15000,
  });
}

/**
 * Check whether the current URL indicates a successful Max login.
 * @param opts - The possible-result check options with page reference.
 * @param opts.page - The Playwright page to inspect for the homepage URL.
 * @returns True if the page URL starts with the homepage path.
 */
function checkMaxSuccess(opts?: { page?: Page }): boolean {
  const url = opts?.page?.url() ?? '';
  return url.startsWith('https://www.max.co.il/homepage');
}

/**
 * Check whether the invalid-password popup is present.
 * @param opts - The possible-result check options with page reference.
 * @param opts.page - The Playwright page to inspect for the popup.
 * @returns True if the wrong-details popup is visible.
 */
async function checkMaxInvalidPassword(opts?: { page?: Page }): Promise<boolean> {
  if (!opts?.page) return false;
  return elementPresentOnPage(opts.page, '#popupWrongDetails');
}

/**
 * Check whether the card-holders login error popup is present.
 * @param opts - The possible-result check options with page reference.
 * @param opts.page - The Playwright page to inspect for the error popup.
 * @returns True if the card-holders error popup is visible.
 */
async function checkMaxUnknownError(opts?: { page?: Page }): Promise<boolean> {
  if (!opts?.page) return false;
  return elementPresentOnPage(opts.page, '#popupCardHoldersLoginError');
}

export const MAX_CONFIG: ILoginConfig = {
  loginUrl: CFG.urls.base,
  fields: [
    { credentialKey: 'username', selectors: [] },
    { credentialKey: 'password', selectors: [] },
  ],
  submit: [
    { kind: 'xpath', value: '//button[contains(., "כניסה")]' },
    { kind: 'css', value: 'app-user-login-form .general-button.send-me-code' },
  ],
  checkReadiness: maxCheckReadiness,
  preAction: maxPreAction,
  // postAction is set dynamically by MaxScraper.getLoginOptions with credentials
  waitUntil: 'domcontentloaded',
  possibleResults: {
    success: [checkMaxSuccess],
    changePassword: [`${CFG.urls.base}/renew-password`],
    invalidPassword: [checkMaxInvalidPassword],
    unknownError: [checkMaxUnknownError],
  },
};
