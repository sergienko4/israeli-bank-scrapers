/**
 * Selector-fallback: Max — Round 2 (wrong CSS id → fallback CSS id on same page).
 * Max has a complex preAction (popups, password tab navigation) before form fill.
 * This test proves the selector resolution still works correctly with that preAction.
 */
import { type Page } from 'playwright';
import { CompanyTypes } from '../../definitions';
import { ConcreteGenericScraper } from '../../scrapers/concrete-generic-scraper';
import { type LoginConfig } from '../../scrapers/login-config';
import { SCRAPE_TIMEOUT, BROWSER_ARGS } from './helpers';
import { clickButton, elementPresentOnPage, waitUntilElementFound } from '../../helpers/elements-interactions';
import { waitForRedirect } from '../../helpers/navigation';
import { VALID_REACHED_BANK, selectorErrorFor } from './selector-fallback-helpers';

const ERR = selectorErrorFor('username', 'password');

const baseCfg: LoginConfig = {
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
  checkReadiness: async (page: Page) => {
    await waitUntilElementFound(page, '.personal-area > a.go-to-personal-area', { visible: true });
  },
  preAction: async (page: Page) => {
    if (await elementPresentOnPage(page, '#closePopup')) await clickButton(page, '#closePopup');
    await clickButton(page, '.personal-area > a.go-to-personal-area');
    if (await elementPresentOnPage(page, '.login-link#private')) await clickButton(page, '.login-link#private');
    await waitUntilElementFound(page, '#login-password-link', { visible: true });
    await clickButton(page, '#login-password-link');
    await waitUntilElementFound(page, '#login-password.tab-pane.active app-user-login-form', { visible: true });
  },
  postAction: async (page: Page) => {
    await Promise.race([
      waitForRedirect(page, { timeout: 20000, ignoreList: ['https://www.max.co.il', 'https://www.max.co.il/'] }),
      page.waitForSelector('#popupWrongDetails', { state: 'visible', timeout: 20000 }),
      page.waitForSelector('#popupCardHoldersLoginError', { state: 'visible', timeout: 20000 }),
    ]).catch(() => {});
  },
  possibleResults: {
    success: ['https://www.max.co.il/homepage/personal'],
    changePassword: ['https://www.max.co.il/renew-password'],
    invalidPassword: [async opts => !!(opts?.page && (await opts.page.$('#popupWrongDetails')))],
    unknownError: [async opts => !!(opts?.page && (await opts.page.$('#popupCardHoldersLoginError')))],
  },
};

describe('E2E: Selector fallback — Max', () => {
  beforeAll(() => {
    jest.setTimeout(SCRAPE_TIMEOUT);
  });

  it('Round 2 — wrong CSS id → fallback CSS id → form reached despite complex preAction', async () => {
    const result = await new ConcreteGenericScraper(
      {
        companyId: CompanyTypes.max,
        startDate: new Date(),
        showBrowser: false,
        args: BROWSER_ARGS,
        defaultTimeout: 60000,
      },
      baseCfg,
    ).scrape({ username: 'INVALID_USER', password: 'FallbackTestMAX' } as any);
    expect(result.errorMessage ?? '').not.toMatch(ERR);
    if (!result.success) {
      expect(VALID_REACHED_BANK).toContain(result.errorType);
    }
  });
});
