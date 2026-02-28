import moment from 'moment';
import { getDebug } from '../helpers/debug';
import { fetchPostWithinPage } from '../helpers/fetch';
import { getRawTransaction } from '../helpers/transactions';
import { type Transaction, TransactionStatuses, TransactionTypes } from '../transactions';
import { type ScraperOptions, type ScraperScrapingResult } from './interface';
import { CompanyTypes } from '../definitions';
import { BANK_REGISTRY } from './bank-registry';
import { GenericBankScraper } from './generic-bank-scraper';

const PURCHASE_HISTORY_URL = 'https://back.behatsdaa.org.il/api/purchases/purchaseHistory';

const debug = getDebug('behatsdaa');

type ScraperSpecificCredentials = { id: string; password: string };

type Variant = {
  name: string;
  variantName: string;
  customerPrice: number;
  orderDate: string; // ISO timestamp with no timezone
  tTransactionID: string;
};

type PurchaseHistoryResponse = {
  data?: {
    errorDescription?: string;
    memberId: string;
    variants: Variant[];
  };
  errorDescription?: string;
};

function variantToTransaction(variant: Variant, options?: ScraperOptions): Transaction {
  // The price is positive, make it negative as it's an expense
  const originalAmount = -variant.customerPrice;
  const result: Transaction = {
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

class BehatsdaaScraper extends GenericBankScraper<ScraperSpecificCredentials> {
  constructor(options: ScraperOptions) {
    super(options, BANK_REGISTRY[CompanyTypes.behatsdaa]!);
  }

  private async fetchWithToken(token: string): Promise<PurchaseHistoryResponse | null> {
    const body = {
      FromDate: moment(this.options.startDate).format('YYYY-MM-DDTHH:mm:ss'),
      ToDate: moment().format('YYYY-MM-DDTHH:mm:ss'),
      BenefitStatusId: null,
    };
    debug('Fetching data');
    return fetchPostWithinPage<PurchaseHistoryResponse>(this.page, PURCHASE_HISTORY_URL, {
      data: body,
      extraHeaders: { authorization: `Bearer ${token}`, 'Content-Type': 'application/json', organizationid: '20' },
    });
  }

  private buildAccountResult(res: NonNullable<PurchaseHistoryResponse>): ScraperScrapingResult {
    if (res?.errorDescription || res?.data?.errorDescription) {
      debug('Error fetching data', res.errorDescription || res.data?.errorDescription);
      return { success: false, errorMessage: res.errorDescription };
    }
    if (!res?.data) {
      debug('No data found');
      return { success: false, errorMessage: 'NoData' };
    }
    debug('Data fetched successfully');
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

  async fetchData(): Promise<ScraperScrapingResult> {
    const token = await this.page.evaluate(() => window.localStorage.getItem('userToken'));
    if (!token) {
      debug('Token not found in local storage');
      return { success: false, errorMessage: 'TokenNotFound' };
    }
    const res = await this.fetchWithToken(token);
    debug('Data fetched');
    return this.buildAccountResult(res ?? {});
  }
}

export default BehatsdaaScraper;
