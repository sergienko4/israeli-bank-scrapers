import { jest } from '@jest/globals';
/** Selector-fallback: Max — Round 2 (wrong CSS id → fallback CSS id on same page).
 * Max has a complex preAction (popups, password tab navigation) before form fill.
 * This test proves the selector resolution still works correctly with that preAction.
 */
import { type Frame, type Page } from 'playwright-core';

import { clickButton, waitUntilElementFound } from '../../Common/ElementsInteractions.js';
import { waitForRedirect } from '../../Common/Navigation.js';
import { CompanyTypes } from '../../Definitions.js';
import { ConcreteGenericScraper } from '../../Scrapers/Base/ConcreteGenericScraper.js';
import { type ILoginConfig } from '../../Scrapers/Base/Config/LoginConfig.js';
import {
  isErrorTextVisible,
  WRONG_DETAILS_TEXTS,
} from '../../Scrapers/Max/Config/MaxLoginConfig.js';
import { BROWSER_ARGS, SCRAPE_TIMEOUT } from './Helpers.js';
import { selectorErrorFor, VALID_REACHED_BANK } from './SelectorFallbackHelpers.js';

const ERR = selectorErrorFor('username', 'password');

/**
 * Adapter: wraps production isErrorTextVisible for possibleResults signature.
 * @param opts - Options containing the Playwright page.
 * @param opts.page - The Playwright page to inspect.
 * @returns True if any error indicator text is visible.
 */
async function isErrorTextOnPage(opts?: { page?: Page }): Promise<boolean> {
  if (!opts?.page) return false;
  return isErrorTextVisible(opts.page);
}

/** No iframe override — preAction runs on the main page. */
const NO_FRAME: Frame | undefined = ([] as Frame[]).shift();

/**
 * Dismiss the close/popup button if visible on the page.
 * @param page - Playwright page to check for popup.
 * @returns True if popup was dismissed, false if not present.
 */
async function dismissClosePopup(page: Page): Promise<boolean> {
  const closeEl = page.getByText(/סגור|close/i).first();
  if (await closeEl.isVisible({ timeout: 1000 }).catch(() => false)) {
    await closeEl.click();
    return true;
  }
  return false;
}

/**
 * Navigate to the personal area login page.
 * @param page - Playwright page to navigate.
 * @returns True after navigation completes.
 */
async function navigateToPersonalArea(page: Page): Promise<boolean> {
  await clickButton(page, '.personal-area > a.go-to-personal-area');
  return true;
}

/**
 * Select the password login tab and wait for the form.
 * @param page - Playwright page to interact with.
 * @returns True after the password tab form is visible.
 */
async function selectPasswordTab(page: Page): Promise<boolean> {
  const privateLoc = page.locator('.login-link#private');
  if ((await privateLoc.count()) > 0) await privateLoc.click();
  await waitUntilElementFound(page, '#login-password-link', { visible: true });
  await clickButton(page, '#login-password-link');
  await waitUntilElementFound(page, '#login-password.tab-pane.active app-user-login-form', {
    visible: true,
  });
  return true;
}

/**
 * Build waitFor promises for each known error text.
 * @param page - Playwright page to observe.
 * @returns Array of promises that resolve to true when error text is visible.
 */
function buildErrorWaiters(page: Page): Promise<boolean>[] {
  return WRONG_DETAILS_TEXTS.map(async (text): Promise<boolean> => {
    await page.getByText(text).first().waitFor({ state: 'visible', timeout: 20000 });
    return true;
  });
}

/**
 * Race redirect against error text visibility after login submission.
 * @param page - Playwright page to observe after submit.
 * @returns True after a post-login condition is detected or timeout.
 */
async function waitForRedirectOrErrors(page: Page): Promise<boolean> {
  const redirectPromise = waitForRedirect(page, {
    timeout: 20000,
    ignoreList: ['https://www.max.co.il', 'https://www.max.co.il/'],
  });
  return Promise.race([redirectPromise.then((): true => true), ...buildErrorWaiters(page)]);
}

const BASE_CFG: ILoginConfig = {
  loginUrl: 'https://www.max.co.il/login',
  fields: [
    {
      credentialKey: 'username',
      selectors: [
        { kind: 'css', value: '#WRONG_user-name' },
        { kind: 'css', value: '#user-name' },
      ],
    },
    {
      credentialKey: 'password',
      selectors: [
        { kind: 'css', value: '#WRONG_password' },
        { kind: 'css', value: '#password' },
      ],
    },
  ],
  submit: [
    { kind: 'css', value: '#WRONG_sendBtn' },
    { kind: 'css', value: 'app-user-login-form .general-button.send-me-code' },
  ],
  waitUntil: 'domcontentloaded',
  /**
   * Waits for personal area link to appear.
   * @param page - Playwright page to wait for readiness indicator.
   * @returns True when readiness indicator is visible.
   */
  checkReadiness: async (page: Page): Promise<void> => {
    await waitUntilElementFound(page, '.personal-area > a.go-to-personal-area', { visible: true });
  },
  /**
   * Navigates to password login tab via popup dismissal and tab clicks.
   * @param page - Playwright page to execute pre-login actions on.
   * @returns Resolved promise after pre-login navigation completes (no frame override).
   */
  preAction: async (page: Page): Promise<Frame | undefined> => {
    await dismissClosePopup(page);
    await navigateToPersonalArea(page);
    await selectPasswordTab(page);
    return NO_FRAME;
  },
  /**
   * Waits for redirect or error popup after login submission.
   * @param page - Playwright page to wait for post-login navigation.
   * @returns True when post-login condition is detected.
   */
  postAction: async (page: Page): Promise<void> => {
    await waitForRedirectOrErrors(page);
  },
  possibleResults: {
    success: ['https://www.max.co.il/homepage/personal'],
    changePassword: ['https://www.max.co.il/renew-password'],
    invalidPassword: [isErrorTextOnPage],
    unknownError: [isErrorTextOnPage],
  },
};

describe('E2E: Selector fallback — Max', () => {
  beforeAll(() => {
    jest.setTimeout(SCRAPE_TIMEOUT);
  });

  it('Round 2 — wrong CSS id → fallback CSS id → form reached despite complex preAction', async () => {
    const result = await new ConcreteGenericScraper(
      {
        companyId: CompanyTypes.Max,
        startDate: new Date(),
        shouldShowBrowser: false,
        args: BROWSER_ARGS,
        defaultTimeout: 60000,
      },
      BASE_CFG,
    ).scrape({ username: 'INVALID_USER', password: 'FallbackTestMAX' } as {
      username: string;
      password: string;
    });
    expect(result.errorMessage ?? '').not.toMatch(ERR);
    if (!result.success) {
      expect(VALID_REACHED_BANK).toContain(result.errorType);
    }
  });
});
