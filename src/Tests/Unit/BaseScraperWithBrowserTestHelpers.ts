import {
  BaseScraperWithBrowser,
  LOGIN_RESULTS,
  type LoginOptions,
} from '../../Scrapers/Base/BaseScraperWithBrowser';
import type { ScraperCredentials, ScraperScrapingResult } from '../../Scrapers/Base/Interface';
import { createMockScraperOptions } from '../MockPage';

/**
 * Returns a standard set of LoginOptions for use in browser scraper unit tests.
 *
 * @returns a LoginOptions object with mock bank URLs and credential fields
 */
export function defaultLoginOptions(): LoginOptions {
  return {
    loginUrl: 'https://bank.co.il/login',
    fields: [
      { selector: '#user', value: 'testuser' },
      { selector: '#pass', value: 'testpass' },
    ],
    submitButtonSelector: '#submit',
    possibleResults: {
      [LOGIN_RESULTS.Success]: ['https://bank.co.il/dashboard'],
      [LOGIN_RESULTS.InvalidPassword]: ['https://bank.co.il/login?error=1'],
      [LOGIN_RESULTS.ChangePassword]: [/change-password/],
    },
  };
}

/** Concrete browser scraper subclass used in unit tests with configurable login options. */
export default class TestBrowserScraper extends BaseScraperWithBrowser<ScraperCredentials> {
  public loginOpts: LoginOptions = defaultLoginOptions();

  public fetchResult: ScraperScrapingResult = { success: true, accounts: [] };

  /**
   * Returns the configurable login options for this test scraper.
   *
   * @returns the current LoginOptions assigned to loginOpts
   */
  public getLoginOptions(): LoginOptions {
    return this.loginOpts;
  }

  /**
   * Returns the configurable fetch result for this test scraper.
   *
   * @returns a resolved promise with the current fetchResult
   */
  public fetchData(): Promise<ScraperScrapingResult> {
    return Promise.resolve(this.fetchResult);
  }
}

/**
 * Creates a TestBrowserScraper instance with the given scraper option overrides.
 *
 * @param overrides - partial scraper options to override test defaults
 * @returns a configured TestBrowserScraper instance
 */
export function createScraper(
  overrides: Partial<Parameters<typeof createMockScraperOptions>[0]> = {},
): TestBrowserScraper {
  return new TestBrowserScraper(createMockScraperOptions(overrides));
}
