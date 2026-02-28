/**
 * Selector-fallback: Leumi — Round 3 (WELL_KNOWN_SELECTORS dictionary).
 *
 * Leumi's own scraper uses input[placeholder="שם משתמש"] as its primary selector,
 * confirming the page has Hebrew placeholder attributes.
 * With WRONG CSS ids and NO explicit fallbacks configured, Round 3 must find the
 * login fields via the global WELL_KNOWN_SELECTORS Hebrew dictionary.
 */
import { type Page } from 'playwright';
import { CompanyTypes } from '../../definitions';
import { ConcreteGenericScraper } from '../../scrapers/concrete-generic-scraper';
import { type LoginConfig } from '../../scrapers/login-config';
import { SCRAPE_TIMEOUT, BROWSER_ARGS } from './helpers';
import { waitUntilElementFound } from '../../helpers/elements-interactions';
import { VALID_REACHED_BANK, selectorErrorFor } from './selector-fallback-helpers';

const ERR = selectorErrorFor('username', 'password');

const leumiWellKnownCfg: LoginConfig = {
  loginUrl: 'https://www.leumi.co.il/he',
  fields: [
    // NO fallback — relies entirely on WELL_KNOWN_SELECTORS.username + .password
    { credentialKey: 'username', selectors: [{ kind: 'css', value: '#WRONG_leumiUser_NO_FALLBACK' }] },
    { credentialKey: 'password', selectors: [{ kind: 'css', value: '#WRONG_leumiPass_NO_FALLBACK' }] },
  ],
  submit: [{ kind: 'css', value: "button[type='submit']" }],
  // Navigate from Leumi home to the actual login page that has Hebrew placeholder inputs
  checkReadiness: async (page: Page) => {
    await waitUntilElementFound(page, '.enter_account');
    const href = await page.$eval('.enter_account', el => (el as HTMLAnchorElement).href);
    await page.goto(href, { waitUntil: 'networkidle' });
    await waitUntilElementFound(page, 'input[placeholder="שם משתמש"]', { visible: true });
  },
  postAction: async (page: Page) => {
    await page.waitForTimeout(3000);
  },
  possibleResults: {
    success: [/eBanking\/SO\/SPA\.aspx/i],
    invalidPassword: [
      async opts => {
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
        companyId: CompanyTypes.leumi,
        startDate: new Date(),
        showBrowser: false,
        args: BROWSER_ARGS,
        defaultTimeout: 60000,
      },
      leumiWellKnownCfg,
    ).scrape({ username: 'INVALID_USER', password: 'WellKnownTestLMI' } as { username: string; password: string });
    expect(result.errorMessage ?? '').not.toMatch(ERR);
    expect(VALID_REACHED_BANK).toContain(result.errorType);
  });
});
