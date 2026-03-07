import moment from 'moment';

import { getDebug } from '../../Common/Debug';
import { fetchPostWithinPage } from '../../Common/Fetch';
import { getRawTransaction } from '../../Common/Transactions';
import { CompanyTypes } from '../../Definitions';
import { type ITransaction, TransactionStatuses, TransactionTypes } from '../../Transactions';
import { GenericBankScraper } from '../Base/GenericBankScraper';
import { type IScraperScrapingResult, type ScraperOptions } from '../Base/Interface';
import { SCRAPER_CONFIGURATION } from '../Registry/ScraperConfig';
import { BEHATSDAA_CONFIG } from './BehatsdaaLoginConfig';

const CFG = SCRAPER_CONFIGURATION.banks[CompanyTypes.Behatsdaa];

const LOG = getDebug('behatsdaa');

export interface IBehatsdaaVariant {
  name: string;
  variantName: string;
  customerPrice: number;
  orderDate: string;
  tTransactionID: string;
}
export interface IBehatsdaaPurchaseResponse {
  data?: { errorDescription?: string; memberId: string; variants: IBehatsdaaVariant[] };
  errorDescription?: string;
}

/**
 * Converts a Behatsdaa purchase variant to a normalized ITransaction.
 *
 * @param variant - the raw purchase variant from the Behatsdaa API
 * @param options - scraper options controlling rawTransaction inclusion
 * @returns a normalized ITransaction representing the purchase
 */
function variantToTransaction(variant: IBehatsdaaVariant, options?: ScraperOptions): ITransaction {
  // The price is positive, make it negative as it's an expense
  const originalAmount = -variant.customerPrice;
  const result: ITransaction = {
    type: TransactionTypes.Normal,
    identifier: variant.tTransactionID,
    date: moment(variant.orderDate).format('YYYY-MM-DD'),
    processedDate: moment(variant.orderDate).format('YYYY-MM-DD'),
    originalAmount,
    originalCurrency: 'ILS',
    chargedAmount: originalAmount,
    chargedCurrency: 'ILS',
    description: variant.name,
    status: TransactionStatuses.Completed,
    memo: variant.variantName,
  };

  if (options?.includeRawTransaction) {
    result.rawTransaction = getRawTransaction(variant);
  }

  return result;
}

/** IScraper for the Behatsdaa employee benefits portal. */
class BehatsdaaScraper extends GenericBankScraper<{ id: string; password: string }> {
  /**
   * Creates a BehatsdaaScraper with the shared Behatsdaa login configuration.
   *
   * @param options - scraper options including companyId and timeouts
   */
  constructor(options: ScraperOptions) {
    super(options, BEHATSDAA_CONFIG);
  }

  /**
   * Reads the auth token from localStorage and fetches purchase history.
   *
   * @returns a scraping result with purchase transactions or an error
   */
  public async fetchData(): Promise<IScraperScrapingResult> {
    const token = await this.page.evaluate(() => window.localStorage.getItem('userToken'));
    if (!token) {
      LOG.info('Token not found in local storage');
      return { success: false, errorMessage: 'TokenNotFound' };
    }
    const res = await this.fetchWithToken(token);
    LOG.info('Data fetched');
    return this.buildAccountResult(res);
  }

  /**
   * Builds the request body for the purchase history API.
   *
   * @returns the POST body with date range and benefit status
   */
  private buildPurchaseBody(): Record<string, string> {
    return {
      FromDate: moment(this.options.startDate).format('YYYY-MM-DDTHH:mm:ss'),
      ToDate: moment().format('YYYY-MM-DDTHH:mm:ss'),
      BenefitStatusId: '',
    };
  }

  /**
   * Fetches purchase history from the API using a Bearer token.
   *
   * @param token - the JWT token from localStorage
   * @returns the API response or an empty object if the request failed
   */
  private async fetchWithToken(token: string): Promise<IBehatsdaaPurchaseResponse> {
    LOG.info('Fetching data');
    const raw = await fetchPostWithinPage<IBehatsdaaPurchaseResponse>(
      this.page,
      CFG.api.purchaseHistory,
      {
        data: this.buildPurchaseBody(),
        extraHeaders: {
          authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          organizationid: CFG.auth.organizationId,
        },
      },
    );
    return raw.isFound ? raw.value : ({} as IBehatsdaaPurchaseResponse);
  }

  /**
   * Converts the API purchase response to a IScraperScrapingResult with transaction data.
   *
   * @param res - the API response from the Behatsdaa purchase history endpoint
   * @returns a scraping result with account transactions or an error
   */
  private buildAccountResult(res: NonNullable<IBehatsdaaPurchaseResponse>): IScraperScrapingResult {
    if (res.errorDescription || res.data?.errorDescription) {
      LOG.info('Error fetching data: %s', res.errorDescription ?? res.data?.errorDescription);
      return { success: false, errorMessage: res.errorDescription };
    }
    if (!res.data) {
      LOG.info('No data found');
      return { success: false, errorMessage: 'NoData' };
    }
    LOG.info('Data fetched successfully');
    return {
      success: true,
      accounts: [
        {
          accountNumber: res.data.memberId,
          txns: res.data.variants.map(variant => variantToTransaction(variant, this.options)),
        },
      ],
    };
  }
}

export default BehatsdaaScraper;
