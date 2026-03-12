import { jest } from '@jest/globals';
/** Selector-fallback: Discount Bank — Round 2 (main page fallback CSS id) + Round 1 (iframe-first detection). */
import * as dotenv from 'dotenv';
import { type Page } from 'playwright';

import { waitUntilElementFound } from '../../Common/ElementsInteractions.js';
import { waitForNavigation } from '../../Common/Navigation.js';
import { CompanyTypes } from '../../Definitions.js';
import { ConcreteGenericScraper } from '../../Scrapers/Base/ConcreteGenericScraper.js';
import { type ILoginConfig } from '../../Scrapers/Base/Config/LoginConfig.js';
import { BROWSER_ARGS, SCRAPE_TIMEOUT } from './Helpers.js';
import {
  injectFormByInput,
  selectorErrorFor,
  VALID_REACHED_BANK,
} from './SelectorFallbackHelpers.js';

dotenv.config();

const hasCredentials = !!(
  process.env.DISCOUNT_ID &&
  process.env.DISCOUNT_PASSWORD &&
  process.env.DISCOUNT_NUM
);
const DESCRIBE_IF = hasCredentials ? describe : describe.skip;

const ERR = selectorErrorFor('id', 'password', 'num');

const BASE_CFG: ILoginConfig = {
  loginUrl: 'https://start.telebank.co.il/login/#/LOGIN_PAGE',
  fields: [
    {
      credentialKey: 'id',
      selectors: [
        { kind: 'css', value: '#WRONG_tzId' },
        { kind: 'css', value: '#tzId' },
      ],
    },
    {
      credentialKey: 'password',
      selectors: [
        { kind: 'css', value: '#WRONG_tzPassword' },
        { kind: 'css', value: '#tzPassword' },
      ],
    },
    {
      credentialKey: 'num',
      selectors: [
        { kind: 'css', value: '#WRONG_aidnum' },
        { kind: 'css', value: '#aidnum' },
      ],
    },
  ],
  submit: [
    { kind: 'css', value: '#WRONG_sendBtn' },
    { kind: 'css', value: '.sendBtn' },
  ],
  /**
   * Wait for the login form to be ready.
   * @param page - page to check
   * @returns true when ready
   */
  checkReadiness: async page => {
    await waitUntilElementFound(page, '#tzId');
  },
  /**
   * Handle post-submit navigation.
   * @param page - page for post-action
   * @returns true when done
   */
  postAction: async page => {
    try {
      await waitForNavigation(page);
    } catch {
      await page.waitForSelector('#general-error');
    }
  },
  possibleResults: {
    success: [
      'https://start.telebank.co.il/apollo/retail/#/MY_ACCOUNT_HOMEPAGE',
      'https://start.telebank.co.il/apollo/retail2/#/MY_ACCOUNT_HOMEPAGE',
      'https://start.telebank.co.il/apollo/retail2/',
    ],
    invalidPassword: [
      'https://start.telebank.co.il/apollo/core/templates/lobby/masterPage.html#/LOGIN_PAGE',
    ],
    changePassword: [
      'https://start.telebank.co.il/apollo/core/templates/lobby/masterPage.html#/PWD_RENEW',
    ],
  },
};

DESCRIBE_IF('E2E: Selector fallback — Discount', () => {
  beforeAll(() => {
    jest.setTimeout(SCRAPE_TIMEOUT);
  });

  it('Round 2 — wrong CSS id → fallback CSS id on same page → form reached', async () => {
    const result = await new ConcreteGenericScraper(
      {
        companyId: CompanyTypes.Discount,
        startDate: new Date(),
        shouldShowBrowser: false,
        args: BROWSER_ARGS,
        defaultTimeout: 60000,
      },
      BASE_CFG,
    ).scrape({ id: '000000000', password: 'FallbackTest123', num: '000000' });
    expect(result.errorMessage ?? '').not.toMatch(ERR);
    expect(VALID_REACHED_BANK).toContain(result.errorType);
  });

  it('Round 1 — form injected into iframe; iframe detected first and fields filled', async () => {
    const iframeCfg: ILoginConfig = {
      ...BASE_CFG,
      /**
       * Wait for the login form with iframe injection.
       * @param page - page to check
       * @returns true when ready
       */
      checkReadiness: async (page: Page): Promise<void> => {
        await waitUntilElementFound(page, '#tzId');
        await injectFormByInput(page, '#tzId');
      },
      /**
       * Handle post-submit navigation for iframe test.
       * @param page - page for post-action
       * @returns true when done
       */
      postAction: async (page: Page): Promise<void> => {
        try {
          await waitForNavigation(page, { timeout: 15000 });
        } catch {
          /* form lacks React handlers */
        }
      },
    };
    const result = await new ConcreteGenericScraper(
      {
        companyId: CompanyTypes.Discount,
        startDate: new Date(),
        shouldShowBrowser: false,
        args: BROWSER_ARGS,
        defaultTimeout: 60000,
      },
      iframeCfg,
    ).scrape({ id: '000000000', password: 'IframeRound4Test', num: '000000' });
    expect(result.errorMessage ?? '').not.toMatch(ERR);
    expect(VALID_REACHED_BANK).toContain(result.errorType);
  });
});
