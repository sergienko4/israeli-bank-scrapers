import { jest } from '@jest/globals';
/** Selector-fallback: Max — Round 2 (wrong CSS id → fallback CSS id on same page).
 * Max has a complex preAction (popups, password tab navigation) before form fill.
 * This test proves the selector resolution still works correctly with that preAction.
 */
import { type Frame, type Page } from 'playwright';

import {
  clickButton,
  elementPresentOnPage,
  waitUntilElementFound,
} from '../../Common/ElementsInteractions.js';
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
    await waitUntilElementFound(page, 'text=כניסה לאיזור האישי', { visible: true });
  },
  /**
   * Navigates to password login tab via popup dismissal and tab clicks.
   * @param page - Playwright page to execute pre-login actions on.
   * @returns Resolved promise after pre-login navigation completes (no frame override).
   */
  preAction: async (page: Page): Promise<Frame | undefined> => {
    const isPopupPresent = await elementPresentOnPage(page, 'role=button[name=/סגור|close/i]');
    if (isPopupPresent) await clickButton(page, 'role=button[name=/סגור|close/i]');
    await clickButton(page, 'text=כניסה לאיזור האישי');
    const isPrivateLinkPresent = await elementPresentOnPage(page, 'text=לקוחות פרטיים');
    if (isPrivateLinkPresent) await clickButton(page, 'text=לקוחות פרטיים');
    await waitUntilElementFound(page, 'text=כניסה עם סיסמה', { visible: true });
    await clickButton(page, 'text=כניסה עם סיסמה');
    await waitUntilElementFound(page, 'text=שם משתמש', { visible: true });
    const noFrame = page.frames().at(-999);
    return noFrame;
  },
  /**
   * Waits for redirect or error popup after login submission.
   * @param page - Playwright page to wait for post-login navigation.
   * @returns True when post-login condition is detected.
   */
  postAction: async (page: Page): Promise<void> => {
    await Promise.race([
      waitForRedirect(page, {
        timeout: 20000,
        ignoreList: ['https://www.max.co.il', 'https://www.max.co.il/'],
      }),
      waitUntilElementFound(page, 'role=dialog >> text=פרטים שגויים', { visible: true }),
      waitUntilElementFound(page, 'role=dialog >> text=שגיאה', { visible: true }),
    ]).catch(() => {
      // Expected: race may reject when none of the conditions match within timeout
    });
  },
  possibleResults: {
    success: ['https://www.max.co.il/homepage/personal'],
    changePassword: ['https://www.max.co.il/renew-password'],
    invalidPassword: [
      async (opts): Promise<boolean> =>
        !!(
          opts?.page && (await elementPresentOnPage(opts.page, 'role=dialog >> text=פרטים שגויים'))
        ),
    ],
    unknownError: [
      async (opts): Promise<boolean> =>
        !!(opts?.page && (await elementPresentOnPage(opts.page, 'role=dialog >> text=שגיאה'))),
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
