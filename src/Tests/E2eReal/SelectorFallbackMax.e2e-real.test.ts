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
import { BROWSER_ARGS, SCRAPE_TIMEOUT } from './Helpers.js';
import { selectorErrorFor, VALID_REACHED_BANK } from './SelectorFallbackHelpers.js';

const ERR = selectorErrorFor('username', 'password');

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
    const closeBtn = page.getByRole('button', { name: /סגור|close/i });
    if (await closeBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await closeBtn.click();
    }
    await clickButton(page, '.personal-area > a.go-to-personal-area');
    const privateLoc = page.locator('.login-link#private');
    if ((await privateLoc.count()) > 0) await privateLoc.click();
    await waitUntilElementFound(page, '#login-password-link', { visible: true });
    await clickButton(page, '#login-password-link');
    await waitUntilElementFound(page, '#login-password.tab-pane.active app-user-login-form', {
      visible: true,
    });
    const noFrame = page.frames().at(-999);
    return noFrame;
  },
  /**
   * Waits for redirect or error popup after login submission.
   * @param page - Playwright page to wait for post-login navigation.
   * @returns True when post-login condition is detected.
   */
  postAction: async (page: Page): Promise<void> => {
    const errorTexts = ['שכחת את הפרטים?', 'או לשחזר בקלות'];
    const errorWaiters = errorTexts.map(text =>
      page.getByText(text).first().waitFor({ state: 'visible', timeout: 20000 }),
    );
    await Promise.race([
      waitForRedirect(page, {
        timeout: 20000,
        ignoreList: ['https://www.max.co.il', 'https://www.max.co.il/'],
      }),
      ...errorWaiters,
    ]).catch(() => {
      // Expected: race may reject when none of the conditions match within timeout
    });
  },
  possibleResults: {
    success: ['https://www.max.co.il/homepage/personal'],
    changePassword: ['https://www.max.co.il/renew-password'],
    invalidPassword: [
      async (opts): Promise<boolean> => {
        const pg = opts?.page;
        if (!pg) return false;
        const texts = ['שכחת את הפרטים?', 'או לשחזר בקלות'];
        const checks = texts.map(t => pg.getByText(t).first().isVisible());
        const results = await Promise.all(checks);
        return results.some(Boolean);
      },
    ],
    unknownError: [
      async (opts): Promise<boolean> => {
        const pg = opts?.page;
        if (!pg) return false;
        const texts = ['שכחת את הפרטים?', 'או לשחזר בקלות'];
        const checks = texts.map(t => pg.getByText(t).first().isVisible());
        const results = await Promise.all(checks);
        return results.some(Boolean);
      },
    ],
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
