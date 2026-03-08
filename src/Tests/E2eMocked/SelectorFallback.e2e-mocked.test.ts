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

import { CompanyTypes } from '../../Definitions.js';
import { ConcreteGenericScraper } from '../../Scrapers/Base/ConcreteGenericScraper.js';
import { type LoginConfig } from '../../Scrapers/Base/LoginConfig.js';
import { closeSharedBrowser, getSharedBrowser } from './Helpers/BrowserFixture.js';
import { setupRequestInterception } from './Helpers/RequestInterceptor.js';

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
// Candidate resolution order within main page (Round 2):
//   1. configured CSS id → NOT FOUND (wrong id)
//   2. WELL_KNOWN_SELECTORS → finds input[placeholder*="שם משתמש"] etc.
// No iframes on this page → Round 1 (iframe search) skips immediately.
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
    { kind: 'css', value: '#NONEXISTENT_SUBMIT_BTN' }, // configured css → not found
    { kind: 'ariaLabel', value: 'כניסה' }, // fallback ariaLabel → found
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

  it('returns failure when ALL rounds fail — isResolved:false causes login to report error', async () => {
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

    // resolveFieldContext returns isResolved:false — no throw, direct fill also fails
    expect(result.success).toBe(false);
  }, 30000);
});

// ─── Round 1: iframe-first detection ─────────────────────────────────────────
//
// Scenario: a bank redesigns its login page — the form moves into an <iframe>.
// The scraper must detect the iframe first (Round 1) and fill the form inside it.

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

describe('Selector fallback Round 1: iframe-first detection', () => {
  it('finds login fields inside an iframe before checking the main page', async () => {
    // Config: only wrong CSS ids — no explicit display-name fallbacks.
    // Round 1 searches iframes first and finds the Hebrew placeholder inputs.
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

    // Round 1 found the inputs in the iframe (before checking the main page).
    // Login succeeded → fetchData() stub returns success.
    expect(result.success).toBe(true);
    expect(result.errorMessage).toBeUndefined();
  }, 30000);
});

// ─── labelText resolution: <label for="id"> ────────────────────────────────
//
// Scenario: page uses <label for="id"> pattern (no placeholders, no CSS ids).
// The scraper must find the <label> by visible text, read for= attr, fill #id.

const LABEL_FOR_LOGIN_HTML = `<!DOCTYPE html><html><body dir="rtl">
<form>
  <label for="usr">שם משתמש</label>
  <input id="usr" type="text" />
  <label for="pwd">סיסמה</label>
  <input id="pwd" type="password" />
  <button type="button" aria-label="כניסה"
    onclick="window.location.href='https://test-bank.local/home'">כניסה</button>
</form>
</body></html>`;

describe('labelText resolution: <label for="id">', () => {
  it('resolves fields via <label for="id"> when no placeholder or CSS id matches', async () => {
    const labelConfig: LoginConfig = {
      loginUrl: 'https://test-bank.local/login',
      fields: [
        { credentialKey: 'username', selectors: [] },
        { credentialKey: 'password', selectors: [] },
      ],
      submit: [{ kind: 'ariaLabel', value: 'כניסה' }],
      possibleResults: {
        success: ['https://test-bank.local/home'],
      },
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
            {
              match: 'test-bank.local/login',
              contentType: 'text/html; charset=utf-8',
              body: LABEL_FOR_LOGIN_HTML,
            },
            {
              match: 'test-bank.local/home',
              contentType: 'text/html; charset=utf-8',
              body: HOME_HTML,
            },
          ]);
        },
      },
      labelConfig,
    );

    const result = await scraper.scrape({
      username: 'testuser',
      password: 'testpass',
    } as { username: string; password: string });

    expect(result.success).toBe(true);
    expect(result.errorMessage).toBeUndefined();
  }, 30000);
});

// ─── labelText false-positive guard: <div> with nested "סיסמה" text ─────────
//
// Scenario: page has <div> containing "סיסמה" in a <p> paragraph (OTP prompt),
// but the actual password <input> uses a placeholder. The resolver must NOT
// match the <div> as a label (would find the OTP input instead of password).

const FALSE_POSITIVE_HTML = `<!DOCTYPE html><html><body dir="rtl">
<form id="login-form">
  <input type="text" placeholder="שם משתמש" />
  <input type="password" placeholder="סיסמה" />
  <button type="button" aria-label="כניסה"
    onclick="window.location.href='https://test-bank.local/home'">כניסה</button>
</form>
<div id="otp-section" style="display:none">
  <p>יש להזין סיסמה חד פעמית</p>
  <input id="otp-code" placeholder="קוד חד פעמי" />
</div>
</body></html>`;

