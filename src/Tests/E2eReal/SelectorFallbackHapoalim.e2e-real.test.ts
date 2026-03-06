/** Selector-fallback: Hapoalim — Round 2 (main page fallback CSS id) + Round 1 (iframe injection). */
import { type Page } from 'playwright';

import { waitUntilElementFound } from '../../Common/ElementsInteractions';
import { waitForRedirect } from '../../Common/Navigation';
import { CompanyTypes } from '../../Definitions';
import { ConcreteGenericScraper } from '../../Scrapers/Base/ConcreteGenericScraper';
import { type LoginConfig } from '../../Scrapers/Base/LoginConfig';
import { BROWSER_ARGS, SCRAPE_TIMEOUT } from './Helpers';
import { injectFormByInput, selectorErrorFor, VALID_REACHED_BANK } from './SelectorFallbackHelpers';

const ERR = selectorErrorFor('userCode', 'password');
const BASE = 'https://login.bankhapoalim.co.il';

const BASE_CFG: LoginConfig = {
  loginUrl: `${BASE}/cgi-bin/poalwwwc?reqName=getLogonPage`,
  fields: [
    {
      credentialKey: 'userCode',
      selectors: [
        { kind: 'css', value: '#WRONG_userCode' },
        { kind: 'css', value: '#userCode' },
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
    { kind: 'css', value: '#WRONG_loginBtn' },
    { kind: 'css', value: '.login-btn' },
  ],
  checkReadiness:
    /**
     * Waits for the Hapoalim login user-code field to appear before filling inputs.
     *
     * @param page - the Playwright page to wait on
     */
    async page => {
      await waitUntilElementFound(page, '#userCode');
    },
  postAction:
    /**
     * Waits for a redirect after login submission, ignoring timeout errors.
     *
     * @param page - the Playwright page to wait on
     */
    async page => {
      await waitForRedirect(page, { timeout: 20000 }).catch(() => {
        /* no-op */
      });
    },
  possibleResults: {
    // Narrow patterns — /ng-portals/ alone is too broad and matches the auth redirect URL
    success: [`${BASE}/portalserver/HomePage`, /ng-portals\/rb\/he\/homepage/],
    invalidPassword: [/AUTHENTICATE.*errorcode=1\.6/],
    changePassword: [/ABOUTTOEXPIRE\/START/i],
  },
};

describe('E2E: Selector fallback — Hapoalim', () => {
  beforeAll(() => {
    jest.setTimeout(SCRAPE_TIMEOUT);
  });

  it('Round 2 — wrong CSS id → fallback CSS id → form reached', async () => {
    const result = await new ConcreteGenericScraper(
      {
        companyId: CompanyTypes.Hapoalim,
        startDate: new Date(),
        shouldShowBrowser: false,
        args: BROWSER_ARGS,
        defaultTimeout: 60000,
      },
      BASE_CFG,
    ).scrape({ userCode: 'INVALID_USER', password: 'FallbackTestHPO' } as {
      userCode: string;
      password: string;
    });
    expect(result.errorMessage ?? '').not.toMatch(ERR);
    // result.success=true is also valid: stub fetchData returns success when login works.
    if (!result.success) {
      expect(VALID_REACHED_BANK).toContain(result.errorType);
    }
  });

  it('Round 1 — form injected into iframe; iframe detected first and fields filled', async () => {
    const iframeCfg: LoginConfig = {
      ...BASE_CFG,
      checkReadiness:
        /**
         * Waits for the user-code field then injects it into an iframe for Round 1 testing.
         *
         * @param page - the Playwright page to interact with
         */
        async (page: Page) => {
          await waitUntilElementFound(page, '#userCode');
          await injectFormByInput(page, '#userCode');
        },
      postAction:
        /**
         * Waits for a redirect after iframe form submission, ignoring timeout errors.
         *
         * @param page - the Playwright page to wait on
         */
        async (page: Page) => {
          await waitForRedirect(page, { timeout: 10000 }).catch(() => {
            /* no-op */
          });
        },
    };
    const result = await new ConcreteGenericScraper(
      {
        companyId: CompanyTypes.Hapoalim,
        startDate: new Date(),
        shouldShowBrowser: false,
        args: BROWSER_ARGS,
        defaultTimeout: 60000,
      },
      iframeCfg,
    ).scrape({ userCode: 'INVALID_USER', password: 'IframeTestHPO' } as {
      userCode: string;
      password: string;
    });
    expect(result.errorMessage ?? '').not.toMatch(ERR);
    expect(VALID_REACHED_BANK).toContain(result.errorType);
  });
});
