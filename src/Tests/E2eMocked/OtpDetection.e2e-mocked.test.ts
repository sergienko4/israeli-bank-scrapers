/**
 * OTP detection — mocked e2e tests.
 *
 * Verifies that handleOtpStep correctly detects OTP screens, invokes otpCodeRetriever,
 * fills the code, and continues the login flow — without any bank-specific code.
 *
 * All pages are served via Playwright route interception; no real network calls.
 */
import { type Browser } from 'playwright';

import { CompanyTypes } from '../../Definitions';
import type { IDoneResult } from '../../Interfaces/Common/StepResult';
import { ConcreteGenericScraper } from '../../Scrapers/Base/ConcreteGenericScraper';
import { ScraperErrorTypes } from '../../Scrapers/Base/Errors';
import { type ILoginConfig } from '../../Scrapers/Base/LoginConfig';
import { closeSharedBrowser, getSharedBrowser } from './Helpers/BrowserFixture';
import { setupRequestInterception } from './Helpers/RequestInterceptor';

// ── Shared HTML fixtures ──────────────────────────────────────────────────────

/** Login form → clicking "כניסה" shows the OTP selection screen (JS-rendered, no URL change) */
const OTP_SELECTION_HTML = `<!DOCTYPE html><html><body dir="rtl">
<div id="login-form">
  <input type="text" placeholder="שם משתמש" />
  <input type="password" placeholder="סיסמה" />
  <button id="login-btn" type="button" onclick="showPhoneSelect()">כניסה</button>
</div>
<div id="phone-select" style="display:none">
  <p>לצורך אימות זהותך, יש לבחור טלפון לקבלת סיסמה חד פעמית</p>
  <span id="phone-hint">*****5100</span>
  <button id="sms-btn" type="button" onclick="showCodeEntry()">SMS</button>
  <button id="sms-send-btn" type="button" onclick="showCodeEntry()">שלח</button>
</div>
<div id="code-entry" style="display:none">
  <input id="otp-input" placeholder="קוד חד פעמי" />
  <button id="otp-submit" type="button"
    onclick="window.location.href='https://test-bank.local/dashboard'">אשר</button>
</div>
<script>
  function showPhoneSelect() {
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('phone-select').style.display = 'block';
  }
  function showCodeEntry() {
    document.getElementById('phone-select').style.display = 'none';
    document.getElementById('code-entry').style.display = 'block';
  }
</script>
</body></html>`;

/** Simple OTP code-entry screen (no phone selection step) */
const OTP_CODE_ENTRY_HTML = `<!DOCTYPE html><html><body dir="rtl">
<div id="login-form">
  <input type="text" placeholder="שם משתמש" />
  <input type="password" placeholder="סיסמה" />
  <button id="login-btn" type="button" onclick="showOtp()">כניסה</button>
</div>
<div id="otp-form" style="display:none">
  <p>לצורך אימות זהותך יש להזין סיסמה חד פעמית</p>
  <input id="otp-input" placeholder="קוד חד פעמי" />
  <button id="otp-submit" type="button"
    onclick="window.location.href='https://test-bank.local/dashboard'">אשר</button>
</div>
<script>
  function showOtp() {
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('otp-form').style.display = 'block';
  }
</script>
</body></html>`;

/** Normal login — no OTP at all */
const NORMAL_LOGIN_HTML = `<!DOCTYPE html><html><body>
<form>
  <input type="text" placeholder="שם משתמש" />
  <input type="password" placeholder="סיסמה" />
  <button id="login-btn" type="button"
    onclick="window.location.href='https://test-bank.local/dashboard'">כניסה</button>
</form>
</body></html>`;

/** Login error page — wrong credentials, no OTP keywords */
const LOGIN_ERROR_HTML = `<!DOCTYPE html><html><body dir="rtl">
<form>
  <input type="text" placeholder="שם משתמש" />
  <input type="password" placeholder="סיסמה" />
  <button id="login-btn" type="button"
    onclick="window.location.href='https://test-bank.local/error'">כניסה</button>
</form>
<p id="error-msg" style="display:none">שם משתמש שגוי. ניסיון 2 מתוך 3</p>
</body></html>`;

