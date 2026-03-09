import { type ITransaction } from '../../Transactions.js';
import type { ILoginOptions } from '../Base/BaseScraperWithBrowser.js';
import GenericBankScraper from '../Base/GenericBankScraper.js';
import { type ScraperOptions } from '../Base/Interface.js';
import { fetchTransactions } from './MaxHelpers.js';
import { MAX_CONFIG, maxHandleSecondLoginStep } from './MaxLoginConfig.js';

export { getMemo } from './MaxHelpers.js';
export type { IScrapedTransaction } from './MaxTypes.js';

/**
 * Max has two login flows:
 *  - Flow A (common):     home -> username+password -> dashboard
 *  - Flow B (occasional): home -> username+password -> 2nd form -> dashboard
 * Provide `id` (Israeli national ID) so Flow B is handled.
 */
interface IScraperSpecificCredentials {
  /** Max account username. */
  username: string;
  /** Max account password. */
  password: string;
  /** Israeli national ID for second login step. */
  id?: string;
}

/** Max bank scraper implementation. */
class MaxScraper extends GenericBankScraper<IScraperSpecificCredentials> {
  /**
   * Create a new MaxScraper instance.
   * @param options - Scraper configuration options.
   */
  constructor(options: ScraperOptions) {
    super(options, MAX_CONFIG);
  }

  /**
   * Build login options with second login step handler.
   * @param credentials - Max account credentials.
   * @returns Login options with second step handler.
   */
  public override getLoginOptions(credentials: IScraperSpecificCredentials): ILoginOptions {
    const opts = super.getLoginOptions(credentials);
    const original = opts.postAction;
    return {
      ...opts,
      /**
       * Handle Max second login step then call original.
       * @returns True after handling second step.
       */
      postAction: async (): Promise<boolean> => {
        await maxHandleSecondLoginStep(this.page, credentials);
        if (original) await original();
        return true;
      },
    };
  }

  /**
   * Fetch transaction data from Max API.
   * @returns Result with accounts and their transactions.
   */
  public async fetchData(): Promise<{
    success: boolean;
    accounts: { accountNumber: string; txns: ITransaction[] }[];
  }> {
    const results = await fetchTransactions(this.page, this.options);
    const accounts = Object.keys(results).map(accountNumber => ({
      accountNumber,
      txns: results[accountNumber],
    }));
    return { success: true, accounts };
  }
}

export default MaxScraper;
