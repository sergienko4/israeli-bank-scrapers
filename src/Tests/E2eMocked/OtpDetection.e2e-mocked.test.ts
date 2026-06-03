import { jest } from '@jest/globals';
/**
 * OTP detection — mocked e2e tests.
 *
 * Verifies that handleOtpStep correctly detects OTP screens, invokes otpCodeRetriever,
 * fills the code, and continues the login flow — without any bank-specific code.
 *
 * All pages are served via Playwright route interception; no real network calls.
 */
import { type Browser } from 'playwright-core';

import { CompanyTypes } from '../../Definitions.js';
import { ConcreteGenericScraper } from '../../Scrapers/Base/ConcreteGenericScraper.js';
import { type ILoginConfig, type ILoginSetup } from '../../Scrapers/Base/Config/LoginConfig.js';
import { ScraperErrorTypes } from '../../Scrapers/Base/Errors.js';
import { CREDS_USERNAME_PASSWORD, CREDS_WRONG } from '../TestConstants.js';
import { closeSharedBrowser, getSharedBrowser } from './Helpers/BrowserFixture.js';
import {
  buildLoginDashboardPage,
  buildLoginErrorPage,
  LOGIN_ERROR_HTML,
  NORMAL_LOGIN_HTML,
  OTP_CODE_ENTRY_HTML,
  OTP_CONFIRM_THEN_CODE_HTML,
  OTP_SELECTION_HTML,
} from './Helpers/OtpFixtures.js';

// ── Shared ILoginConfig helpers ────────────────────────────────────────────────

// Shared login-setup flags: this file exercises OTP, so all OTP flags are
// true by default. Required since Phase 7.5 (GenericBankScraper.resolveLoginSetup
// consults this field).
const LOGIN_SETUP_OTP_ENABLED: ILoginSetup = {
  isApiOnly: false,
  hasOtpConfirm: true,
  hasOtpCode: true,
};

/**
 * Creates a login config with sensible defaults and optional overrides.
 * @param overrides - partial config to merge with defaults.
 * @returns complete login config for tests.
 */
