/* eslint-disable @typescript-eslint/unbound-method */
import { type Browser, type BrowserContext } from 'playwright';
import { chromium } from 'playwright-extra';

import { clickButton, fillInput, waitUntilElementFound } from '../../Common/ElementsInteractions';
import { getCurrentUrl, waitForNavigation } from '../../Common/Navigation';
import { LOGIN_RESULTS } from '../../Scrapers/Base/BaseScraperWithBrowser';
import { ScraperErrorTypes } from '../../Scrapers/Base/Errors';
import type { ScraperOptions } from '../../Scrapers/Base/Interface';
import { ScraperAuthenticationError } from '../../Scrapers/Base/ScraperAuthenticationError';
import {
  createMockBrowser,
  createMockContext,
  createMockPage,
  createMockScraperOptions,
} from '../MockPage';
import TestBrowserScraper, {
  createScraper,
  defaultLoginOptions,
} from './BaseScraperWithBrowserTestHelpers';

jest.mock('playwright-extra', () => ({ chromium: { launch: jest.fn(), use: jest.fn() } }));
jest.mock('puppeteer-extra-plugin-stealth', () => jest.fn());

jest.mock('../../Common/ElementsInteractions', () => ({
  clickButton: jest.fn().mockResolvedValue(undefined),
  fillInput: jest.fn().mockResolvedValue(undefined),
  waitUntilElementFound: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../Common/Navigation', () => ({
  getCurrentUrl: jest.fn().mockResolvedValue('https://bank.co.il/dashboard'),
  waitForNavigation: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../Common/Debug', () => ({
  getDebug: (): Record<string, jest.Mock> => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

jest.mock('../../Common/Browser', () => ({
  buildContextOptions: jest.fn().mockReturnValue({}),
}));

const MOCK_PAGE: ReturnType<typeof createMockPage> = createMockPage();
const MOCK_CONTEXT: ReturnType<typeof createMockContext> = createMockContext(MOCK_PAGE);
const MOCK_BROWSER: ReturnType<typeof createMockBrowser> = createMockBrowser(MOCK_CONTEXT);

beforeEach(() => {
  jest.clearAllMocks();
  (chromium.launch as jest.Mock).mockResolvedValue(MOCK_BROWSER);
  const freshPage = createMockPage();
  const freshContext = createMockContext(freshPage);
  MOCK_BROWSER.newContext.mockResolvedValue(freshContext);
  (getCurrentUrl as jest.Mock).mockResolvedValue('https://bank.co.il/dashboard');
});

describe('initialize', () => {
  it('launches browser and creates context + page', async () => {
    const scraper = createScraper();
    await scraper.scrape({ userCode: 'test', password: 'test' });
    expect(chromium.launch).toHaveBeenCalled();
    expect(MOCK_BROWSER.newContext).toHaveBeenCalled();
  });

  it('sets default timeout when provided in options', async () => {
    const page = createMockPage();
    const ctx = createMockContext(page);
    MOCK_BROWSER.newContext.mockResolvedValue(ctx);
    const scraper = createScraper({ defaultTimeout: 60000 });
    await scraper.scrape({ userCode: 'test', password: 'test' });
    expect(page.setDefaultTimeout).toHaveBeenCalledWith(60000);
  });

  it('calls preparePage hook when provided', async () => {
    const preparePage = jest.fn().mockResolvedValue(undefined);
    const scraper = createScraper({ preparePage });
    await scraper.scrape({ userCode: 'test', password: 'test' });
    expect(preparePage).toHaveBeenCalled();
  });
});

describe('initializePage', () => {
  it('uses browserContext when provided', async () => {
    const page = createMockPage();
    const browserContext = {
      newPage: jest.fn().mockResolvedValue(page),
    } as unknown as BrowserContext;
    const scraper = new TestBrowserScraper(createMockScraperOptions({ browserContext }));
    await scraper.scrape({ userCode: 'test', password: 'test' });
    expect(browserContext.newPage).toHaveBeenCalled();
    expect(chromium.launch).not.toHaveBeenCalled();
  });

  it('uses external browser and creates context', async () => {
    const page = createMockPage();
    const ctx = createMockContext(page);
    const browser = {
      newContext: jest.fn().mockResolvedValue(ctx),
      close: jest.fn(),
    } as unknown as Browser;
    const scraper = new TestBrowserScraper(createMockScraperOptions({ browser }));
    await scraper.scrape({ userCode: 'test', password: 'test' });
    expect(browser.newContext).toHaveBeenCalled();
    expect(chromium.launch).not.toHaveBeenCalled();
  });

  it('skips browser close cleanup when skipCloseBrowser is true', async () => {
    const page = createMockPage();
    const ctx = createMockContext(page);
    const browser = {
      newContext: jest.fn().mockResolvedValue(ctx),
      close: jest.fn(),
    } as unknown as Browser;
    const scraper = new TestBrowserScraper(
      createMockScraperOptions({ browser, skipCloseBrowser: true }),
    );
    await scraper.scrape({ userCode: 'test', password: 'test' });
    expect(browser.close).not.toHaveBeenCalled();
  });

  it('launches new browser with headless mode', async () => {
    const scraper = createScraper({ shouldShowBrowser: false });
    await scraper.scrape({ userCode: 'test', password: 'test' });
    expect(chromium.launch).toHaveBeenCalledWith(expect.objectContaining({ headless: true }));
  });

  it('calls prepareBrowser hook when provided', async () => {
    const prepareBrowser = jest.fn().mockResolvedValue(undefined);
    const scraper = createScraper({ prepareBrowser });
    await scraper.scrape({ userCode: 'test', password: 'test' });
    expect(prepareBrowser).toHaveBeenCalledWith(MOCK_BROWSER);
  });

  it('launches successfully without executablePath (uses Playwright bundled Chromium)', async () => {
    const scraper = createScraper();
    const result = await scraper.scrape({ userCode: 'test', password: 'test' });
    expect(result.success).toBe(true);
    expect(chromium.launch).toHaveBeenCalledWith(
      expect.not.objectContaining({ executablePath: expect.any(String) as string }),
    );
  });

  it('rejects custom executablePath to prevent system Chromium usage', async () => {
    const scraper = createScraper({
      executablePath: '/usr/bin/chromium',
    } as Partial<ScraperOptions>);
    await expect(scraper.scrape({ userCode: 'test', password: 'test' })).rejects.toThrow(
      'Custom executablePath "/usr/bin/chromium" is not supported',
    );
  });
});

describe('navigateTo', () => {
  it('navigates to URL successfully', async () => {
    const page = createMockPage();
    page.goto.mockResolvedValue({ ok: () => true, status: () => 200 });
    const ctx = createMockContext(page);
    MOCK_BROWSER.newContext.mockResolvedValue(ctx);
    const scraper = createScraper();
    await scraper.scrape({ userCode: 'test', password: 'test' });
    expect(page.goto).toHaveBeenCalledWith('https://bank.co.il/login', { waitUntil: 'load' });
  });

  it('accepts null response (hash navigation)', async () => {
    const page = createMockPage();
    page.goto.mockResolvedValue(null);
    const ctx = createMockContext(page);
    MOCK_BROWSER.newContext.mockResolvedValue(ctx);
    const scraper = createScraper();
    const result = await scraper.scrape({ userCode: 'test', password: 'test' });
    expect(result.success).toBeDefined();
  });

  it('retries on non-OK response when retries available', async () => {
    const page = createMockPage();
    page.goto
      .mockResolvedValueOnce({ ok: () => false, status: () => 503 })
      .mockResolvedValueOnce({ ok: () => true, status: () => 200 });
    const ctx = createMockContext(page);
    MOCK_BROWSER.newContext.mockResolvedValue(ctx);
    const scraper = createScraper({ navigationRetryCount: 1 });
    await scraper.scrape({ userCode: 'test', password: 'test' });
    expect(page.goto).toHaveBeenCalledTimes(2);
  });

  it('throws when retries exhausted', async () => {
    const page = createMockPage();
    page.goto.mockResolvedValue({ ok: () => false, status: () => 500 });
    const ctx = createMockContext(page);
    MOCK_BROWSER.newContext.mockResolvedValue(ctx);
    const scraper = createScraper({ navigationRetryCount: 0 });
    const result = await scraper.scrape({ userCode: 'test', password: 'test' });
    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain('status code: 500');
  });
});

describe('fillInputs', () => {
  it('fills multiple input fields', async () => {
    const scraper = createScraper();
    await scraper.scrape({ userCode: 'test', password: 'test' });
    expect(fillInput).toHaveBeenCalledWith(expect.anything(), '#user', 'testuser');
    expect(fillInput).toHaveBeenCalledWith(expect.anything(), '#pass', 'testpass');
  });

  it('handles empty fields array', async () => {
    const scraper = createScraper();
    scraper.loginOpts = { ...defaultLoginOptions(), fields: [] };
    await scraper.scrape({ userCode: 'test', password: 'test' });
    expect(fillInput).not.toHaveBeenCalled();
  });
});

describe('login', () => {
  it('returns general error when login throws', async () => {
    const scraper = createScraper();
    scraper.loginOpts = {
      ...defaultLoginOptions(),
      checkReadiness: (): Promise<void> => {
        throw new ScraperAuthenticationError('test-bank', 'login failed unexpectedly');
      },
    };
    const result = await scraper.scrape({ userCode: 'test', password: 'test' });
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.Generic);
  });

  it('completes successful login flow', async () => {
    const scraper = createScraper();
    const result = await scraper.scrape({ userCode: 'test', password: 'test' });
    expect(result.success).toBe(true);
  });

  it('calls checkReadiness when provided', async () => {
    const checkReadiness = jest.fn().mockResolvedValue(undefined);
    const scraper = createScraper();
    scraper.loginOpts = { ...defaultLoginOptions(), checkReadiness };
    await scraper.scrape({ userCode: 'test', password: 'test' });
    expect(checkReadiness).toHaveBeenCalled();
    expect(waitUntilElementFound).not.toHaveBeenCalled();
  });

  it('waits for submit button when no checkReadiness', async () => {
    const scraper = createScraper();
    await scraper.scrape({ userCode: 'test', password: 'test' });
    expect(waitUntilElementFound).toHaveBeenCalledWith(expect.anything(), '#submit');
  });

  it('calls function submitButtonSelector instead of clicking', async () => {
    const submitFn = jest.fn().mockResolvedValue(undefined);
    const scraper = createScraper();
    scraper.loginOpts = { ...defaultLoginOptions(), submitButtonSelector: submitFn };
    await scraper.scrape({ userCode: 'test', password: 'test' });
    expect(submitFn).toHaveBeenCalled();
    expect(clickButton).not.toHaveBeenCalled();
  });

  it('clicks string submitButtonSelector', async () => {
    const scraper = createScraper();
    await scraper.scrape({ userCode: 'test', password: 'test' });
    expect(clickButton).toHaveBeenCalledWith(expect.anything(), '#submit');
  });

  it('calls postAction when provided', async () => {
    const postAction = jest.fn().mockResolvedValue(undefined);
    const scraper = createScraper();
    scraper.loginOpts = { ...defaultLoginOptions(), postAction };
    await scraper.scrape({ userCode: 'test', password: 'test' });
    expect(postAction).toHaveBeenCalled();
    expect(waitForNavigation).not.toHaveBeenCalled();
  });

  it('waits for navigation when no postAction', async () => {
    const scraper = createScraper();
    await scraper.scrape({ userCode: 'test', password: 'test' });
    expect(waitForNavigation).toHaveBeenCalled();
  });

  it('detects invalid password from URL', async () => {
    (getCurrentUrl as jest.Mock).mockResolvedValue('https://bank.co.il/login?error=1');
    const scraper = createScraper();
    const result = await scraper.scrape({ userCode: 'test', password: 'test' });
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.InvalidPassword);
  });

  it('detects change password from regex match', async () => {
    (getCurrentUrl as jest.Mock).mockResolvedValue('https://bank.co.il/change-password');
    const scraper = createScraper();
    const result = await scraper.scrape({ userCode: 'test', password: 'test' });
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.ChangePassword);
  });

  it('returns unknown error when no URL matches', async () => {
    (getCurrentUrl as jest.Mock).mockResolvedValue('https://bank.co.il/unknown-page');
    const scraper = createScraper();
    const result = await scraper.scrape({ userCode: 'test', password: 'test' });
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.Generic);
  });

  it('detects login result via async function condition', async () => {
    (getCurrentUrl as jest.Mock).mockResolvedValue('https://bank.co.il/otp');
    const scraper = createScraper();
    scraper.loginOpts = {
      ...defaultLoginOptions(),
      possibleResults: {
        [LOGIN_RESULTS.Success]: [(): Promise<boolean> => Promise.resolve(true)],
      },
    };
    const result = await scraper.scrape({ userCode: 'test', password: 'test' });
    expect(result.success).toBe(true);
  });
});