describe('labelText false-positive guard', () => {
  it('does NOT resolve <div> containing "סיסמה" in nested <p> — uses placeholder instead', async () => {
    const fpConfig: LoginConfig = {
      loginUrl: 'https://test-bank.local/login',
      fields: [
        { credentialKey: 'username', selectors: [] },
        { credentialKey: 'password', selectors: [] },
      ],
      submit: [{ kind: 'ariaLabel', value: 'כניסה' }],
      possibleResults: {
        success: ['https://test-bank.local/home'],
      },
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
            {
              match: 'test-bank.local/login',
              contentType: 'text/html; charset=utf-8',
              body: FALSE_POSITIVE_HTML,
            },
            {
              match: 'test-bank.local/home',
              contentType: 'text/html; charset=utf-8',
              body: HOME_HTML,
            },
          ]);
        },
      },
      fpConfig,
    );

    const result = await scraper.scrape({
      username: 'testuser',
      password: 'testpass',
    } as { username: string; password: string });

    // Login succeeds — password field resolved via placeholder (not the OTP div)
    expect(result.success).toBe(true);
    expect(result.errorMessage).toBeUndefined();
  }, 30000);
});

// ─── labelText in iframe: <label for="id"> inside an iframe ────────────────
//
// Scenario: bank moves login form into an <iframe>. The iframe uses <label>
// elements with for= attrs. No placeholders, no CSS ids on the main page.
// The resolver must search the iframe (Round 1) and resolve via labelText.

const MAIN_PAGE_NO_FORM = `<!DOCTYPE html><html><body>
<h1>Bank Portal</h1>
<iframe src="https://test-bank.local/login-frame"
  style="width:100%;height:400px"></iframe>
</body></html>`;

const FRAME_LABEL_LOGIN_HTML = `<!DOCTYPE html><html><body dir="rtl">
<form>
  <label for="user">שם משתמש</label>
  <input id="user" type="text" />
  <label for="pass">סיסמה</label>
  <input id="pass" type="password" />
  <button type="button" aria-label="כניסה"
    onclick="window.top.location.href='https://test-bank.local/home'">כניסה</button>
</form>
</body></html>`;

describe('labelText in iframe', () => {
  it('resolves <label for="id"> inside an iframe (Round 1)', async () => {
    const iframeLabelConfig: LoginConfig = {
      loginUrl: 'https://test-bank.local/',
      fields: [
        { credentialKey: 'username', selectors: [] },
        { credentialKey: 'password', selectors: [] },
      ],
      submit: [{ kind: 'ariaLabel', value: 'כניסה' }],
      possibleResults: {
        success: ['https://test-bank.local/home'],
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
            {
              match: 'test-bank.local/login-frame',
              contentType: 'text/html; charset=utf-8',
              body: FRAME_LABEL_LOGIN_HTML,
            },
            {
              match: 'test-bank.local/home',
              contentType: 'text/html; charset=utf-8',
              body: HOME_HTML,
            },
            {
              match: 'test-bank.local',
              contentType: 'text/html; charset=utf-8',
              body: MAIN_PAGE_NO_FORM,
            },
          ]);
        },
      },
      iframeLabelConfig,
    );

    const result = await scraper.scrape({
      username: 'testuser',
      password: 'testpass',
    } as { username: string; password: string });

    // Round 1 found <label for="user"> in iframe → filled #user
    expect(result.success).toBe(true);
    expect(result.errorMessage).toBeUndefined();
  }, 30000);
});

// ─── Sibling strategy: <label>text</label><input> (no for= attr) ───────────
//
// Scenario: bank uses <label> without for= attr, input is a sibling.
// Strategy 4 (following-sibling) should find the adjacent <input>.

const LABEL_SIBLING_HTML = `<!DOCTYPE html><html><body dir="rtl">
<form>
  <div class="field">
    <label>שם משתמש</label>
    <input type="text" />
  </div>
  <div class="field">
    <label>סיסמה</label>
    <input type="password" />
  </div>
  <button type="button" aria-label="כניסה"
    onclick="window.location.href='https://test-bank.local/home'">כניסה</button>
</form>
</body></html>`;