const DASHBOARD_HTML = '<!DOCTYPE html><html><body><h1>Dashboard</h1></body></html>';
const ERROR_PAGE_HTML =
  '<!DOCTYPE html><html><body><p>שם משתמש שגוי. ניסיון 2 מתוך 3</p></body></html>';

// ── Shared ILoginConfig helpers ────────────────────────────────────────────────

/**
 * Builds a ILoginConfig pointing to test-bank.local with optional overrides.
 *
 * @param overrides - partial ILoginConfig fields to override defaults
 * @returns a complete ILoginConfig for use in test scrapers
 */
function makeLoginConfig(overrides: Partial<ILoginConfig> = {}): ILoginConfig {
  return {
    loginUrl: 'https://test-bank.local/login',
    fields: [
      { credentialKey: 'username', selectors: [{ kind: 'css', value: '#UNUSED' }] },
      { credentialKey: 'password', selectors: [{ kind: 'css', value: '#UNUSED' }] },
    ],
    submit: [{ kind: 'css', value: '#login-btn' }],
    possibleResults: {
      success: ['https://test-bank.local/dashboard'],
      invalidPassword: [/\/error$/],
    },
    ...overrides,
  };
}

let browser: Browser;

beforeAll(async () => {
  browser = await getSharedBrowser();
}, 30000);

