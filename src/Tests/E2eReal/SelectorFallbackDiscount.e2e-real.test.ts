/** Selector-fallback: Discount Bank — Round 2 (wrong CSS id → fallback CSS id on same page) + Round 4 (form injected into iframe). */
import * as dotenv from 'dotenv';
import { type Page } from 'playwright';
import { CompanyTypes } from '../../Definitions';
import { ConcreteGenericScraper } from '../../Scrapers/ConcreteGenericScraper';
import { type LoginConfig } from '../../Scrapers/LoginConfig';
import { SCRAPE_TIMEOUT, BROWSER_ARGS } from './Helpers';
import { waitForNavigation } from '../../Helpers/Navigation';
import { waitUntilElementFound } from '../../Helpers/ElementsInteractions';
import { VALID_REACHED_BANK, selectorErrorFor, injectFormByInput } from './SelectorFallbackHelpers';

dotenv.config();

const hasCredentials = !!(
  process.env.DISCOUNT_ID &&
  process.env.DISCOUNT_PASSWORD &&
  process.env.DISCOUNT_NUM
);
const describeIf = hasCredentials ? describe : describe.skip;

const ERR = selectorErrorFor('id', 'password', 'num');

const baseCfg: LoginConfig = {
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
  checkReadiness: async page => {
    await waitUntilElementFound(page, '#tzId');
  },
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

describeIf('E2E: Selector fallback — Discount', () => {
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
      baseCfg,
    ).scrape({ id: '000000000', password: 'FallbackTest123', num: '000000' });
    expect(result.errorMessage ?? '').not.toMatch(ERR);
    expect(VALID_REACHED_BANK).toContain(result.errorType);
  });

  it('Round 4 — form injected into iframe; Round 4 detects iframe and fills fields', async () => {
    const iframeCfg: LoginConfig = {
      ...baseCfg,
      checkReadiness: async (page: Page) => {
        await waitUntilElementFound(page, '#tzId');
        await injectFormByInput(page, '#tzId');
      },
      postAction: async (page: Page) => {
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
