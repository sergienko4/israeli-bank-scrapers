/* eslint-disable @typescript-eslint/unbound-method */
import puppeteer from 'puppeteer';
import { ScraperProgressTypes } from '../definitions';
import { clickButton, fillInput, waitUntilElementFound } from '../helpers/elements-interactions';
import { getCurrentUrl, waitForNavigation } from '../helpers/navigation';
import { createMockPage, createMockScraperOptions } from '../tests/mock-page';
import { BaseScraperWithBrowser, LoginResults, type LoginOptions } from './base-scraper-with-browser';
import { ScraperErrorTypes } from './errors';
import type { ScraperCredentials, ScraperScrapingResult } from './interface';

jest.mock('puppeteer', () => ({
  launch: jest.fn(),
}));

jest.mock('../helpers/elements-interactions', () => ({
  clickButton: jest.fn().mockResolvedValue(undefined),
  fillInput: jest.fn().mockResolvedValue(undefined),
  waitUntilElementFound: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../helpers/navigation', () => ({
  getCurrentUrl: jest.fn().mockResolvedValue('https://bank.co.il/dashboard'),
  waitForNavigation: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../helpers/debug', () => ({
  getDebug: () => jest.fn(),
}));

const mockPage = createMockPage();
const mockBrowser = {
  newPage: jest.fn().mockResolvedValue(mockPage),
  close: jest.fn().mockResolvedValue(undefined),
  version: jest.fn().mockResolvedValue('HeadlessChrome/131'),
};

function defaultLoginOptions(): LoginOptions {
  return {
    loginUrl: 'https://bank.co.il/login',
    fields: [
      { selector: '#user', value: 'testuser' },
      { selector: '#pass', value: 'testpass' },
    ],
    submitButtonSelector: '#submit',
    possibleResults: {
      [LoginResults.Success]: ['https://bank.co.il/dashboard'],
      [LoginResults.InvalidPassword]: ['https://bank.co.il/login?error=1'],
      [LoginResults.ChangePassword]: [/change-password/],
    },
  };
}

class TestBrowserScraper extends BaseScraperWithBrowser<ScraperCredentials> {
  loginOpts: LoginOptions = defaultLoginOptions();

  fetchResult: ScraperScrapingResult = { success: true, accounts: [] };

