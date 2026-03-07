import {
  BrowserEngineType,
  getGlobalEngineChain,
  setGlobalEngineChain,
} from '../../Common/BrowserEngine';
import { ScraperErrorTypes } from '../../Scrapers/Base/Errors';
import type {
  IScraperScrapingResult,
  ScraperCredentials,
  ScraperOptions,
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
 * Creates a mock IScraper that returns the given result.
 *
 * @param result - the IScraperScrapingResult to return from scrape()
 * @returns a mock IScraper instance
 */
function mockScraper(result: IScraperScrapingResult): { scrape: jest.Mock; onProgress: jest.Mock } {
  return { scrape: jest.fn().mockResolvedValue(result), onProgress: jest.fn() };
}

describe('DEFAULT_ENGINE_CHAIN', () => {
  it('contains PlaywrightStealth, Rebrowser, and Patchright in order (backward compat)', () => {
    expect(DEFAULT_ENGINE_CHAIN).toEqual([
      BrowserEngineType.PlaywrightStealth,
      BrowserEngineType.Rebrowser,
      BrowserEngineType.Patchright,
    ]);
  });
});

describe('ScraperWithFallback', () => {
  it('returns success result without trying other engines', async () => {
    const success: IScraperScrapingResult = { success: true };
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
    const wafResult: IScraperScrapingResult = {
      success: false,
      errorType: ScraperErrorTypes.WafBlocked,
    };
    const successResult: IScraperScrapingResult = { success: true };
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

  it('falls back on Timeout — tries next engine (Timeout can indicate WAF/IP block)', async () => {
    const timeoutResult: IScraperScrapingResult = {
      success: false,
      errorType: ScraperErrorTypes.Timeout,
    };
    const successResult: IScraperScrapingResult = { success: true };
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
    const invalidPwd: IScraperScrapingResult = {
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

  it('returns rich error when all engines fail with WafBlocked', async () => {
    const wafResult: IScraperScrapingResult = {
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
    expect(result.errorMessage).toContain('All engines failed');
    expect(result.errorMessage).toContain('playwright-stealth');
    expect(result.errorMessage).toContain('rebrowser');
    expect(createFn).toHaveBeenCalledTimes(2);
  });

  it('rich error message includes engine name and error for each attempt', async () => {
    const wafResult1: IScraperScrapingResult = {
      success: false,
      errorType: ScraperErrorTypes.WafBlocked,
      errorMessage: 'waf on engine 1',
    };
    const wafResult2: IScraperScrapingResult = {
      success: false,
      errorType: ScraperErrorTypes.WafBlocked,
      errorMessage: 'waf on engine 2',
    };
    const scraper1 = mockScraper(wafResult1);
    const scraper2 = mockScraper(wafResult2);
    const createFn = jest.fn().mockReturnValueOnce(scraper1).mockReturnValueOnce(scraper2);
    const fallback = new ScraperWithFallback(BASE_OPTIONS, createFn, [
      BrowserEngineType.Camoufox,
      BrowserEngineType.PlaywrightStealth,
    ]);
    const result = await fallback.scrape(CREDS);
    expect(result.errorMessage).toContain('[camoufox]');
    expect(result.errorMessage).toContain('waf on engine 1');
    expect(result.errorMessage).toContain('[playwright-stealth]');
    expect(result.errorMessage).toContain('waf on engine 2');
  });

  it('catches unexpected throws and returns Generic error (no fallback for Generic)', async () => {
    const crashScraper = {
      scrape: jest.fn().mockRejectedValue(new Error('unexpected crash')),
      onProgress: jest.fn(),
    };
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
    const success: IScraperScrapingResult = { success: true };
    const successScraper = mockScraper(success);
    const createFn = jest.fn().mockReturnValue(successScraper);
    const fallback = new ScraperWithFallback(BASE_OPTIONS, createFn, [BrowserEngineType.Rebrowser]);
    await fallback.scrape(CREDS);
    const calls = createFn.mock.calls as [ScraperOptions][];
    const passedOpts = calls[0][0] as ScraperOptions & { engineType: string };
    expect(passedOpts.engineType).toBe(BrowserEngineType.Rebrowser);
  });

  it('uses getGlobalEngineChain() when no engines provided — first engine is PlaywrightStealth', async () => {
    const success: IScraperScrapingResult = { success: true };
    const successScraper = mockScraper(success);
    const createFn = jest.fn().mockReturnValue(successScraper);
    const fallback = new ScraperWithFallback(BASE_OPTIONS, createFn);
    await fallback.scrape(CREDS);
    const calls = createFn.mock.calls as [ScraperOptions][];
    const passedOpts = calls[0][0] as ScraperOptions & { engineType: string };
    expect(passedOpts.engineType).toBe(BrowserEngineType.PlaywrightStealth);
  });

  it('onProgress is forwarded to each engine scraper', async () => {
    const success: IScraperScrapingResult = { success: true };
    const scraperMock = mockScraper(success);
    const createFn = jest.fn().mockReturnValue(scraperMock);
    const fallback = new ScraperWithFallback(BASE_OPTIONS, createFn, [
      BrowserEngineType.PlaywrightStealth,
    ]);
    const cb = jest.fn().mockReturnValue({ done: true });
    fallback.onProgress(cb);
    await fallback.scrape(CREDS);
    expect(scraperMock.onProgress).toHaveBeenCalledWith(cb);
  });

  it('triggerTwoFactorAuth throws ScraperWebsiteChangedError', () => {
    const fallback = new ScraperWithFallback(BASE_OPTIONS, jest.fn(), [
      BrowserEngineType.PlaywrightStealth,
    ]);
    expect(() => fallback.triggerTwoFactorAuth('123')).toThrow();
  });

  it('getLongTermTwoFactorToken throws ScraperWebsiteChangedError', () => {
    const fallback = new ScraperWithFallback(BASE_OPTIONS, jest.fn(), [
      BrowserEngineType.PlaywrightStealth,
    ]);
    expect(() => fallback.getLongTermTwoFactorToken('123')).toThrow();
  });

  it('returns buildAllFailedResult([]) when engines list is empty', async () => {
    const fallback = new ScraperWithFallback(BASE_OPTIONS, jest.fn(), []);
    const result = await fallback.scrape(CREDS);
    expect(result.success).toBe(false);
  });

  it('formatAttempt uses (no message) when errorMessage is absent in attempt', async () => {
    const noMsgResult: IScraperScrapingResult = {
      success: false,
      errorType: ScraperErrorTypes.WafBlocked,
    };
    const scraperForNoMsg = mockScraper(noMsgResult);
    const createFn = jest.fn().mockReturnValueOnce(scraperForNoMsg);
    const fallback = new ScraperWithFallback(BASE_OPTIONS, createFn, [
      BrowserEngineType.PlaywrightStealth,
    ]);
    const result = await fallback.scrape(CREDS);
    const isNoMsg = result.errorMessage?.includes('(no message)') ?? false;
    expect(isNoMsg).toBe(true);
  });

  it('setGlobalEngineChain changes what getGlobalEngineChain returns', () => {
    const original = getGlobalEngineChain().slice();
    setGlobalEngineChain([BrowserEngineType.PlaywrightStealth]);
    const updatedChain = getGlobalEngineChain();
    expect(updatedChain).toEqual([BrowserEngineType.PlaywrightStealth]);
    setGlobalEngineChain(original);
    const restoredChain = getGlobalEngineChain();
    expect(restoredChain).toEqual(original);
  });
});
