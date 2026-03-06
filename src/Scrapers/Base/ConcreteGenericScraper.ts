import { GenericBankScraper } from './GenericBankScraper';
import { type ScraperCredentials, type ScraperScrapingResult } from './Interface';

/**
 * Concrete subclass of GenericBankScraper for testing or one-off use.
 * `fetchData()` returns an empty success — only the login mechanism is exercised.
 * Use this to verify selector resolution without implementing transaction fetching.
 */
export class ConcreteGenericScraper<
  TCredentials extends ScraperCredentials,
> extends GenericBankScraper<TCredentials> {
  private readonly _emptyResult: ScraperScrapingResult = { success: true, accounts: [] };

  /**
   * Returns an empty success result — only the login mechanism is exercised.
   *
   * @returns a resolved promise with an empty accounts list
   */
  public fetchData(): Promise<ScraperScrapingResult> {
    return Promise.resolve(this._emptyResult);
  }
}

export default ConcreteGenericScraper;
