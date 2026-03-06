import { BaseScraperWithBrowser } from '../../Scrapers/Base/BaseScraperWithBrowser';
import type { ScraperCredentials, ScraperScrapingResult } from '../../Scrapers/Base/Interface';

/** Minimal concrete subclass of BaseScraperWithBrowser for testing the login flow only. */
export default class BareScraperWithBrowser extends BaseScraperWithBrowser<ScraperCredentials> {
  private readonly _emptyResult: ScraperScrapingResult = { success: true, accounts: [] };

  /**
   * Returns an empty success result — only login is exercised.
   *
   * @returns a resolved promise with an empty accounts list
   */
  public fetchData(): Promise<ScraperScrapingResult> {
    return Promise.resolve(this._emptyResult);
  }
}