function makeLoginConfig(overrides: Partial<ILoginConfig> = {}): ILoginConfig {
  return {
    loginUrl: 'https://test-bank.local/login',
    loginSetup: LOGIN_SETUP_OTP_ENABLED,
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

interface ITestCredentials {
  username: string;
  password: string;
}
const TEST_CREDS: ITestCredentials = CREDS_USERNAME_PASSWORD;

let browser: Browser;

beforeAll(async () => {
  browser = await getSharedBrowser();
}, 60000);

afterAll(async () => {
  await closeSharedBrowser();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

/*
 * Re-enabled in Phase 7.5 — OTP detection passes now that
 * GenericBankScraper reads `loginSetup` from `ILoginConfig` directly
 * (no legacy SCRAPER_CONFIGURATION lookup) and the OTP-trigger
 * detection path was restored in Phase 7.
 */
describe('OTP detection', () => {
  it('Test 1: OTP screen detected, no retriever → TwoFactorRetrieverMissing', async () => {
    const scraper = new ConcreteGenericScraper(
      {
        companyId: CompanyTypes.Beinleumi,
        startDate: new Date('2026-01-01'),
        browser,
        skipCloseBrowser: true,
        defaultTimeout: 3000,
        preparePage: buildLoginDashboardPage(OTP_CODE_ENTRY_HTML),
      },
      makeLoginConfig(),
    );

    const result = await scraper.scrape(TEST_CREDS);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.TwoFactorRetrieverMissing);
    expect(result.errorMessage).toMatch(/otpCodeRetriever/);
  }, 60000);

  it('Test 2: OTP code-entry screen, retriever provided → code filled → login succeeds', async () => {
    const retrieverSpy = jest.fn().mockResolvedValue('123456');
    const scraper = new ConcreteGenericScraper(
      {
        companyId: CompanyTypes.Beinleumi,
        startDate: new Date('2026-01-01'),
        browser,
        skipCloseBrowser: true,
        defaultTimeout: 3000,
        preparePage: buildLoginDashboardPage(OTP_CODE_ENTRY_HTML),
        otpCodeRetriever: retrieverSpy,
      },
      makeLoginConfig(),
    );

    const result = await scraper.scrape(TEST_CREDS);
    expect(result.success).toBe(true);
    expect(retrieverSpy).toHaveBeenCalledTimes(1);
    const isAnyString = expect.any(String) as unknown as string;
    expect(retrieverSpy).toHaveBeenCalledWith(isAnyString);
  }, 60000);

  it('Test 3: Two-screen OTP flow (Beinleumi-like) — SMS selection then code entry → success', async () => {
    const retrieverSpy = jest.fn().mockResolvedValue('654321');
    const scraper = new ConcreteGenericScraper(
      {
        companyId: CompanyTypes.Beinleumi,
        startDate: new Date('2026-01-01'),
        browser,
        skipCloseBrowser: true,
        defaultTimeout: 3000,
        preparePage: buildLoginDashboardPage(OTP_SELECTION_HTML),
        otpCodeRetriever: retrieverSpy,
      },
      makeLoginConfig(),
    );

    const result = await scraper.scrape(TEST_CREDS);
    expect(result.success).toBe(true);
    const firstCall = retrieverSpy.mock.calls[0] as string[];
    const retrievedHint = firstCall[0];
    expect(retrievedHint).toBe('*****5100');
  }, 60000);

  it('Test 4: Normal login (no OTP) — zero regression, login succeeds', async () => {
    const scraper = new ConcreteGenericScraper(
      {
        companyId: CompanyTypes.Discount,
        startDate: new Date('2026-01-01'),
        browser,
        skipCloseBrowser: true,
        defaultTimeout: 3000,
        preparePage: buildLoginDashboardPage(NORMAL_LOGIN_HTML),
      },
      makeLoginConfig(),
    );

    const result = await scraper.scrape(TEST_CREDS);
    expect(result.success).toBe(true);
    expect(result.errorType).toBeUndefined();
  }, 60000);

  it('Test 5: Two-screen OTP with triggerSelectors — confirm button clicked → code entry → success', async () => {
    const retrieverSpy = jest.fn().mockResolvedValue('112233');
    const scraper = new ConcreteGenericScraper(
      {
        companyId: CompanyTypes.Beinleumi,
        startDate: new Date('2026-01-01'),
        browser,
        skipCloseBrowser: true,
        defaultTimeout: 5000,
        preparePage: buildLoginDashboardPage(OTP_CONFIRM_THEN_CODE_HTML),
        otpCodeRetriever: retrieverSpy,
      },
      makeLoginConfig({
        otp: {
          kind: 'dom',
          triggerSelectors: [{ kind: 'textContent', value: 'שלח' }],
          inputSelectors: [{ kind: 'placeholder', value: 'קוד חד פעמי' }],
          submitSelectors: [{ kind: 'textContent', value: 'אישור' }],
          longTermTokenSupported: false,
        },
      }),
    );

    const result = await scraper.scrape(TEST_CREDS);
    expect(result.success).toBe(true);
    expect(retrieverSpy).toHaveBeenCalledTimes(1);
    const firstCall = retrieverSpy.mock.calls[0] as string[];
    expect(firstCall[0]).toBe('*****5100');
  }, 60000);

  it('Test 6: No confirm button on page — triggerSelectors miss gracefully, SMS trigger still works', async () => {
    const retrieverSpy = jest.fn().mockResolvedValue('654321');
    const scraper = new ConcreteGenericScraper(
      {
        companyId: CompanyTypes.Beinleumi,
        startDate: new Date('2026-01-01'),
        browser,
        skipCloseBrowser: true,
        defaultTimeout: 5000,
        preparePage: buildLoginDashboardPage(OTP_SELECTION_HTML),
        otpCodeRetriever: retrieverSpy,
      },
      makeLoginConfig({
        otp: {
          kind: 'dom',
          triggerSelectors: [{ kind: 'textContent', value: 'NON_EXISTENT_BUTTON' }],
          inputSelectors: [{ kind: 'placeholder', value: 'קוד חד פעמי' }],
          submitSelectors: [{ kind: 'textContent', value: 'אשר' }],
          longTermTokenSupported: false,
        },
      }),
    );

    const result = await scraper.scrape(TEST_CREDS);
    expect(result.success).toBe(true);
    expect(retrieverSpy).toHaveBeenCalledTimes(1);
  }, 60000);

  it('Test 7: Login error page — false-positive guard, no OTP triggered', async () => {
    const retrieverSpy = jest.fn();
    const scraper = new ConcreteGenericScraper(
      {
        companyId: CompanyTypes.Discount,
        startDate: new Date('2026-01-01'),
        browser,
        skipCloseBrowser: true,
        defaultTimeout: 3000,
        preparePage: buildLoginErrorPage(LOGIN_ERROR_HTML),
        otpCodeRetriever: retrieverSpy,
      },
      makeLoginConfig(),
    );

    const result = await scraper.scrape(CREDS_WRONG);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.InvalidPassword);
    expect(retrieverSpy).not.toHaveBeenCalled();
  }, 60000);
});
