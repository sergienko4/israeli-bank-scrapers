/**
 * Additional branch coverage tests for BaseScraper.ts.
 * Targets: extractErrorMessage (string input), categorizeError (WafBlockError),
 * buildDiagnostics (fetchStartMs present/absent), doFetchData persistentOtpToken propagation,
 * logResultSummary with success result.
 */
import { TimeoutError } from '../../Common/Waiting.js';
import BaseScraper from '../../Scrapers/Base/BaseScraper.js';
import { ScraperErrorTypes, WafBlockError } from '../../Scrapers/Base/Errors.js';
import type {
  IScraperLoginResult,
  IScraperScrapingResult,
  ScraperCredentials,
} from '../../Scrapers/Base/Interface.js';
import { createMockScraperOptions } from '../MockPage.js';

/** Test scraper with configurable behavior. */
class TestScraper extends BaseScraper<ScraperCredentials> {
  public loginResult: IScraperLoginResult = { success: true };
  public fetchResult: IScraperScrapingResult = { success: true, accounts: [] };
  public loginError: Error | string | null = null;
  public fetchError: Error | null = null;
  public terminateError: Error | null = null;

  /**
   * Simulates login with configurable result or error.
   * @returns the configured login result.
   */
  protected override async login(): Promise<IScraperLoginResult> {
    if (this.loginError !== null) {
      if (typeof this.loginError === 'string') throw new TypeError(this.loginError);
      throw this.loginError;
    }
    return Promise.resolve(this.loginResult);
  }

  /**
   * Simulates data fetching with configurable result or error.
   * @returns the configured scraping result.
   */
  protected override async fetchData(): Promise<IScraperScrapingResult> {
    if (this.fetchError) throw this.fetchError;
    return Promise.resolve(this.fetchResult);
  }

  /**
   * Simulates termination.
   * @param success - whether scrape was successful.
   * @returns true.
   */
  protected override async terminate(success: boolean): Promise<boolean> {
    if (this.terminateError) throw this.terminateError;
    await super.terminate(success);
    return true;
  }
}

describe('BaseScraper additional branches', () => {
  describe('categorizeError — WafBlockError', () => {
    it('returns WafBlocked error type for WafBlockError', async () => {
      const scraper = new TestScraper(createMockScraperOptions());
      scraper.loginError = WafBlockError.cloudflareBlock(503, 'Attention', 'https://bank.co.il');
      const result = await scraper.scrape({ userCode: 'u', password: 'p' });
      expect(result.success).toBe(false);
      expect(result.errorType).toBe(ScraperErrorTypes.WafBlocked);
    });
  });

  describe('categorizeError — string error', () => {
    it('extracts message from string error in login', async () => {
      const scraper = new TestScraper(createMockScraperOptions());
      scraper.loginError = 'plain string error';
      const result = await scraper.scrape({ userCode: 'u', password: 'p' });
      expect(result.success).toBe(false);
      expect(result.errorType).toBe(ScraperErrorTypes.Generic);
    });
  });

  describe('doFetchData — persistentOtpToken propagation', () => {
    it('propagates persistentOtpToken from login to fetch result', async () => {
      const scraper = new TestScraper(createMockScraperOptions());
      const tokenResult = { success: true, persistentOtpToken: 'tok123' };
      scraper.loginResult = tokenResult as IScraperLoginResult;
      scraper.fetchResult = { success: true, accounts: [] };
      const result = await scraper.scrape({ userCode: 'u', password: 'p' });
      expect(result.success).toBe(true);
      expect(result.persistentOtpToken).toBe('tok123');
    });

    it('does not add token when login has no persistentOtpToken', async () => {
      const scraper = new TestScraper(createMockScraperOptions());
      scraper.fetchResult = { success: true, accounts: [] };
      const result = await scraper.scrape({ userCode: 'u', password: 'p' });
      expect(result.persistentOtpToken).toBeUndefined();
    });
  });

  describe('doFetchData — fetch error with WafBlockError', () => {
    it('returns WafBlocked on fetch WafBlockError', async () => {
      const scraper = new TestScraper(createMockScraperOptions());
      scraper.fetchError = WafBlockError.apiBlock(429, 'https://api.bank.co.il');
      const result = await scraper.scrape({ userCode: 'u', password: 'p' });
      expect(result.success).toBe(false);
      expect(result.errorType).toBe(ScraperErrorTypes.WafBlocked);
    });
  });

  describe('doFetchData — fetch error with TimeoutError', () => {
    it('returns Timeout on fetch TimeoutError', async () => {
      const scraper = new TestScraper(createMockScraperOptions());
      scraper.fetchError = new TimeoutError('data fetch timed out');
      const result = await scraper.scrape({ userCode: 'u', password: 'p' });
      expect(result.success).toBe(false);
      expect(result.errorType).toBe(ScraperErrorTypes.Timeout);
    });
  });

  describe('logResultSummary — success and failure formatting', () => {
    it('logs success summary with accounts', async () => {
      const scraper = new TestScraper(createMockScraperOptions());
      scraper.fetchResult = {
        success: true,
        accounts: [{ accountNumber: '1234567', txns: [], balance: 1000 }],
      };
      const result = await scraper.scrape({ userCode: 'u', password: 'p' });
      expect(result.success).toBe(true);
    });

    it('logs failure summary on failed login', async () => {
      const scraper = new TestScraper(createMockScraperOptions());
      scraper.loginResult = {
        success: false,
        errorType: ScraperErrorTypes.InvalidPassword,
        errorMessage: 'bad password',
      };
      const result = await scraper.scrape({ userCode: 'u', password: 'p' });
      expect(result.success).toBe(false);
    });
  });

  describe('buildDiagnostics — timing branches', () => {
    it('includes diagnostics on login error', async () => {
      const scraper = new TestScraper(createMockScraperOptions());
      scraper.loginError = new Error('login failed');
      const result = await scraper.scrape({ userCode: 'u', password: 'p' });
      expect(result.diagnostics).toBeDefined();
      expect(result.diagnostics?.loginDurationMs).toBeGreaterThanOrEqual(0);
    });

    it('includes diagnostics on fetch error', async () => {
      const scraper = new TestScraper(createMockScraperOptions());
      scraper.fetchError = new Error('fetch failed');
      const result = await scraper.scrape({ userCode: 'u', password: 'p' });
      expect(result.diagnostics).toBeDefined();
      expect(result.diagnostics?.fetchDurationMs).toBeGreaterThanOrEqual(0);
    });
  });
});
