import { jest } from '@jest/globals';
/** Selector-fallback: Hapoalim — Round 2 (main page fallback CSS id) + Round 1 (iframe injection). */
import { type Page } from 'playwright-core';

import { waitUntilElementFound } from '../../Common/ElementsInteractions.js';
import { waitForRedirect } from '../../Common/Navigation.js';
import { CompanyTypes } from '../../Definitions.js';
import { ConcreteGenericScraper } from '../../Scrapers/Base/ConcreteGenericScraper.js';
import { type ILoginConfig } from '../../Scrapers/Base/Config/LoginConfig.js';
import { BROWSER_ARGS, SCRAPE_TIMEOUT } from './Helpers.js';
import {
  injectFormByInput,
  selectorErrorFor,
  VALID_REACHED_BANK,
} from './SelectorFallbackHelpers.js';

const ERR = selectorErrorFor('userCode', 'password');
const BASE = 'https://login.bankhapoalim.co.il';

const BASE_CFG: ILoginConfig = {
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
  /**
   * Waits for userCode field to appear on the page.
   * @param page - Playwright page to wait for readiness.
   * @returns True when userCode field is visible.
   */
  checkReadiness: async (page: Page): Promise<void> => {
    await waitUntilElementFound(page, '#userCode');
  },
  /**
   * Waits for redirect after login form submission.
   * @param page - Playwright page to wait for post-login redirect.
   * @returns True when post-login navigation completes.
   */
  postAction: async (page: Page): Promise<void> => {
    await waitForRedirect(page, { timeout: 20000 }).catch(() => {
      // Expected: redirect may not happen within timeout for invalid credentials
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
    const iframeCfg: ILoginConfig = {
      ...BASE_CFG,
      /**
       * Waits for userCode field and injects iframe form for testing.
       * @param page - Playwright page to wait for readiness and inject iframe form.
       * @returns True when readiness check and iframe injection complete.
       */
      checkReadiness: async (page: Page): Promise<void> => {
        await waitUntilElementFound(page, '#userCode');
        await injectFormByInput(page, '#userCode');
      },
      /**
       * Waits for redirect after iframe form submission.
       * @param page - Playwright page to wait for post-login redirect.
       * @returns True when post-login navigation completes.
       */
      postAction: async (page: Page): Promise<void> => {
        await waitForRedirect(page, { timeout: 10000 }).catch(() => {
          // Expected: redirect may not happen within timeout for invalid credentials
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
