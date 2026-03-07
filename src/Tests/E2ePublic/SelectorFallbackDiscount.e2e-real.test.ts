/** Selector-fallback: Discount Bank — Round 2 (main page fallback CSS id) + Round 1 (iframe-first detection). */
import * as dotenv from 'dotenv';
import { type Page } from 'playwright';

import { waitUntilElementFound } from '../../Common/ElementsInteractions';
import { waitForNavigation } from '../../Common/Navigation';
import { CompanyTypes } from '../../Definitions';
import type { IDoneResult } from '../../Interfaces/Common/StepResult';
import { ConcreteGenericScraper } from '../../Scrapers/Base/ConcreteGenericScraper';
import { type ILoginConfig } from '../../Scrapers/Base/LoginConfig';
import { BROWSER_ARGS, SCRAPE_TIMEOUT } from './Helpers';
import { injectFormByInput, selectorErrorFor, VALID_REACHED_BANK } from './SelectorFallbackHelpers';

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
  checkReadiness:
    /**
     * Waits for the Discount login form ID field to appear before filling inputs.
     *
     * @param page - the Playwright page to wait on
     * @returns a resolved IDoneResult after the element is found
     */
    async (page): Promise<IDoneResult> => {
      await waitUntilElementFound(page, '#tzId');
      return { done: true };
    },
  postAction:
    /**
     * Waits for navigation after login or falls back to checking for a general error element.
     *
     * @param page - the Playwright page to wait on
     * @returns a resolved IDoneResult after navigation completes
     */
    async (page): Promise<IDoneResult> => {
      try {
        await waitForNavigation(page);
      } catch {
        await page.waitForSelector('#general-error');
      }
      return { done: true };
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
      checkReadiness:
        /**
         * Waits for the form then injects it into a srcdoc iframe to simulate iframe detection.
         *
         * @param page - the Playwright page to interact with
         * @returns a resolved IDoneResult after injection completes
         */
        async (page: Page): Promise<IDoneResult> => {
          await waitUntilElementFound(page, '#tzId');
          await injectFormByInput(page, '#tzId');
          return { done: true };
        },
      postAction:
        /**
         * Waits for navigation after iframe form submission, ignoring React handler errors.
         *
         * @param page - the Playwright page to wait on
         * @returns a resolved IDoneResult after navigation completes
         */
        async (page: Page): Promise<IDoneResult> => {
          try {
            await waitForNavigation(page, { timeout: 15000 });
          } catch {
            /* form lacks React handlers */
          }
          return { done: true };
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
