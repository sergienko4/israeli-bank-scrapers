/**
 * Selector-fallback mocked e2e tests — Part C: element labeling strategies.
 *
 * Tests span nested input, div sibling input, and placeholder regression.
 */
import { type Browser, type Page } from 'playwright-core';

import { CompanyTypes } from '../../Definitions.js';
import { ConcreteGenericScraper } from '../../Scrapers/Base/ConcreteGenericScraper.js';
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
    /**
     * Intercept requests with span nested HTML fixtures.
     * @param page - Playwright page to configure with route interception.
     * @returns True when interception is configured.
     */
    const preparePage = async (page: Page): Promise<void> => {
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
    /**
     * Intercept requests with div sibling HTML fixtures.
     * @param page - Playwright page to configure with route interception.
     * @returns True when interception is configured.
     */
    const preparePage = async (page: Page): Promise<void> => {
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
    /**
     * Intercept requests with placeholder-only HTML fixtures.
     * @param page - Playwright page to configure with route interception.
     * @returns True when interception is configured.
     */
    const preparePage = async (page: Page): Promise<void> => {
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
