import { TimeoutError } from '../../Common/Waiting';
import { ScraperProgressTypes } from '../../Definitions';
import { BaseScraper } from '../../Scrapers/Base/BaseScraper';
import { ScraperErrorTypes } from '../../Scrapers/Base/Errors';
import type {
  ScraperCredentials,
  ScraperLoginResult,
  ScraperScrapingResult,
} from '../../Scrapers/Base/Interface';
import { createMockScraperOptions } from '../MockPage';

class TestScraper extends BaseScraper<ScraperCredentials> {
  loginResult: ScraperLoginResult = { success: true };

  fetchResult: ScraperScrapingResult = { success: true, accounts: [] };

  loginError: Error | null = null;

  fetchError: Error | null = null;

  terminateError: Error | null = null;

  terminated = false;

  // eslint-disable-next-line @typescript-eslint/require-await
  protected async login(): Promise<ScraperLoginResult> {
    if (this.loginError) throw this.loginError;
    return this.loginResult;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  protected async fetchData(): Promise<ScraperScrapingResult> {
    if (this.fetchError) throw this.fetchError;
    return this.fetchResult;
  }

  protected async terminate(success: boolean): Promise<void> {
    this.terminated = true;
    if (this.terminateError) throw this.terminateError;
    await super.terminate(success);
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
      const events: ScraperProgressTypes[] = [];
      scraper.onProgress((_companyId, payload) => {
        events.push(payload.type);
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
      expect(() => scraper.triggerTwoFactorAuth('0541234567')).toThrow('triggerOtp()');
    });

    it('getLongTermTwoFactorToken throws not implemented', () => {
      const scraper = new TestScraper(createMockScraperOptions());
      expect(() => scraper.getLongTermTwoFactorToken('123456')).toThrow('getPermanentOtpToken()');
    });
  });
});
