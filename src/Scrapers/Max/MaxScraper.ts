import { type ITransaction } from '../../Transactions.js';
import type { ILoginOptions } from '../Base/BaseScraperWithBrowser.js';
import GenericBankScraper from '../Base/GenericBankScraper.js';
import { type ScraperOptions } from '../Base/Interface.js';
import { buildMaxPostAction, type IMaxCredentials, MAX_CONFIG } from './Config/MaxLoginConfig.js';
import { fetchTransactions } from './MaxHelpers.js';

export { getMemo } from './MaxHelpers.js';
export type { IScrapedTransaction } from './MaxTypes.js';

/**
 * Max bank scraper — single login flow with conditional ID verification.
 * After username+password submit, if ID field appears, fills all 3 fields and submits again.
 */
class MaxScraper extends GenericBankScraper<IMaxCredentials> {
  /**
   * Create a new MaxScraper instance.
   * @param options - Scraper configuration options.
   */
  constructor(options: ScraperOptions) {
    super(options, MAX_CONFIG);
  }

  /**
   * Build login options with conditional ID post-action.
   * @param credentials - Max account credentials.
   * @returns Login options with postAction that handles conditional ID.
   */
  public override getLoginOptions(credentials: IMaxCredentials): ILoginOptions {
    const opts = super.getLoginOptions(credentials);
    const postAction = buildMaxPostAction(credentials);
    return {
      ...opts,
      /**
       * Post-action: check for ID form, fill if needed, wait for dashboard.
       * @returns True after post-login completes.
       */
      postAction: async (): Promise<boolean> => {
        await postAction(this.page);
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
