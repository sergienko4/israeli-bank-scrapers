/**
 * Max second-login mocked E2E tests.
 *
 * Tests login form interaction with intercepted HTML:
 * - Flow A: username + password → dashboard (no ID verification)
 * - Flow B: username + password → ID prompt detected → fill ID → dashboard
 *
 * Uses ConcreteGenericScraper with simplified config (no preAction).
 * Same pattern as SelectorFallbackBasic.e2e-mocked.test.ts.
 */
import { type Page } from 'playwright';

import { CompanyTypes } from '../../Definitions.js';
import { ConcreteGenericScraper } from '../../Scrapers/Base/ConcreteGenericScraper.js';
import { type ILoginConfig } from '../../Scrapers/Base/LoginConfig.js';
import { maxHandleSecondLoginStep } from '../../Scrapers/Max/MaxLoginConfig.js';
import {
  closeSharedBrowser,
  createIsolatedContext,
  getSharedBrowser,
} from './Helpers/BrowserFixture.js';
import { setupRequestInterception } from './Helpers/RequestInterceptor.js';

// ── Flow A: username + password only, no ID field ───────────────────────────
const FLOW_A_HTML = `<!DOCTYPE html><html><body>
<form aria-hidden="true">
  <input placeholder="מספר תעודת זהות או דרכון" tabindex="-1" />
</form>
<form aria-hidden="false">
  <input type="text" placeholder="שם משתמש" />
  <input type="password" placeholder="סיסמה" />
  <button type="button" aria-label="כניסה"
    onclick="window.location.href='https://mock-max.local/home'">כניסה</button>
</form>
</body></html>`;

// ── Flow B: same form + ID field + verification prompt text ─────────────────
const FLOW_B_HTML = `<!DOCTYPE html><html><body>
<form aria-hidden="true">
  <input placeholder="מספר תעודת זהות או דרכון" tabindex="-1" />
</form>
<form aria-hidden="false">
  <input type="tel" placeholder="מספר תעודת זהות/דרכון" />
  <span>בשל מספר ניסיונות לא טובים, נבקש למלא את מספר תעודת הזהות שלך</span>
  <input type="text" placeholder="שם משתמש" />
  <input type="password" placeholder="סיסמה" />
  <button type="button" aria-label="כניסה"
    onclick="window.location.href='https://mock-max.local/home'">כניסה</button>
</form>
</body></html>`;

const HOME_HTML = '<!DOCTYPE html><html><body><h1>Dashboard</h1></body></html>';

const LOGIN_URL = 'https://mock-max.local/login';

/** Simplified config — no preAction, tests form interaction only. */
const BASE_CONFIG: ILoginConfig = {
  loginUrl: LOGIN_URL,
  fields: [
    { credentialKey: 'username', selectors: [] },
    { credentialKey: 'password', selectors: [] },
  ],
  submit: [{ kind: 'ariaLabel', value: 'כניסה' }],
  possibleResults: {
    success: ['https://mock-max.local/home'],
    invalidPassword: [],
  },
};

beforeAll(async () => {
  await getSharedBrowser();
}, 30000);

afterAll(async () => {
  await closeSharedBrowser();
});

describe('Max: mocked E2E — second-login flow', () => {
  it('Flow A: logs in with username + password, no ID prompt', async () => {
    const browserContext = await createIsolatedContext();
    /**
     * Intercept routes for Flow A login page.
     * @param page - Playwright page to configure.
     */
    const preparePage = async (page: Page): Promise<void> => {
      await setupRequestInterception(page, [
        { match: 'mock-max.local/home', contentType: 'text/html; charset=utf-8', body: HOME_HTML },
        { match: 'mock-max.local', contentType: 'text/html; charset=utf-8', body: FLOW_A_HTML },
      ]);
    };
    const scraper = new ConcreteGenericScraper(
      {
        companyId: CompanyTypes.Max,
        startDate: new Date('2026-01-01'),
        browserContext,
        preparePage,
      },
      BASE_CONFIG,
    );
    const result = await scraper.scrape({ username: 'testuser', password: 'testpass' });
    const error = `${result.errorType ?? ''} ${result.errorMessage ?? ''}`.trim();
    expect(error).toBe('');
    expect(result.success).toBe(true);
  }, 60000);

  it('Flow B: detects ID prompt and fills ID + username + password', async () => {
    const browserContext = await createIsolatedContext();
    /**
     * Intercept routes for Flow B login page with ID verification.
     * @param page - Playwright page to configure.
     */
    const preparePage = async (page: Page): Promise<void> => {
      await setupRequestInterception(page, [
        { match: 'mock-max.local/home', contentType: 'text/html; charset=utf-8', body: HOME_HTML },
        { match: 'mock-max.local', contentType: 'text/html; charset=utf-8', body: FLOW_B_HTML },
      ]);
    };
    const configWithSecondLogin: ILoginConfig = {
      ...BASE_CONFIG,
      /**
       * Post-action runs second-login detection after first submit.
       * @param page - The Playwright page after login form submission.
       */
      postAction: async (page: Page): Promise<void> => {
        await maxHandleSecondLoginStep(page, {
          username: 'testuser',
          password: 'testpass',
          id: '123456789',
        });
      },
    };
    const scraper = new ConcreteGenericScraper(
      {
        companyId: CompanyTypes.Max,
        startDate: new Date('2026-01-01'),
        browserContext,
        preparePage,
      },
      configWithSecondLogin,
    );
    const result = await scraper.scrape({
      username: 'testuser',
      password: 'testpass',
      id: '123456789',
    });
    const error = `${result.errorType ?? ''} ${result.errorMessage ?? ''}`.trim();
    expect(error).toBe('');
    expect(result.success).toBe(true);
  }, 60000);
});
