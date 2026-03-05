import { BaseScraperWithBrowser } from '../../Scrapers/Base/BaseScraperWithBrowser';
import type { ScraperCredentials, ScraperScrapingResult } from '../../Scrapers/Base/Interface';

export default class BareScraperWithBrowser extends BaseScraperWithBrowser<ScraperCredentials> {
  private readonly _emptyResult: ScraperScrapingResult = { success: true, accounts: [] };

  // eslint-disable-next-line @typescript-eslint/require-await
  public async fetchData(): Promise<ScraperScrapingResult> {
    return this._emptyResult;
  }
}
