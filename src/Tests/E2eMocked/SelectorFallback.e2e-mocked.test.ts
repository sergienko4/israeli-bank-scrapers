/**
 * Selector-fallback mocked e2e tests.
 *
 * Scenario: the configured primary CSS id does NOT exist on the page.
 * The scraper must fall back to WELL_KNOWN_SELECTORS (Hebrew display-name
 * dictionary) and still fill the login form correctly.
 *
 * Page HTML uses placeholder attributes only — no IDs.
 * Primary CSS selectors in the config are deliberately wrong.
 * Round 3 (WELL_KNOWN_SELECTORS) is what actually resolves each field.
 */
import { type Browser } from 'playwright';

import { CompanyTypes } from '../../Definitions';
import { ConcreteGenericScraper } from '../../Scrapers/Base/ConcreteGenericScraper';
import { type LoginConfig } from '../../Scrapers/Base/LoginConfig';
import { closeSharedBrowser, getSharedBrowser } from './Helpers/BrowserFixture';
import { setupRequestInterception } from './Helpers/RequestInterceptor';

// ── Login page: inputs have Hebrew placeholders but NO matching CSS ids ────────
// The button triggers JS navigation on click (no form POST needed).
const LOGIN_HTML = `<!DOCTYPE html><html><body>
<form>
  <input type="text" placeholder="שם משתמש" />
  <input type="password" placeholder="סיסמה" />
  <button type="button" aria-label="כניסה"
    onclick="window.location.href='https://test-bank.local/home'">כניסה</button>
</form>
</body></html>`;

const HOME_HTML = '<!DOCTYPE html><html><body><h1>Welcome</h1></body></html>';

// ── Config: every CSS id is intentionally wrong ────────────────────────────────
// Round 1 (CSS id): fails — element not on page.
// Round 2 (bank display-names): empty — nothing configured.
// Round 3 (WELL_KNOWN_SELECTORS): finds input[placeholder*="שם משתמש"] etc.
const wrongIdConfig: LoginConfig = {
  loginUrl: 'https://test-bank.local/login',
  fields: [
    {
      credentialKey: 'username',
      selectors: [{ kind: 'css', value: '#NONEXISTENT_USERNAME_FIELD' }],
    },
    {
      credentialKey: 'password',
      selectors: [{ kind: 'css', value: '#NONEXISTENT_PASSWORD_FIELD' }],
    },
  ],
  submit: [
    { kind: 'css', value: '#NONEXISTENT_SUBMIT_BTN' }, // round 1 fails
    { kind: 'ariaLabel', value: 'כניסה' }, // round 2 finds it
  ],
  possibleResults: {
    success: ['https://test-bank.local/home'],
    invalidPassword: [/\/login\?error/],
  },
};

let browser: Browser;

beforeAll(async () => {
  browser = await getSharedBrowser();
}, 30000);

afterAll(async () => {
  await closeSharedBrowser();
});

describe('Selector fallback: WELL_KNOWN_SELECTORS resolution', () => {
  it('resolves fields via Hebrew placeholder when primary CSS id is wrong — login succeeds', async () => {
    const scraper = new ConcreteGenericScraper(
      {
        companyId: CompanyTypes.Discount,
        startDate: new Date('2026-01-01'),
        browser,
        skipCloseBrowser: true,
        defaultTimeout: 10000,
        preparePage: async page => {
          await setupRequestInterception(page, [
            {
              match: 'test-bank.local/login',
              contentType: 'text/html; charset=utf-8',
              body: LOGIN_HTML,
            },
            {
              match: 'test-bank.local/home',
              contentType: 'text/html; charset=utf-8',
              body: HOME_HTML,
            },
          ]);
        },
      },
      wrongIdConfig,
    );

    const result = await scraper.scrape({ username: 'testuser', password: 'testpass' } as {
      username: string;
      password: string;
    });

    // ConcreteGenericScraper.fetchData() returns { success: true, accounts: [] }
    // Login must have succeeded via selector fallback for fetchData to be reached.
    expect(result.success).toBe(true);
    expect(result.errorMessage).toBeUndefined();
  }, 30000);

  it('throws a descriptive error listing all tried candidates when ALL rounds fail', async () => {
    const emptyPageConfig: LoginConfig = {
      loginUrl: 'https://test-bank.local/login',
      fields: [
        {
          // credentialKey 'username' — WELL_KNOWN_SELECTORS will try placeholders
          // but the page has no inputs at all, so everything fails.
          credentialKey: 'username',
          selectors: [{ kind: 'css', value: '#NONEXISTENT_FIELD' }],
        },
      ],
      submit: [{ kind: 'css', value: '#submit' }],
      possibleResults: { success: ['/home'] },
    };

    const scraper = new ConcreteGenericScraper(
      {
        companyId: CompanyTypes.Discount,
        startDate: new Date('2026-01-01'),
        browser,
        skipCloseBrowser: true,
        defaultTimeout: 10000,
        preparePage: async page => {
          await setupRequestInterception(page, [
            // Page with no inputs — every selector attempt fails
            {
              match: 'test-bank.local/login',
              contentType: 'text/html',
              body: '<html><body><p>no form here</p></body></html>',
            },
          ]);
        },
      },
      emptyPageConfig,
    );

    const result = await scraper.scrape({ username: 'u', password: 'p' } as {
      username: string;
      password: string;
    });

    expect(result.success).toBe(false);
    // Error message must list the failed candidates and hint at redesign
    expect(result.errorMessage).toMatch(/Could not find 'username' field/);
    expect(result.errorMessage).toMatch(/NONEXISTENT_FIELD.*NOT FOUND/);
    expect(result.errorMessage).toMatch(/This usually means the bank redesigned/);
  }, 30000);
});

