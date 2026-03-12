/**
 * Selector-fallback mocked e2e tests — Part B: advanced label strategies.
 *
 * Tests labelText false-positive guard, iframe labelText, and sibling strategy.
 */
import { type Browser, type Page } from 'playwright';

import { CompanyTypes } from '../../Definitions.js';
import { ConcreteGenericScraper } from '../../Scrapers/Base/ConcreteGenericScraper.js';
import { type ILoginConfig } from '../../Scrapers/Base/Config/LoginConfig.js';
import { closeSharedBrowser, getSharedBrowser } from './Helpers/BrowserFixture.js';
import { setupRequestInterception } from './Helpers/RequestInterceptor.js';

const HOME_HTML = '<!DOCTYPE html><html><body><h1>Welcome</h1></body></html>';

let browser: Browser;

beforeAll(async () => {
  browser = await getSharedBrowser();
}, 30000);

afterAll(async () => {
  await closeSharedBrowser();
});

// ─── labelText false-positive guard: <div> with nested "סיסמה" text ─────────
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
    const fpConfig: ILoginConfig = {
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

    /**
     * Intercept requests with false-positive HTML fixtures.
     * @param page - Playwright page to configure with route interception.
     * @returns True when interception is configured.
     */
    const preparePage = async (page: Page): Promise<void> => {
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
    };

    const scraper = new ConcreteGenericScraper(
      {
        companyId: CompanyTypes.Discount,
        startDate: new Date('2026-01-01'),
        browser,
        skipCloseBrowser: true,
        defaultTimeout: 10000,
        preparePage,
      },
      fpConfig,
    );

    const result = await scraper.scrape({
      username: 'testuser',
      password: 'testpass',
    } as { username: string; password: string });

    expect(result.success).toBe(true);
    expect(result.errorMessage).toBeUndefined();
  }, 30000);
});

// ─── labelText in iframe: <label for="id"> inside an iframe ────────────────
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
    const iframeLabelConfig: ILoginConfig = {
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

    /**
     * Intercept requests with iframe label HTML fixtures.
     * @param page - Playwright page to configure with route interception.
     * @returns True when interception is configured.
     */
    const preparePage = async (page: Page): Promise<void> => {
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
    };

    const scraper = new ConcreteGenericScraper(
      {
        companyId: CompanyTypes.Discount,
        startDate: new Date('2026-01-01'),
        browser,
        skipCloseBrowser: true,
        defaultTimeout: 15000,
        preparePage,
      },
      iframeLabelConfig,
    );

    const result = await scraper.scrape({
      username: 'testuser',
      password: 'testpass',
    } as { username: string; password: string });

    expect(result.success).toBe(true);
    expect(result.errorMessage).toBeUndefined();
  }, 30000);
});

// ─── Sibling strategy: <label>text</label><input> (no for= attr) ───────────
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
    const siblingConfig: ILoginConfig = {
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

    /**
     * Intercept requests with sibling label HTML fixtures.
     * @param page - Playwright page to configure with route interception.
     * @returns True when interception is configured.
     */
    const preparePage = async (page: Page): Promise<void> => {
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
    };

    const scraper = new ConcreteGenericScraper(
      {
        companyId: CompanyTypes.Discount,
        startDate: new Date('2026-01-01'),
        browser,
        skipCloseBrowser: true,
        defaultTimeout: 10000,
        preparePage,
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
