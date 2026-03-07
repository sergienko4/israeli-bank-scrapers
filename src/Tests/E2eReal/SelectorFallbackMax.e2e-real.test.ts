/**
 * Selector-fallback: Max — Round 2 (wrong CSS id → fallback CSS id on same page).
 * Max has a complex preAction (popups, password tab navigation) before form fill.
 * This test proves the selector resolution still works correctly with that preAction.
 */
import { type Frame, type Page } from 'playwright';

import {
  clickButton,
  elementPresentOnPage,
  waitUntilElementFound,
} from '../../Common/ElementsInteractions';
import { waitForRedirect } from '../../Common/Navigation';
import { CompanyTypes } from '../../Definitions';
import type { FoundResult } from '../../Interfaces/Common/FoundResult';
import type { IDoneResult } from '../../Interfaces/Common/StepResult';
import { ConcreteGenericScraper } from '../../Scrapers/Base/ConcreteGenericScraper';
import { type ILoginConfig } from '../../Scrapers/Base/LoginConfig';
import { BROWSER_ARGS, SCRAPE_TIMEOUT } from './Helpers';
import { selectorErrorFor, VALID_REACHED_BANK } from './SelectorFallbackHelpers';

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
  checkReadiness:
    /**
     * Waits for the Max personal-area link to confirm the page is loaded.
     *
     * @param page - the Playwright page to wait on
     * @returns a resolved IDoneResult after the link is found
     */
    async (page: Page): Promise<IDoneResult> => {
      await waitUntilElementFound(page, '.personal-area > a.go-to-personal-area', {
        visible: true,
      });
      return { done: true };
    },
  preAction:
    /**
     * Closes any popup, navigates to the password login tab, and waits for the login form.
     *
     * @param page - the Playwright page to interact with
     * @returns a FoundResult indicating no iframe is needed
     */
    async (page: Page): Promise<FoundResult<Frame>> => {
      if (await elementPresentOnPage(page, '#closePopup')) await clickButton(page, '#closePopup');
      await clickButton(page, '.personal-area > a.go-to-personal-area');
      if (await elementPresentOnPage(page, '.login-link#private'))
        await clickButton(page, '.login-link#private');
      await waitUntilElementFound(page, '#login-password-link', { visible: true });
      await clickButton(page, '#login-password-link');
      await waitUntilElementFound(page, '#login-password.tab-pane.active app-user-login-form', {
        visible: true,
      });
      return { isFound: false };
    },
  postAction:
    /**
     * Waits for a redirect or an error popup after login submission, ignoring timeout errors.
     *
     * @param page - the Playwright page to wait on
     * @returns a resolved IDoneResult after the race completes
     */
    async (page: Page): Promise<IDoneResult> => {
      await Promise.race([
        waitForRedirect(page, {
          timeout: 20000,
          ignoreList: ['https://www.max.co.il', 'https://www.max.co.il/'],
        }),
        page.waitForSelector('#popupWrongDetails', { state: 'visible', timeout: 20000 }),
        page.waitForSelector('#popupCardHoldersLoginError', { state: 'visible', timeout: 20000 }),
      ]).catch(() => {
        /* no-op */
      });
      return { done: true };
    },
  possibleResults: {
    success: ['https://www.max.co.il/homepage/personal'],
    changePassword: ['https://www.max.co.il/renew-password'],
    invalidPassword: [
      async (opts?: { page?: Page }): Promise<boolean> =>
        !!(opts?.page && (await opts.page.$('#popupWrongDetails'))),
    ],
    unknownError: [
      async (opts?: { page?: Page }): Promise<boolean> =>
        !!(opts?.page && (await opts.page.$('#popupCardHoldersLoginError'))),
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
