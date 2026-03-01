import moment from 'moment';
import { getDebug } from '../Helpers/Debug';
import { fetchPostWithinPage } from '../Helpers/Fetch';
import { getRawTransaction } from '../Helpers/Transactions';
import { type Transaction, TransactionStatuses, TransactionTypes } from '../Transactions';
import { type ScraperOptions, type ScraperScrapingResult } from './Interface';
import { CompanyTypes } from '../Definitions';
import { BANK_REGISTRY } from './BankRegistry';
import { GenericBankScraper } from './GenericBankScraper';

const PURCHASE_HISTORY_URL = 'https://back.behatsdaa.org.il/api/purchases/purchaseHistory';

const DEBUG = getDebug('behatsdaa');

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
    super(options, BANK_REGISTRY[CompanyTypes.Behatsdaa]!);
  }

  async fetchData(): Promise<ScraperScrapingResult> {
    const token = await this.page.evaluate(() => window.localStorage.getItem('userToken'));
    if (!token) {
      DEBUG('Token not found in local storage');
      return { success: false, errorMessage: 'TokenNotFound' };
    }
    const res = await this.fetchWithToken(token);
    DEBUG('Data fetched');
    return this.buildAccountResult(res ?? {});
  }

  private async fetchWithToken(token: string): Promise<PurchaseHistoryResponse | null> {
    const body = {
      FromDate: moment(this.options.startDate).format('YYYY-MM-DDTHH:mm:ss'),
      ToDate: moment().format('YYYY-MM-DDTHH:mm:ss'),
      BenefitStatusId: null,
    };
    DEBUG('Fetching data');
    return fetchPostWithinPage<PurchaseHistoryResponse>(this.page, PURCHASE_HISTORY_URL, {
      data: body,
      extraHeaders: {
        authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        organizationid: '20',
      },
    });
  }

  private buildAccountResult(res: NonNullable<PurchaseHistoryResponse>): ScraperScrapingResult {
    if (res?.errorDescription || res?.data?.errorDescription) {
      DEBUG('Error fetching data', res.errorDescription || res.data?.errorDescription);
      return { success: false, errorMessage: res.errorDescription };
    }
    if (!res?.data) {
      DEBUG('No data found');
      return { success: false, errorMessage: 'NoData' };
    }
    DEBUG('Data fetched successfully');
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
