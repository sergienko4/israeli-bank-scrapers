import { type Page } from 'playwright';

import { getDebug } from '../../Common/Debug.js';
import { capturePageText, elementPresentOnPage } from '../../Common/ElementsInteractions.js';
import {
  findFormByField,
  wellKnownPlaceholder,
  wellKnownSubmitButton,
} from '../../Common/WellKnownLocators.js';
import { CompanyTypes } from '../../Definitions.js';
import type { LifecyclePromise } from '../Base/Interfaces/CallbackTypes.js';
import { type ILoginConfig } from '../Base/LoginConfig.js';
import { SCRAPER_CONFIGURATION } from '../Registry/ScraperConfig.js';

const LOG = getDebug('max-login');
const CFG = SCRAPER_CONFIGURATION.banks[CompanyTypes.Max];

/** Hebrew phrases that indicate Max is requesting ID verification after login. */
const SECOND_LOGIN_INDICATORS: readonly string[] = [
  'נבקש למלא את מספר תעודת הזהות',
  'מלא את מספר תעודת הזהות',
  'תעודת הזהות',
];

/** Max login credentials with optional national ID for Flow B. */
interface IMaxCredentials {
  username: string;
  password: string;
  id?: string;
}

/**
 * Detect whether the page is showing an ID verification prompt.
 * Scans visible page text for indicator phrases.
 * @param page - The Playwright page to scan.
 * @returns True if any indicator phrase is found in the page text.
 */
export async function detectIdVerification(page: Page): Promise<boolean> {
  const pageText = await capturePageText(page);
  return SECOND_LOGIN_INDICATORS.some(ind => pageText.includes(ind));
}

/**
 * Fill all three login fields (ID, username, password) and submit the form.
 * Scoped to the form that contains the username field — avoids the hidden OTP tab.
 * @param page - The Playwright page with the ID verification form.
 * @param credentials - The user's Max credentials including ID.
 * @returns True after the form is submitted.
 */
async function fillAndSubmitIdForm(page: Page, credentials: IMaxCredentials): Promise<boolean> {
  const form = findFormByField(page, 'username');
  const idField = wellKnownPlaceholder(form, 'id');
  await idField.waitFor({ state: 'visible', timeout: 10000 });
  await idField.fill(credentials.id ?? '');
  LOG.info('second-login: ID filled');
  await wellKnownPlaceholder(form, 'username').fill(credentials.username);
  await wellKnownPlaceholder(form, 'password').fill(credentials.password);
  LOG.info('second-login: username + password re-filled');
  await wellKnownSubmitButton(form).click();
  await page.waitForTimeout(1000);
  LOG.info('second-login: form submitted with ID');
  return true;
}

/**
 * Check if ID prompt is showing and fill it if credentials include ID.
 * @param page - The Playwright page to check.
 * @param credentials - The user's Max credentials.
 * @returns True if ID was filled, false if skipped.
 */
async function handleIdPromptIfPresent(page: Page, credentials: IMaxCredentials): Promise<boolean> {
  if (!credentials.id) return false;
  const hasIdPrompt = await detectIdVerification(page);
  if (!hasIdPrompt) return false;
  LOG.info('post-login: ID verification detected — filling fields');
  await fillAndSubmitIdForm(page, credentials);
  return true;
}

/**
 * Handle Max post-login: check redirect, check ID prompt, wait for dashboard.
 *
 * Flow: submit → redirected to dashboard? → yes: done
 *                                         → no: ID prompt? → fill ID → submit → dashboard
 *
 * @param page - The Playwright page after login form submission.
 * @param credentials - The user's Max credentials including optional ID.
 * @returns True after the dashboard is reached.
 */
export async function maxHandleSecondLoginStep(
  page: Page,
  credentials: IMaxCredentials,
): Promise<boolean> {
  const isOnDashboard = page.url().includes('/homepage');
  if (isOnDashboard) {
    LOG.info('post-login: already on dashboard');
    return true;
  }
  await handleIdPromptIfPresent(page, credentials);
  LOG.info('post-login: waiting for dashboard redirect');
  await page.waitForURL('**/homepage/**', { timeout: 30000 });
  LOG.info('post-login: dashboard reached');
  return true;
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
 * Wait for a text element to become visible, then click it.
 * @param page - The Playwright page to search in.
 * @param text - The visible text to find and click.
 * @param timeout - Maximum wait time in ms.
 * @returns True after the element is clicked.
 */
async function waitAndClickText(page: Page, text: string, timeout = 10000): Promise<boolean> {
  const locator = page.getByText(text, { exact: false }).first();
  await locator.waitFor({ state: 'visible', timeout });
  await locator.click();
  return true;
}

/**
 * Navigate the Max login flow: personal area → private customers → password login.
 * Each step waits for visibility before clicking — no hardcoded sleeps.
 * @param page - The Playwright page to navigate.
 * @returns The login frame if found, or undefined when Max uses the main page.
 */
async function maxPreAction(page: Page): ReturnType<NonNullable<ILoginConfig['preAction']>> {
  await closePopupIfPresent(page);
  await waitAndClickText(page, 'כניסה לאיזור האישי');
  await waitAndClickText(page, 'לקוחות פרטיים');
  await waitAndClickText(page, 'כניסה עם סיסמה');
  const usernameField = wellKnownPlaceholder(page, 'username');
  await usernameField.waitFor({ state: 'visible', timeout: 15000 });
  // Max login uses the main page — no iframe needed
  const noFrame = page.frames().find(f => f.name() === '__nonexistent__');
  return noFrame;
}

/**
 * Post-action after second-login step completes.
 * Dashboard wait is handled by maxHandleSecondLoginStep — just log URL.
 * @param page - The Playwright page (already on dashboard).
 */
async function maxPostAction(page: Page): LifecyclePromise {
  const currentUrl = page.url();
  LOG.info('post-action: url=%s', currentUrl);
  await page.waitForTimeout(0);
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
