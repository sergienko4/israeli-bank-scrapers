import { type Page } from 'playwright';

import {
  clickButton,
  elementPresentOnPage,
  fillInput,
  waitUntilElementFound,
} from '../../Common/ElementsInteractions.js';
import { resolveFieldContext } from '../../Common/SelectorResolver.js';
import { CompanyTypes } from '../../Definitions.js';
import type { LifecyclePromise } from '../Base/Interfaces/CallbackTypes.js';
import { type IFieldConfig, type ILoginConfig } from '../Base/LoginConfig.js';
import { SCRAPER_CONFIGURATION } from '../Registry/ScraperConfig.js';

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

/** Max login credentials with optional national ID for Flow B. */
interface IMaxCredentials {
  username: string;
  password: string;
  id?: string;
}

/**
 * Handle the optional second-login step in Max's Flow B.
 * If the ID form is not present (Flow A), this function is a no-op.
 * @param page - The Playwright page with the second login form.
 * @param credentials - The user's Max credentials including optional ID.
 * @returns True after the second step completes or is skipped.
 */
export async function maxHandleSecondLoginStep(
  page: Page,
  credentials: IMaxCredentials,
): Promise<boolean> {
  if (!credentials.id) return true;
  const pageUrl = page.url();
  const idCtx = await resolveFieldContext(page, MAX_ID_FIELD, pageUrl);
  if (!idCtx.isResolved) return true;
  await resolveAndFill(page, MAX_USERNAME_FIELD, credentials.username);
  await resolveAndFill(page, MAX_PASSWORD_FIELD, credentials.password);
  await fillInput(idCtx.context, idCtx.selector, credentials.id);
  const submitSelector = 'app-user-login-form .general-button.send-me-code';
  await clickButton(page, submitSelector);
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
 * Wait for the Max post-login page to resolve to a known outcome.
 * @param page - The Playwright page to observe after login submission.
 * @returns True after a post-login indicator is detected.
 */
async function maxPostAction(page: Page): LifecyclePromise {
  if (page.url().startsWith('https://www.max.co.il/homepage')) return;
  await Promise.race([
    page.waitForURL('**/homepage/**', { timeout: 20000 }),
    waitUntilElementFound(page, '#popupWrongDetails', { visible: true }),
    waitUntilElementFound(page, '#popupCardHoldersLoginError', { visible: true }),
  ]);
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
  postAction: maxPostAction,
  waitUntil: 'domcontentloaded',
  possibleResults: {
    success: [checkMaxSuccess],
    changePassword: [`${CFG.urls.base}/renew-password`],
    invalidPassword: [checkMaxInvalidPassword],
    unknownError: [checkMaxUnknownError],
  },
};
