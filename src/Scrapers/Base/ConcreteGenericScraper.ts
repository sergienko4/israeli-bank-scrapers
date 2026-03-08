import { GenericBankScraper } from './GenericBankScraper.js';
import { type ScraperCredentials, type ScraperScrapingResult } from './Interface.js';

/**
 * Concrete subclass of GenericBankScraper for testing or one-off use.
 * `fetchData()` returns an empty success — only the login mechanism is exercised.
 * Use this to verify selector resolution without implementing transaction fetching.
 */
export class ConcreteGenericScraper<
  TCredentials extends ScraperCredentials,
> extends GenericBankScraper<TCredentials> {
  // eslint-disable-next-line @typescript-eslint/require-await
  public async fetchData(): Promise<ScraperScrapingResult> {
    return { success: true, accounts: [] };
  }
}