  getLoginOptions(): LoginOptions {
    return this.loginOpts;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async fetchData(): Promise<ScraperScrapingResult> {
    return this.fetchResult;
  }
}

function createScraper(overrides = {}) {
  return new TestBrowserScraper(createMockScraperOptions(overrides));
}

beforeEach(() => {
  jest.clearAllMocks();
  (puppeteer.launch as jest.Mock).mockResolvedValue(mockBrowser);
  mockBrowser.newPage.mockResolvedValue(createMockPage());
  (getCurrentUrl as jest.Mock).mockResolvedValue('https://bank.co.il/dashboard');
});

describe('getViewPort', () => {
  it('returns default 1024x768 when no custom viewport', () => {
    const scraper = createScraper();

    const viewport = scraper['getViewPort']();
    expect(viewport).toEqual({ width: 1024, height: 768 });
  });

  it('returns custom viewport from options', () => {
    const scraper = createScraper({ viewportSize: { width: 1920, height: 1080 } });

    const viewport = scraper['getViewPort']();
    expect(viewport).toEqual({ width: 1920, height: 1080 });
  });
});

describe('initialize', () => {
  it('launches browser and creates page', async () => {
    const scraper = createScraper();
    await scraper.scrape({ userCode: 'test', password: 'test' });
    expect(puppeteer.launch).toHaveBeenCalled();
    expect(mockBrowser.newPage).toHaveBeenCalled();
  });

  it('sets default timeout when provided in options', async () => {
    const page = createMockPage();
    mockBrowser.newPage.mockResolvedValue(page);
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

  it('sets viewport dimensions', async () => {
    const page = createMockPage();
    mockBrowser.newPage.mockResolvedValue(page);
    const scraper = createScraper({ viewportSize: { width: 800, height: 600 } });
    await scraper.scrape({ userCode: 'test', password: 'test' });
    expect(page.setViewport).toHaveBeenCalledWith({ width: 800, height: 600 });
  });
});

describe('initializePage', () => {
  it('uses browserContext when provided', async () => {
    const page = createMockPage();
    const browserContext = { newPage: jest.fn().mockResolvedValue(page) };
    const scraper = new TestBrowserScraper(createMockScraperOptions({ browserContext } as any));
    await scraper.scrape({ userCode: 'test', password: 'test' });
    expect(browserContext.newPage).toHaveBeenCalled();
    expect(puppeteer.launch).not.toHaveBeenCalled();
  });

  it('uses external browser when provided', async () => {
    const page = createMockPage();
    const browser = { newPage: jest.fn().mockResolvedValue(page), close: jest.fn() };
    const scraper = new TestBrowserScraper(createMockScraperOptions({ browser } as any));
    await scraper.scrape({ userCode: 'test', password: 'test' });
    expect(browser.newPage).toHaveBeenCalled();
    expect(puppeteer.launch).not.toHaveBeenCalled();
  });

  it('skips browser close cleanup when skipCloseBrowser is true', async () => {
    const page = createMockPage();
    const browser = { newPage: jest.fn().mockResolvedValue(page), close: jest.fn() };
    const scraper = new TestBrowserScraper(createMockScraperOptions({ browser, skipCloseBrowser: true } as any));
    await scraper.scrape({ userCode: 'test', password: 'test' });
    expect(browser.close).not.toHaveBeenCalled();
  });

  it('launches new browser with headless mode', async () => {
    const scraper = createScraper({ showBrowser: false });
    await scraper.scrape({ userCode: 'test', password: 'test' });
    expect(puppeteer.launch).toHaveBeenCalledWith(expect.objectContaining({ headless: true }));
  });

  it('calls prepareBrowser hook when provided', async () => {
    const prepareBrowser = jest.fn().mockResolvedValue(undefined);
    const scraper = createScraper({ prepareBrowser });
    await scraper.scrape({ userCode: 'test', password: 'test' });
    expect(prepareBrowser).toHaveBeenCalledWith(mockBrowser);
  });
});

describe('navigateTo', () => {
  it('navigates to URL successfully', async () => {
    const page = createMockPage();
    page.goto.mockResolvedValue({ ok: () => true, status: () => 200 });
    mockBrowser.newPage.mockResolvedValue(page);
    const scraper = createScraper();
    await scraper.scrape({ userCode: 'test', password: 'test' });
    expect(page.goto).toHaveBeenCalledWith('https://bank.co.il/login', { waitUntil: 'load' });
  });

  it('accepts null response (hash navigation)', async () => {
    const page = createMockPage();
    page.goto.mockResolvedValue(null);
    mockBrowser.newPage.mockResolvedValue(page);
    const scraper = createScraper();
    const result = await scraper.scrape({ userCode: 'test', password: 'test' });
    expect(result.success).toBeDefined();
  });

  it('retries on non-OK response when retries available', async () => {
    const page = createMockPage();
    page.goto
      .mockResolvedValueOnce({ ok: () => false, status: () => 503 })
      .mockResolvedValueOnce({ ok: () => true, status: () => 200 });
    mockBrowser.newPage.mockResolvedValue(page);
    const scraper = createScraper({ navigationRetryCount: 1 });
    await scraper.scrape({ userCode: 'test', password: 'test' });
    expect(page.goto).toHaveBeenCalledTimes(2);
  });

  it('throws when retries exhausted', async () => {
    const page = createMockPage();
    page.goto.mockResolvedValue({ ok: () => false, status: () => 500 });
    mockBrowser.newPage.mockResolvedValue(page);
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
  it('returns general error when no credentials', async () => {
    const scraper = createScraper();
    // @ts-ignore — testing null credentials path
    const result = await scraper.scrape(null);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.General);
  });

  it('completes successful login flow', async () => {
    const scraper = createScraper();
    const result = await scraper.scrape({ userCode: 'test', password: 'test' });
    expect(result.success).toBe(true);
  });

  it('sets custom user agent when provided', async () => {
    const page = createMockPage();
    mockBrowser.newPage.mockResolvedValue(page);
    const scraper = createScraper();
    scraper.loginOpts = { ...defaultLoginOptions(), userAgent: 'CustomBot/1.0' };
    await scraper.scrape({ userCode: 'test', password: 'test' });
    expect(page.setUserAgent).toHaveBeenCalledWith('CustomBot/1.0');
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
    expect(result.errorType).toBe(ScraperErrorTypes.General);
  });

  it('detects login result via async function condition', async () => {
    (getCurrentUrl as jest.Mock).mockResolvedValue('https://bank.co.il/otp');
    const scraper = createScraper();
    scraper.loginOpts = {
      ...defaultLoginOptions(),
      possibleResults: {
        [LoginResults.Success]: [() => Promise.resolve(true)],
      },
    };
    const result = await scraper.scrape({ userCode: 'test', password: 'test' });
    expect(result.success).toBe(true);
  });
});

describe('terminate', () => {
  it('skips screenshot on success', async () => {
    const page = createMockPage();
    mockBrowser.newPage.mockResolvedValue(page);
    const scraper = createScraper({ storeFailureScreenShotPath: '/tmp/fail.png' });
    await scraper.scrape({ userCode: 'test', password: 'test' });
    expect(page.screenshot).not.toHaveBeenCalled();
  });

  it('captures screenshot on failure when path configured', async () => {
    const page = createMockPage();
    page.goto.mockResolvedValue({ ok: () => false, status: () => 500 });
    mockBrowser.newPage.mockResolvedValue(page);
    const scraper = createScraper({
      storeFailureScreenShotPath: '/tmp/fail.png',
      navigationRetryCount: 0,
    });
    await scraper.scrape({ userCode: 'test', password: 'test' });
    expect(page.screenshot).toHaveBeenCalledWith({ path: '/tmp/fail.png', fullPage: true });
  });

  it('executes cleanups after scrape', async () => {
    const scraper = createScraper();
    await scraper.scrape({ userCode: 'test', password: 'test' });
    expect(mockBrowser.close).toHaveBeenCalled();
  });
});

describe('progress events', () => {
  it('emits Initializing and LoginSuccess on successful login', async () => {
    const events: ScraperProgressTypes[] = [];
    const scraper = createScraper();
    scraper.onProgress((_id, payload) => events.push(payload.type));
    await scraper.scrape({ userCode: 'test', password: 'test' });
    expect(events).toContain(ScraperProgressTypes.Initializing);
    expect(events).toContain(ScraperProgressTypes.LoginSuccess);
    expect(events).toContain(ScraperProgressTypes.LoggingIn);
  });

  it('emits LoginFailed on invalid password', async () => {
    (getCurrentUrl as jest.Mock).mockResolvedValue('https://bank.co.il/login?error=1');
    const events: ScraperProgressTypes[] = [];
    const scraper = createScraper();
    scraper.onProgress((_id, payload) => events.push(payload.type));
    await scraper.scrape({ userCode: 'test', password: 'test' });
    expect(events).toContain(ScraperProgressTypes.LoginFailed);
  });
});

describe('getLoginOptions', () => {
  it('throws when not overridden', () => {
    class BareScraperWithBrowser extends BaseScraperWithBrowser<ScraperCredentials> {
      // eslint-disable-next-line @typescript-eslint/require-await
      async fetchData() {
        return { success: true, accounts: [] };
      }
    }
    const scraper = new BareScraperWithBrowser(createMockScraperOptions());
    expect(() => scraper.getLoginOptions({ userCode: 'a', password: 'b' })).toThrow('getLoginOptions()');
  });
});
