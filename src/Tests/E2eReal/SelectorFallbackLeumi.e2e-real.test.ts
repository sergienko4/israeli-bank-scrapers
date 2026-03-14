import { jest } from '@jest/globals';
/**
 * Selector-fallback: Leumi — Round 3 (WELL_KNOWN_SELECTORS dictionary).
 *
 * Leumi's own scraper uses input[placeholder="שם משתמש"] as its primary selector,
 * confirming the page has Hebrew placeholder attributes.
 * With WRONG CSS ids and NO explicit fallbacks configured, Round 3 must find the
 * login fields via the global WELL_KNOWN_SELECTORS Hebrew dictionary.
 */
import { type Page } from 'playwright';

import { waitUntilElementFound } from '../../Common/ElementsInteractions.js';
import { CompanyTypes } from '../../Definitions.js';
import { ConcreteGenericScraper } from '../../Scrapers/Base/ConcreteGenericScraper.js';
import { type ILoginConfig } from '../../Scrapers/Base/Config/LoginConfig.js';
import { BROWSER_ARGS, SCRAPE_TIMEOUT } from './Helpers.js';
import { selectorErrorFor, VALID_REACHED_BANK } from './SelectorFallbackHelpers.js';

const ERR = selectorErrorFor('username', 'password');

const LEUMI_WELL_KNOWN_CFG: ILoginConfig = {
  loginUrl: 'https://www.leumi.co.il/he',
  fields: [
    // NO fallback — relies entirely on WELL_KNOWN_SELECTORS.username + .password
    {
      credentialKey: 'username',
      selectors: [{ kind: 'css', value: '#WRONG_leumiUser_NO_FALLBACK' }],
    },
    {
      credentialKey: 'password',
      selectors: [{ kind: 'css', value: '#WRONG_leumiPass_NO_FALLBACK' }],
    },
  ],
  submit: [{ kind: 'css', value: "button[type='submit']" }],
  // Navigate from Leumi home to the actual login page that has Hebrew placeholder inputs
  /**
   * Navigate from Leumi home to the login page.
   * @param page - page to check readiness
   * @returns true when ready
   */
  checkReadiness: async (page: Page): Promise<void> => {
    await waitUntilElementFound(page, 'role=link[name="כניסה לחשבון"]');
    const href =
      (await page.locator('role=link[name="כניסה לחשבון"]').first().getAttribute('href')) ?? '';
    await page.goto(href, { waitUntil: 'networkidle' });
    await waitUntilElementFound(page, 'role=textbox[name="שם משתמש"]', { visible: true });
  },
  /**
   * Wait after form submission.
   * @param page - page for post-action
   * @returns true when done
   */
  postAction: async (page: Page): Promise<void> => {
    await page.waitForTimeout(3000);
  },
  possibleResults: {
    success: [/eBanking\/SO\/SPA\.aspx/i],
    invalidPassword: [
      async (opts): Promise<boolean> => {
        if (!opts?.page) return false;
        const txt = await opts.page.evaluate(() => document.body.innerText);
        return txt.includes('אחד או יותר מפרטי ההזדהות שמסרת שגויים');
      },
    ],
    changePassword: ['https://hb2.bankleumi.co.il/authenticate'],
  },
};

describe('E2E: Selector fallback — Leumi (Round 3 WELL_KNOWN_SELECTORS)', () => {
  beforeAll(() => {
    jest.setTimeout(SCRAPE_TIMEOUT);
  });

  it('Round 3 — no explicit fallback; WELL_KNOWN_SELECTORS Hebrew dict finds input[placeholder~="שם משתמש"]', async () => {
    const result = await new ConcreteGenericScraper(
      {
        companyId: CompanyTypes.Leumi,
        startDate: new Date(),
        shouldShowBrowser: false,
        args: BROWSER_ARGS,
        defaultTimeout: 60000,
      },
      LEUMI_WELL_KNOWN_CFG,
    ).scrape({ username: 'INVALID_USER', password: 'WellKnownTestLMI' } as {
      username: string;
      password: string;
    });
    expect(result.errorMessage ?? '').not.toMatch(ERR);
    expect(VALID_REACHED_BANK).toContain(result.errorType);
  });
});