describe('labelText sibling strategy', () => {
  it('resolves <label>text</label><input> (no for= attr) via sibling strategy', async () => {
    const siblingConfig: LoginConfig = {
      loginUrl: 'https://test-bank.local/login',
      fields: [
        { credentialKey: 'username', selectors: [] },
        { credentialKey: 'password', selectors: [] },
      ],
      submit: [{ kind: 'ariaLabel', value: 'כניסה' }],
      possibleResults: {
        success: ['https://test-bank.local/home'],
      },
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
            {
              match: 'test-bank.local/login',
              contentType: 'text/html; charset=utf-8',
              body: LABEL_SIBLING_HTML,
            },
            {
              match: 'test-bank.local/home',
              contentType: 'text/html; charset=utf-8',
              body: HOME_HTML,
            },
          ]);
        },
      },
      siblingConfig,
    );

    const result = await scraper.scrape({
      username: 'testuser',
      password: 'testpass',
    } as { username: string; password: string });

    expect(result.success).toBe(true);
    expect(result.errorMessage).toBeUndefined();
  }, 30000);
});

// ─── <span> as labeling element with nested <input> ────────────────────────

const SPAN_NESTED_HTML = `<!DOCTYPE html><html><body dir="rtl">
<form>
  <span class="lbl">שם משתמש<input type="text" /></span>
  <span class="lbl">סיסמה<input type="password" /></span>
  <button type="button" aria-label="כניסה"
    onclick="window.location.href='https://test-bank.local/home'">כניסה</button>
</form>
</body></html>`;

describe('labelText via <span> with nested input', () => {
  it('resolves <span>סיסמה<input></span> via nested strategy', async () => {
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
              body: SPAN_NESTED_HTML,
            },
            {
              match: 'test-bank.local/home',
              contentType: 'text/html; charset=utf-8',
              body: HOME_HTML,
            },
          ]);
        },
      },
      {
        loginUrl: 'https://test-bank.local/login',
        fields: [
          { credentialKey: 'username', selectors: [] },
          { credentialKey: 'password', selectors: [] },
        ],
        submit: [{ kind: 'ariaLabel', value: 'כניסה' }],
        possibleResults: { success: ['https://test-bank.local/home'] },
      },
    );
    const result = await scraper.scrape({ username: 'u', password: 'p' } as {
      username: string;
      password: string;
    });
    expect(result.success).toBe(true);
  }, 30000);
});

// ─── <div> as labeling element with sibling <input> ────────────────────────

const DIV_SIBLING_HTML = `<!DOCTYPE html><html><body dir="rtl">
<form>
  <div class="row"><div class="lbl">שם משתמש</div><input type="text" /></div>
  <div class="row"><div class="lbl">סיסמה</div><input type="password" /></div>
  <button type="button" aria-label="כניסה"
    onclick="window.location.href='https://test-bank.local/home'">כניסה</button>
</form>
</body></html>`;

describe('labelText via <div> with sibling input', () => {
  it('resolves <div>סיסמה</div><input> via sibling strategy', async () => {
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
              body: DIV_SIBLING_HTML,
            },
            {
              match: 'test-bank.local/home',
              contentType: 'text/html; charset=utf-8',
              body: HOME_HTML,
            },
          ]);
        },
      },
      {
        loginUrl: 'https://test-bank.local/login',
        fields: [
          { credentialKey: 'username', selectors: [] },
          { credentialKey: 'password', selectors: [] },
        ],
        submit: [{ kind: 'ariaLabel', value: 'כניסה' }],
        possibleResults: { success: ['https://test-bank.local/home'] },
      },
    );
    const result = await scraper.scrape({ username: 'u', password: 'p' } as {
      username: string;
      password: string;
    });
    expect(result.success).toBe(true);
  }, 30000);
});

// ─── Placeholder resolution (existing behavior preserved) ──────────────────

const PLACEHOLDER_ONLY_HTML = `<!DOCTYPE html><html><body dir="rtl">
<form>
  <input type="text" placeholder="שם משתמש" />
  <input type="password" placeholder="סיסמה" />
  <button type="submit">כניסה</button>
</form>
<script>
  document.querySelector('form').onsubmit = function(e) {
    e.preventDefault();
    window.location.href = 'https://test-bank.local/home';
  };
</script>
</body></html>`;

describe('placeholder resolution (regression)', () => {
  it('resolves fields via placeholder when no label/div/span/CSS exists', async () => {
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
              body: PLACEHOLDER_ONLY_HTML,
            },
            {
              match: 'test-bank.local/home',
              contentType: 'text/html; charset=utf-8',
              body: HOME_HTML,
            },
          ]);
        },
      },
      {
        loginUrl: 'https://test-bank.local/login',
        fields: [
          { credentialKey: 'username', selectors: [] },
          { credentialKey: 'password', selectors: [] },
        ],
        submit: [{ kind: 'css', value: 'button[type="submit"]' }],
        possibleResults: { success: ['https://test-bank.local/home'] },
      },
    );
    const result = await scraper.scrape({ username: 'u', password: 'p' } as {
      username: string;
      password: string;
    });
    expect(result.success).toBe(true);
  }, 30000);
});