afterAll(async () => {
  await closeSharedBrowser();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('OTP detection', () => {
  it('Test 1: OTP screen detected, no retriever → TwoFactorRetrieverMissing', async () => {
    const scraper = new ConcreteGenericScraper(
      {
        companyId: CompanyTypes.Discount,
        startDate: new Date('2026-01-01'),
        browser,
        skipCloseBrowser: true,
        defaultTimeout: 15000,
        preparePage:
          /**
           * Serves OTP code-entry page to trigger OTP detection with no retriever configured.
           *
           * @param page - the Playwright page to attach route interception to
           * @returns a resolved IDoneResult after interception is set up
           */
          async (page): Promise<IDoneResult> => {
            await setupRequestInterception(page, [
              {
                match: 'test-bank.local/login',
                contentType: 'text/html; charset=utf-8',
                body: OTP_CODE_ENTRY_HTML,
              },
              {
                match: 'test-bank.local/dashboard',
                contentType: 'text/html; charset=utf-8',
                body: DASHBOARD_HTML,
              },
            ]);
            return { done: true };
          },
        // No otpCodeRetriever provided
      },
      makeLoginConfig(),
    );

    const result = await scraper.scrape({ username: 'testuser', password: 'testpass' } as {
      username: string;
      password: string;
    });

    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.TwoFactorRetrieverMissing);
    expect(result.errorMessage).toMatch(/otpCodeRetriever/);
  }, 30000);

  it('Test 2: OTP code-entry screen, retriever provided → code filled → login succeeds', async () => {
    const retrieverSpy = jest.fn().mockResolvedValue('123456');

    const scraper = new ConcreteGenericScraper(
      {
        companyId: CompanyTypes.Discount,
        startDate: new Date('2026-01-01'),
        browser,
        skipCloseBrowser: true,
        defaultTimeout: 15000,
        preparePage:
          /**
           * Serves OTP code-entry page so the retriever is invoked with the phone hint.
           *
           * @param page - the Playwright page to attach route interception to
           * @returns a resolved IDoneResult after interception is set up
           */
          async (page): Promise<IDoneResult> => {
            await setupRequestInterception(page, [
              {
                match: 'test-bank.local/login',
                contentType: 'text/html; charset=utf-8',
                body: OTP_CODE_ENTRY_HTML,
              },
              {
                match: 'test-bank.local/dashboard',
                contentType: 'text/html; charset=utf-8',
                body: DASHBOARD_HTML,
              },
            ]);
            return { done: true };
          },
        otpCodeRetriever: retrieverSpy,
      },
      makeLoginConfig(),
    );

    const result = await scraper.scrape({ username: 'testuser', password: 'testpass' } as {
      username: string;
      password: string;
    });

    expect(result.success).toBe(true);
    expect(retrieverSpy).toHaveBeenCalledTimes(1);
    // phoneHint is empty string — page has no masked phone pattern
    const anyString = expect.any(String) as string;
    expect(retrieverSpy).toHaveBeenCalledWith(anyString);
  }, 30000);

  it('Test 3: Two-screen OTP flow (Beinleumi-like) — SMS selection then code entry → success', async () => {
    const retrieverSpy = jest.fn().mockResolvedValue('654321');

    const scraper = new ConcreteGenericScraper(
      {
        companyId: CompanyTypes.Discount,
        startDate: new Date('2026-01-01'),
        browser,
        skipCloseBrowser: true,
        defaultTimeout: 15000,
        preparePage:
          /**
           * Serves the OTP selection page for the two-screen flow test.
           *
           * @param page - the Playwright page to attach route interception to
           * @returns a resolved IDoneResult after interception is set up
           */
          async (page): Promise<IDoneResult> => {
            await setupRequestInterception(page, [
              {
                match: 'test-bank.local/login',
                contentType: 'text/html; charset=utf-8',
                body: OTP_SELECTION_HTML,
              },
              {
                match: 'test-bank.local/dashboard',
                contentType: 'text/html; charset=utf-8',
                body: DASHBOARD_HTML,
              },
            ]);
            return { done: true };
          },
        otpCodeRetriever: retrieverSpy,
      },
      makeLoginConfig(),
    );

    const result = await scraper.scrape({ username: 'testuser', password: 'testpass' } as {
      username: string;
      password: string;
    });

    expect(result.success).toBe(true);
    // Retriever called with phone hint extracted from the page
    expect(retrieverSpy).toHaveBeenCalledWith('*****5100');
  }, 30000);

  it('Test 4: Normal login (no OTP) — zero regression, login succeeds', async () => {
    const scraper = new ConcreteGenericScraper(
      {
        companyId: CompanyTypes.Discount,
        startDate: new Date('2026-01-01'),
        browser,
        skipCloseBrowser: true,
        defaultTimeout: 15000,
        preparePage:
          /**
           * Serves a normal login page with no OTP keywords for the no-OTP regression test.
           *
           * @param page - the Playwright page to attach route interception to
           * @returns a resolved IDoneResult after interception is set up
           */
          async (page): Promise<IDoneResult> => {
            await setupRequestInterception(page, [
              {
                match: 'test-bank.local/login',
                contentType: 'text/html; charset=utf-8',
                body: NORMAL_LOGIN_HTML,
              },
              {
                match: 'test-bank.local/dashboard',
                contentType: 'text/html; charset=utf-8',
                body: DASHBOARD_HTML,
              },
            ]);
            return { done: true };
          },
      },
      makeLoginConfig(),
    );

    const result = await scraper.scrape({ username: 'testuser', password: 'testpass' } as {
      username: string;
      password: string;
    });

    expect(result.success).toBe(true);
    expect(result.errorType).toBeUndefined();
  }, 30000);

  it('Test 5: Login error page — false-positive guard, no OTP triggered', async () => {
    const retrieverSpy = jest.fn();

    const scraper = new ConcreteGenericScraper(
      {
        companyId: CompanyTypes.Discount,
        startDate: new Date('2026-01-01'),
        browser,
        skipCloseBrowser: true,
        defaultTimeout: 15000,
        preparePage:
          /**
           * Serves the login error page to verify no OTP is triggered on wrong credentials.
           *
           * @param page - the Playwright page to attach route interception to
           * @returns a resolved IDoneResult after interception is set up
           */
          async (page): Promise<IDoneResult> => {
            await setupRequestInterception(page, [
              {
                match: 'test-bank.local/login',
                contentType: 'text/html; charset=utf-8',
                body: LOGIN_ERROR_HTML,
              },
              {
                match: 'test-bank.local/error',
                contentType: 'text/html; charset=utf-8',
                body: ERROR_PAGE_HTML,
              },
            ]);
            return { done: true };
          },
        otpCodeRetriever: retrieverSpy,
      },
      makeLoginConfig(),
    );

    const result = await scraper.scrape({ username: 'wronguser', password: 'wrongpass' } as {
      username: string;
      password: string;
    });

    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.InvalidPassword);
    expect(retrieverSpy).not.toHaveBeenCalled();
  }, 30000);
});
