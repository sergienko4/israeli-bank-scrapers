import {
  BaseScraperWithBrowser,
  LOGIN_RESULTS,
  type LoginOptions,
} from '../../Scrapers/Base/BaseScraperWithBrowser';
import type { ScraperCredentials, ScraperScrapingResult } from '../../Scrapers/Base/Interface';
import { createMockScraperOptions } from '../MockPage';

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

export default class TestBrowserScraper extends BaseScraperWithBrowser<ScraperCredentials> {
  public loginOpts: LoginOptions = defaultLoginOptions();

  public fetchResult: ScraperScrapingResult = { success: true, accounts: [] };

  public getLoginOptions(): LoginOptions {
    return this.loginOpts;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  public async fetchData(): Promise<ScraperScrapingResult> {
    return this.fetchResult;
  }
}

export function createScraper(
  overrides: Partial<Parameters<typeof createMockScraperOptions>[0]> = {},
): TestBrowserScraper {
  return new TestBrowserScraper(createMockScraperOptions(overrides));
}
