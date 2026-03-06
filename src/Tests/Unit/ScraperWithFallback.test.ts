import { BrowserEngineType } from '../../Common/BrowserEngine';
import { ScraperErrorTypes } from '../../Scrapers/Base/Errors';
import type {
  ScraperCredentials,
  ScraperOptions,
  ScraperScrapingResult,
} from '../../Scrapers/Base/Interface';
import { DEFAULT_ENGINE_CHAIN, ScraperWithFallback } from '../../Scrapers/Base/ScraperWithFallback';

jest.mock('../../Common/Debug', () => ({
  /**
   * Returns mock debug logger stubs.
   *
   * @returns a mock debug logger with info and error functions
   */
  getDebug: (): Record<string, jest.Mock> => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

const CREDS: ScraperCredentials = { userCode: 'test', password: 'test' };
const BASE_OPTIONS: ScraperOptions = {
  companyId: 'hapoalim' as ScraperOptions['companyId'],
  startDate: new Date('2024-01-01'),
};

/**
 * Creates a mock Scraper that returns the given result.
 *
 * @param result - the ScraperScrapingResult to return from scrape()
 * @returns a mock Scraper instance
 */
function mockScraper(result: ScraperScrapingResult): { scrape: jest.Mock; onProgress: jest.Mock } {
  return { scrape: jest.fn().mockResolvedValue(result), onProgress: jest.fn() };
}

describe('DEFAULT_ENGINE_CHAIN', () => {
  it('contains PlaywrightStealth, Rebrowser, and Patchright in order', () => {
    expect(DEFAULT_ENGINE_CHAIN).toEqual([
      BrowserEngineType.PlaywrightStealth,
      BrowserEngineType.Rebrowser,
      BrowserEngineType.Patchright,
    ]);
  });
});

describe('ScraperWithFallback', () => {
  it('returns success result without trying other engines', async () => {
    const success: ScraperScrapingResult = { success: true };
    const scraperMock = mockScraper(success);
    const createFn = jest.fn().mockReturnValue(scraperMock);
    const fallback = new ScraperWithFallback(BASE_OPTIONS, createFn, [
      BrowserEngineType.PlaywrightStealth,
      BrowserEngineType.Rebrowser,
    ]);
    const result = await fallback.scrape(CREDS);
    expect(result.success).toBe(true);
    expect(createFn).toHaveBeenCalledTimes(1);
  });

  it('falls back on WafBlocked and returns next engine result', async () => {
    const wafResult: ScraperScrapingResult = {
      success: false,
      errorType: ScraperErrorTypes.WafBlocked,
    };
    const successResult: ScraperScrapingResult = { success: true };
    const wafScraper = mockScraper(wafResult);
    const successScraper = mockScraper(successResult);
    const createFn = jest.fn().mockReturnValueOnce(wafScraper).mockReturnValueOnce(successScraper);
    const fallback = new ScraperWithFallback(BASE_OPTIONS, createFn, [
      BrowserEngineType.PlaywrightStealth,
      BrowserEngineType.Rebrowser,
    ]);
    const result = await fallback.scrape(CREDS);
    expect(result.success).toBe(true);
    expect(createFn).toHaveBeenCalledTimes(2);
  });

  it('falls back on Timeout and returns next engine result', async () => {
    const timeoutResult: ScraperScrapingResult = {
      success: false,
      errorType: ScraperErrorTypes.Timeout,
    };
    const successResult: ScraperScrapingResult = { success: true };
    const timeoutScraper = mockScraper(timeoutResult);
    const successScraper = mockScraper(successResult);
    const createFn = jest
      .fn()
      .mockReturnValueOnce(timeoutScraper)
      .mockReturnValueOnce(successScraper);
    const fallback = new ScraperWithFallback(BASE_OPTIONS, createFn, [
      BrowserEngineType.PlaywrightStealth,
      BrowserEngineType.Rebrowser,
    ]);
    const result = await fallback.scrape(CREDS);
    expect(result.success).toBe(true);
    expect(createFn).toHaveBeenCalledTimes(2);
  });

  it('does NOT fall back on InvalidPassword — returns immediately', async () => {
    const invalidPwd: ScraperScrapingResult = {
      success: false,
      errorType: ScraperErrorTypes.InvalidPassword,
    };
    const invalidScraper = mockScraper(invalidPwd);
    const createFn = jest.fn().mockReturnValue(invalidScraper);
    const fallback = new ScraperWithFallback(BASE_OPTIONS, createFn, [
      BrowserEngineType.PlaywrightStealth,
      BrowserEngineType.Rebrowser,
    ]);
    const result = await fallback.scrape(CREDS);
    expect(result.errorType).toBe(ScraperErrorTypes.InvalidPassword);
    expect(createFn).toHaveBeenCalledTimes(1);
  });

  it('returns last engine result when all engines fail with WafBlocked', async () => {
    const wafResult: ScraperScrapingResult = {
      success: false,
      errorType: ScraperErrorTypes.WafBlocked,
      errorMessage: 'blocked',
    };
    const wafScraper = mockScraper(wafResult);
    const createFn = jest.fn().mockReturnValue(wafScraper);
    const fallback = new ScraperWithFallback(BASE_OPTIONS, createFn, [
      BrowserEngineType.PlaywrightStealth,
      BrowserEngineType.Rebrowser,
    ]);
    const result = await fallback.scrape(CREDS);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.WafBlocked);
    expect(createFn).toHaveBeenCalledTimes(2);
  });

  it('catches unexpected throws and wraps as Generic error', async () => {
    const crashScraper = { scrape: jest.fn().mockRejectedValue(new Error('unexpected crash')) };
    const createFn = jest.fn().mockReturnValue(crashScraper);
    const fallback = new ScraperWithFallback(BASE_OPTIONS, createFn, [
      BrowserEngineType.PlaywrightStealth,
    ]);
    const result = await fallback.scrape(CREDS);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.Generic);
    expect(result.errorMessage).toBe('unexpected crash');
  });

  it('injects engineType into options for each attempt', async () => {
    const success: ScraperScrapingResult = { success: true };
    const successScraper = mockScraper(success);
    const createFn = jest.fn().mockReturnValue(successScraper);
    const fallback = new ScraperWithFallback(BASE_OPTIONS, createFn, [BrowserEngineType.Rebrowser]);
    await fallback.scrape(CREDS);
    const calls = createFn.mock.calls as [ScraperOptions][];
    const passedOpts = calls[0][0];
    expect((passedOpts as Record<string, unknown>).engineType).toBe(BrowserEngineType.Rebrowser);
  });

  it('uses DEFAULT_ENGINE_CHAIN when no engines provided', async () => {
    const success: ScraperScrapingResult = { success: true };
    const successScraper = mockScraper(success);
    const createFn = jest.fn().mockReturnValue(successScraper);
    const fallback = new ScraperWithFallback(BASE_OPTIONS, createFn);
    await fallback.scrape(CREDS);
    const calls = createFn.mock.calls as [ScraperOptions][];
    const passedOpts = calls[0][0];
    expect((passedOpts as Record<string, unknown>).engineType).toBe(
      BrowserEngineType.PlaywrightStealth,
    );
  });
});
