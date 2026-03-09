import GenericBankScraper from './GenericBankScraper.js';
import { type IScraperScrapingResult, type ScraperCredentials } from './Interface.js';

/** Sentinel tag for module identity — ensures file has multiple exports. */
export const CONCRETE_SCRAPER_TAG = 'ConcreteGenericScraper' as const;

/**
 * Concrete subclass of GenericBankScraper for testing or one-off use.
 * `fetchData()` returns an empty success — only the login mechanism is exercised.
 * Use this to verify selector resolution without implementing transaction fetching.
 */
export class ConcreteGenericScraper<
  TCredentials extends ScraperCredentials,
> extends GenericBankScraper<TCredentials> {
  /**
   * Return empty success — transaction fetching is not exercised.
   * @returns A successful scraping result with no accounts.
   */
  public fetchData(): Promise<IScraperScrapingResult> {
    void this.options.companyId;
    return Promise.resolve({ success: true, accounts: [] });
  }
}