// ─── Round 4: iframe fallback ─────────────────────────────────────────────────
//
// Scenario: a bank redesigns its login page — the form moves into an <iframe>.
// The main page has no matching inputs. The scraper must detect the iframe and
// fill the form inside it automatically (Round 4).

// Main page: no form, just an iframe pointing to /login-frame
const MAIN_PAGE_WITH_IFRAME = `<!DOCTYPE html><html><body>
<h1>Bank Portal</h1>
<iframe src="https://test-bank.local/login-frame" style="width:100%;height:400px"></iframe>
</body></html>`;

// The iframe page: login form with Hebrew placeholders (no IDs)
const FRAME_LOGIN_HTML = `<!DOCTYPE html><html><body>
<form>
  <input type="text" placeholder="שם משתמש" />
  <input type="password" placeholder="סיסמה" />
  <button type="button" aria-label="כניסה"
    onclick="window.top.location.href='https://test-bank.local/home'">כניסה</button>
</form>
</body></html>`;

describe('Selector fallback Round 4: iframe detection', () => {
  it('finds login fields inside an iframe when the main page has none', async () => {
    // Config: only wrong CSS ids — no explicit display-name fallbacks.
    // Round 3 (WELL_KNOWN_SELECTORS) fails on the main page.
    // Round 4 searches the iframe and finds the Hebrew placeholder inputs.
    const iframeConfig: LoginConfig = {
      loginUrl: 'https://test-bank.local/',
      fields: [
        {
          credentialKey: 'username',
          selectors: [{ kind: 'css', value: '#WRONG_USERNAME' }],
        },
        {
          credentialKey: 'password',
          selectors: [{ kind: 'css', value: '#WRONG_PASSWORD' }],
        },
      ],
      submit: [
        { kind: 'css', value: '#WRONG_SUBMIT' },
        { kind: 'ariaLabel', value: 'כניסה' },
      ],
      possibleResults: {
        success: ['https://test-bank.local/home'],
        invalidPassword: [/\/error/],
      },
    };

    const scraper = new ConcreteGenericScraper(
      {
        companyId: CompanyTypes.Discount,
        startDate: new Date('2026-01-01'),
        browser,
        skipCloseBrowser: true,
        defaultTimeout: 15000,
        preparePage: async page => {
          await setupRequestInterception(page, [
            // More-specific paths must come before the catch-all root match.
            // 'test-bank.local' would match every URL; login-frame and home first.
            {
              match: 'test-bank.local/login-frame',
              contentType: 'text/html; charset=utf-8',
              body: FRAME_LOGIN_HTML,
            },
            {
              match: 'test-bank.local/home',
              contentType: 'text/html; charset=utf-8',
              body: HOME_HTML,
            },
            {
              match: 'test-bank.local',
              contentType: 'text/html; charset=utf-8',
              body: MAIN_PAGE_WITH_IFRAME,
            },
          ]);
        },
      },
      iframeConfig,
    );

    const result = await scraper.scrape({ username: 'testuser', password: 'testpass' } as {
      username: string;
      password: string;
    });

    // Round 4 must have found the inputs in the iframe.
    // Login succeeded → fetchData() stub returns success.
    expect(result.success).toBe(true);
    expect(result.errorMessage).toBeUndefined();
  }, 30000);
});
