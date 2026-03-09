import moment from 'moment';

import { getDebug } from '../../Common/Debug.js';
import { fetchPostWithinPage } from '../../Common/Fetch.js';
import { getRawTransaction } from '../../Common/Transactions.js';
import { CompanyTypes } from '../../Definitions.js';
import { type ITransaction, TransactionStatuses, TransactionTypes } from '../../Transactions.js';
import GenericBankScraper from '../Base/GenericBankScraper.js';
import { type IScraperScrapingResult, type ScraperOptions } from '../Base/Interface.js';
import type { Nullable } from '../Base/Interfaces/CallbackTypes.js';
import { SCRAPER_CONFIGURATION } from '../Registry/ScraperConfig.js';
import { BEHATSDAA_CONFIG } from './BehatsdaaLoginConfig.js';

const CFG = SCRAPER_CONFIGURATION.banks[CompanyTypes.Behatsdaa];

const LOG = getDebug('behatsdaa');

interface IScraperSpecificCredentials {
  id: string;
  password: string;
}

interface IPurchaseVariant {
  name: string;
  variantName: string;
  customerPrice: number;
  orderDate: string; // ISO timestamp with no timezone
  tTransactionID: string;
}

interface IPurchaseHistoryResponse {
  data?: {
    errorDescription?: string;
    memberId: string;
    variants: IPurchaseVariant[];
  };
  errorDescription?: string;
}

/**
 * Convert a Behatsdaa purchase variant into a standard transaction.
 * @param variant - The raw purchase variant from the API.
 * @param options - Optional scraper options for raw transaction inclusion.
 * @returns A normalised transaction object.
 */
function variantToTransaction(variant: IPurchaseVariant, options?: ScraperOptions): ITransaction {
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

/** Scraper for the Behatsdaa (בהצדעה) benefit program portal. */
class BehatsdaaScraper extends GenericBankScraper<IScraperSpecificCredentials> {
  /**
   * Create a new Behatsdaa scraper instance.
   * @param options - Scraper configuration options.
   */
  constructor(options: ScraperOptions) {
    super(options, BEHATSDAA_CONFIG);
  }

  /**
   * Fetch transaction data from the Behatsdaa API.
   * @returns Scraping result with accounts and transactions.
   */
  public async fetchData(): Promise<IScraperScrapingResult> {
    const token = await this.page.evaluate(() => window.localStorage.getItem('userToken'));
    if (!token) {
      LOG.debug('Token not found in local storage');
      return { success: false, errorMessage: 'TokenNotFound' };
    }
    const res = await this.fetchWithToken(token);
    LOG.debug('Data fetched');
    if (!res) return { success: false, errorMessage: 'EmptyResponse' };
    return this.buildAccountResult(res);
  }

  /**
   * Post to the purchase history API with the given bearer token.
   * @param token - The bearer token from local storage.
   * @returns The purchase history response (empty object on parse failure).
   */
  private async fetchWithToken(token: string): Promise<Nullable<IPurchaseHistoryResponse>> {
    const body = {
      FromDate: moment(this.options.startDate).format('YYYY-MM-DDTHH:mm:ss'),
      ToDate: moment().format('YYYY-MM-DDTHH:mm:ss'),
      BenefitStatusId: null,
    };
    LOG.debug('Fetching data');
    return fetchPostWithinPage<IPurchaseHistoryResponse>(this.page, CFG.api.purchaseHistory, {
      data: body,
      extraHeaders: {
        authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        organizationid: CFG.auth.organizationId,
      },
    });
  }

  /**
   * Transform the API response into a standard scraping result.
   * @param res - The purchase history response from the API.
   * @returns A scraping result with success flag and account data.
   */
  private buildAccountResult(res: IPurchaseHistoryResponse): IScraperScrapingResult {
    if (res.errorDescription || res.data?.errorDescription) {
      LOG.debug('Error fetching data: %s', res.errorDescription ?? res.data?.errorDescription);
      return { success: false, errorMessage: res.errorDescription };
    }
    if (!res.data) {
      LOG.debug('No data found');
      return { success: false, errorMessage: 'NoData' };
    }
    LOG.debug('Data fetched successfully');
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
