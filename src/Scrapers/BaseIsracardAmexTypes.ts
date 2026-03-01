import { type Moment } from 'moment';
import { type Page } from 'playwright';
import { type TransactionsAccount, type Transaction } from '../Transactions';
import { type ScraperOptions } from './Interface';

export type CompanyServiceOptions = {
  servicesUrl: string;
  companyCode: string;
};

export type ScrapedAccountsWithIndex = Record<string, TransactionsAccount & { index: number }>;

export interface ScrapedTransaction {
  dealSumType: string;
  voucherNumberRatzOutbound: string;
  voucherNumberRatz: string;
  moreInfo?: string;
  dealSumOutbound: boolean;
  currencyId: string;
  currentPaymentCurrency: string;
  dealSum: number;
  fullPaymentDate?: string;
  fullPurchaseDate?: string;
  fullPurchaseDateOutbound?: string;
  fullSupplierNameHeb: string;
  fullSupplierNameOutbound: string;
  paymentSum: number;
  paymentSumOutbound: number;
}

export interface ScrapedAccount {
  index: number;
  accountNumber: string;
  processedDate: string;
}

export interface ScrapedLoginValidation {
  Header: { Status: string };
  ValidateIdDataBean?: { userName?: string; returnCode: string };
}

export interface ScrapedAccountsWithinPageResponse {
  Header: { Status: string };
  DashboardMonthBean?: {
    cardsCharges: { cardIndex: string; cardNumber: string; billingDate: string }[];
  };
}

export interface ScrapedCurrentCardTransactions {
  txnIsrael?: ScrapedTransaction[];
  txnAbroad?: ScrapedTransaction[];
}

export interface ScrapedTransactionData {
  Header?: { Status: string };
  PirteyIska_204Bean?: { sector: string };
  CardsTransactionsListBean?: Record<
    string,
    { CurrentCardTransactions: ScrapedCurrentCardTransactions[] }
  >;
}

export interface CollectTxnsOpts {
  txnGroups: ScrapedCurrentCardTransactions[];
  account: ScrapedAccount;
  options: ScraperOptions;
  startMoment: Moment;
}

export interface FetchTransactionsOpts {
  page: Page;
  options: ScraperOptions;
  companyServiceOptions: CompanyServiceOptions;
  startMoment: Moment;
  monthMoment: Moment;
}

export interface BuildTxnsOpts {
  accounts: ScrapedAccount[];
  dataResult: ScrapedTransactionData;
  options: ScraperOptions;
  startMoment: Moment;
}

export interface ExtraScrapTxnOpts {
  page: Page;
  options: CompanyServiceOptions;
  month: Moment;
  accountIndex: number;
  transaction: Transaction;
}

export interface ExtraScrapAccountOpts {
  page: Page;
  options: CompanyServiceOptions;
  accountMap: ScrapedAccountsWithIndex;
  month: Moment;
}

export interface AdditionalInfoOpts {
  scraperOptions: ScraperOptions;
  accountsWithIndex: ScrapedAccountsWithIndex[];
  page: Page;
  options: CompanyServiceOptions;
  allMonths: Moment[];
}

export interface FetchAllOpts {
  page: Page;
  options: ScraperOptions;
  companyServiceOptions: CompanyServiceOptions;
  startMoment: Moment;
}
