import { GenericBankScraper } from './GenericBankScraper';
import {
  type ScraperCredentials,
  type ScraperOptions,
  type ScraperScrapingResult,
} from './Interface';
import { type LoginConfig } from './LoginConfig';

/**
 * Concrete subclass of GenericBankScraper for testing or one-off use.
 * `fetchData()` returns an empty success — only the login mechanism is exercised.
 * Use this to verify selector resolution without implementing transaction fetching.
 */
export class ConcreteGenericScraper<
  TCredentials extends ScraperCredentials,
> extends GenericBankScraper<TCredentials> {
  constructor(options: ScraperOptions, loginConfig: LoginConfig) {
    super(options, loginConfig);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async fetchData(): Promise<ScraperScrapingResult> {
    return { success: true, accounts: [] };
  }
}
