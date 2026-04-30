import { TimeoutError } from '../../Common/Waiting.js';
import { ScraperProgressTypes } from '../../Definitions.js';
import BaseScraper from '../../Scrapers/Base/BaseScraper.js';
import { ScraperErrorTypes } from '../../Scrapers/Base/Errors.js';
import type {
  IScraperLoginResult,
  IScraperScrapingResult,
  ScraperCredentials,
} from '../../Scrapers/Base/Interface.js';
import { createMockScraperOptions } from '../MockPage.js';

/** Test scraper subclass that exposes configurable login/fetch behavior. */
class TestScraper extends BaseScraper<ScraperCredentials> {
  public loginResult: IScraperLoginResult = { success: true };

  public fetchResult: IScraperScrapingResult = { success: true, accounts: [] };

  public loginError: Error | null = null;

  public fetchError: Error | null = null;

  public terminateError: Error | null = null;

  public terminated = false;

  /**
   * Simulates login with configurable result or error.
   * @returns the configured login result
   */
  protected override async login(): Promise<IScraperLoginResult> {
    if (this.loginError) throw this.loginError;
    return Promise.resolve(this.loginResult);
  }

  /**
   * Simulates data fetching with configurable result or error.
   * @returns the configured scraping result
   */
  protected override async fetchData(): Promise<IScraperScrapingResult> {
    if (this.fetchError) throw this.fetchError;
    return Promise.resolve(this.fetchResult);
  }

  /**
   * Simulates termination with configurable error.
   * @param success - whether the scrape was successful
   * @returns true when termination completes
   */
  protected override async terminate(success: boolean): Promise<boolean> {
    this.terminated = true;
    if (this.terminateError) throw this.terminateError;
    await super.terminate(success);
    return true;
  }
}

describe('BaseScraper', () => {
  describe('scrape lifecycle', () => {
    it('returns scrape result on successful login and fetch', async () => {
      const scraper = new TestScraper(createMockScraperOptions());
      const result = await scraper.scrape({ userCode: 'test', password: 'test' });
      expect(result.success).toBe(true);
      expect(result.accounts).toEqual([]);
    });

    it('returns login error when login fails', async () => {
      const scraper = new TestScraper(createMockScraperOptions());
      scraper.loginResult = {
        success: false,
        errorType: ScraperErrorTypes.InvalidPassword,
        errorMessage: 'wrong password',
      };
      const result = await scraper.scrape({ userCode: 'test', password: 'test' });
      expect(result.success).toBe(false);
      expect(result.errorType).toBe(ScraperErrorTypes.InvalidPassword);
    });

    it('handles login throw with generic error', async () => {
      const scraper = new TestScraper(createMockScraperOptions());
      scraper.loginError = new Error('network failure');
      const result = await scraper.scrape({ userCode: 'test', password: 'test' });
      expect(result.success).toBe(false);
      expect(result.errorType).toBe(ScraperErrorTypes.Generic);
      expect(result.errorMessage).toBe('network failure');
    });

    it('handles login throw with timeout error', async () => {
      const scraper = new TestScraper(createMockScraperOptions());
      scraper.loginError = new TimeoutError('login timed out');
      const result = await scraper.scrape({ userCode: 'test', password: 'test' });
      expect(result.success).toBe(false);
      expect(result.errorType).toBe(ScraperErrorTypes.Timeout);
    });

    it('handles fetchData throw with generic error', async () => {
      const scraper = new TestScraper(createMockScraperOptions());
      scraper.fetchError = new Error('parse failure');
      const result = await scraper.scrape({ userCode: 'test', password: 'test' });
      expect(result.success).toBe(false);
      expect(result.errorType).toBe(ScraperErrorTypes.Generic);
    });

    it('handles fetchData throw with timeout error', async () => {
      const scraper = new TestScraper(createMockScraperOptions());
      scraper.fetchError = new TimeoutError('fetch timed out');
      const result = await scraper.scrape({ userCode: 'test', password: 'test' });
      expect(result.success).toBe(false);
      expect(result.errorType).toBe(ScraperErrorTypes.Timeout);
    });

    it('handles terminate throw with generic error', async () => {
      const scraper = new TestScraper(createMockScraperOptions());
      scraper.terminateError = new Error('cleanup failed');
      const result = await scraper.scrape({ userCode: 'test', password: 'test' });
      expect(result.success).toBe(false);
      expect(result.errorType).toBe(ScraperErrorTypes.Generic);
    });

    it('calls terminate after scrape', async () => {
      const scraper = new TestScraper(createMockScraperOptions());
      await scraper.scrape({ userCode: 'test', password: 'test' });
      expect(scraper.terminated).toBe(true);
    });

    it('does not fetch data when login fails', async () => {
      const scraper = new TestScraper(createMockScraperOptions());
      scraper.loginResult = {
        success: false,
        errorType: ScraperErrorTypes.InvalidPassword,
        errorMessage: 'bad',
      };
      scraper.fetchResult = {
        success: true,
        accounts: [{ accountNumber: '123', txns: [], balance: 0 }],
      };
      const result = await scraper.scrape({ userCode: 'test', password: 'test' });
      expect(result.success).toBe(false);
      expect(result.accounts).toBeUndefined();
    });
  });

  describe('progress events', () => {
    it('emits StartScraping and EndScraping events', async () => {
      const scraper = new TestScraper(createMockScraperOptions());
      const events: string[] = [];
      scraper.onProgress((_companyId, payload) => {
        events.push(payload.type);
        return true;
      });
      await scraper.scrape({ userCode: 'test', password: 'test' });
      expect(events).toContain(ScraperProgressTypes.StartScraping);
      expect(events).toContain(ScraperProgressTypes.Initializing);
      expect(events).toContain(ScraperProgressTypes.Terminating);
      expect(events).toContain(ScraperProgressTypes.EndScraping);
    });
  });

  describe('2FA methods', () => {
    it('triggerTwoFactorAuth throws not implemented', () => {
      const scraper = new TestScraper(createMockScraperOptions());
      expect(() => scraper.triggerTwoFactorAuth('0542893067')).toThrow('triggerOtp(');
    });

    it('getLongTermTwoFactorToken throws not implemented', () => {
      const scraper = new TestScraper(createMockScraperOptions());
      expect(() => scraper.getLongTermTwoFactorToken('123456')).toThrow('getPermanentOtpToken(');
    });
  });
});
