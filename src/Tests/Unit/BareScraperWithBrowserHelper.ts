import { BaseScraperWithBrowser } from '../../Scrapers/Base/BaseScraperWithBrowser';
import type { IScraperScrapingResult, ScraperCredentials } from '../../Scrapers/Base/Interface';

/** Minimal concrete subclass of BaseScraperWithBrowser for testing the login flow only. */
export default class BareScraperWithBrowser extends BaseScraperWithBrowser<ScraperCredentials> {
  private readonly _emptyResult: IScraperScrapingResult = { success: true, accounts: [] };

  /**
   * Returns an empty success result — only login is exercised.
   *
   * @returns a resolved promise with an empty accounts list
   */
  public fetchData(): Promise<IScraperScrapingResult> {
    return Promise.resolve(this._emptyResult);
  }
}
