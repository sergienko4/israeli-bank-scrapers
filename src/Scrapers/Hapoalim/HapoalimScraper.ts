import { getDebug } from '../../Common/Debug.js';
import GenericBankScraper from '../Base/GenericBankScraper.js';
import { type ScraperOptions } from '../Base/Interface.js';
import { HAPOALIM_CONFIG } from './Config/HapoalimLoginConfig.js';
import {
  buildDateOpts,
  fetchOneAccount,
  fetchOpenAccounts,
  getContext,
  type IAccountResult,
} from './HapoalimHelpers.js';

const LOG = getDebug('hapoalim');

/** Hapoalim-specific login credentials. */
interface IScraperSpecificCredentials {
  userCode: string;
  password: string;
}

/** Hapoalim fetch-all result shape. */
interface IFetchAllResult {
  success: boolean;
  accounts: IAccountResult[];
}

/** Hapoalim bank scraper implementation. */
class HapoalimScraper extends GenericBankScraper<IScraperSpecificCredentials> {
  /**
   * Create a new HapoalimScraper instance.
   * @param options - Scraper configuration options.
   */
  constructor(options: ScraperOptions) {
    super(options, HAPOALIM_CONFIG);
  }

  /**
   * Fetch all account data from Hapoalim.
   * @returns Result with accounts, balances, and transactions.
   */
  public async fetchData(): Promise<IFetchAllResult> {
    const baseUrl = HAPOALIM_CONFIG.loginUrl;
    const ctx = await this.buildFetchContext(baseUrl);
    return this.fetchAllAccountsWith(ctx.apiSiteUrl, baseUrl);
  }

  /**
   * Build context needed for API calls.
   * @param baseUrl - The base URL.
   * @returns The API site URL and base URL.
   */
  private async buildFetchContext(baseUrl: string): Promise<{ apiSiteUrl: string }> {
    const restContext = await getContext(this.page);
    return { apiSiteUrl: `${baseUrl}/${restContext}` };
  }

  /**
   * Fetch all open accounts with transactions and balances.
   * @param apiSiteUrl - The full API URL with context.
   * @param baseUrl - The base URL.
   * @returns Success status and account results.
   */
  private async fetchAllAccountsWith(
    apiSiteUrl: string,
    baseUrl: string,
  ): Promise<IFetchAllResult> {
    const openAccounts = await fetchOpenAccounts(this.page, baseUrl);
    const dateOpts = buildDateOpts(this.options);
    const promises = openAccounts.map(acc =>
      fetchOneAccount({
        page: this.page,
        baseUrl,
        apiSiteUrl,
        account: acc,
        dateOpts,
        options: this.options,
      }),
    );
    const accounts = await Promise.all(promises);
    LOG.debug('fetching ended');
    return { success: true, accounts };
  }
}

export default HapoalimScraper;
