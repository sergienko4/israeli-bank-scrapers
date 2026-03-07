import moment from 'moment';
import { type Page } from 'playwright';

import { fetchGetWithinPage } from '../../Common/Fetch';
import { getRawTransaction } from '../../Common/Transactions';
import { CompanyTypes } from '../../Definitions';
import { type ITransaction, TransactionStatuses, TransactionTypes } from '../../Transactions';
import { ScraperErrorTypes } from '../Base/Errors';
import { GenericBankScraper } from '../Base/GenericBankScraper';
import { type IScraperScrapingResult, type ScraperOptions } from '../Base/Interface';
import { type ILoginConfig } from '../Base/LoginConfig';
import { SCRAPER_CONFIGURATION } from '../Registry/ScraperConfig';
import { discountConfig } from './DiscountLoginConfig';

const CFG = SCRAPER_CONFIGURATION.banks[CompanyTypes.Discount];

export interface IScrapedTransaction {
  OperationNumber: number;
  OperationDate: string;
  ValueDate: string;
  OperationAmount: number;
  OperationDescriptionToDisplay: string;
}

export interface ICurrentAccountInfo {
  AccountBalance: number;
}

export interface IScrapedAccountData {
  UserAccountsData: {
    DefaultAccountNumber: string;
    UserAccounts: {
      NewAccountInfo: {
        AccountID: string;
      };
    }[];
  };
}

export interface IScrapedTransactionData {
  Error?: { MsgText: string };
  CurrentAccountLastTransactions?: {
    OperationEntry: IScrapedTransaction[] | null;
    ICurrentAccountInfo: ICurrentAccountInfo | null;
    FutureTransactionsBlock: {
      FutureTransactionEntry: IScrapedTransaction[] | null;
    };
  };
}

/**
 * Converts a single scraped Discount Bank transaction to a normalized ITransaction.
 *
 * @param txn - the raw scraped transaction
 * @param txnStatus - whether the transaction is pending or completed
 * @param options - scraper options controlling rawTransaction inclusion
 * @returns a normalized ITransaction object
 */
function convertOneTxn(
  txn: IScrapedTransaction,
  txnStatus: TransactionStatuses,
  options?: ScraperOptions,
): ITransaction {
  const result: ITransaction = {
    type: TransactionTypes.Normal,
    identifier: txn.OperationNumber,
    date: moment(txn.OperationDate, CFG.format.date).toISOString(),
    processedDate: moment(txn.ValueDate, CFG.format.date).toISOString(),
    originalAmount: txn.OperationAmount,
    originalCurrency: 'ILS',
    chargedAmount: txn.OperationAmount,
    description: txn.OperationDescriptionToDisplay,
    status: txnStatus,
  };
  if (options?.includeRawTransaction) result.rawTransaction = getRawTransaction(txn);
  return result;
}

/**
 * Converts an array of scraped transactions to normalized ITransaction objects.
 *
 * @param txns - the raw scraped transactions
 * @param txnStatus - whether the transactions are pending or completed
 * @param options - scraper options controlling rawTransaction inclusion
 * @returns an array of normalized ITransaction objects
 */
function convertTransactions(
  txns: IScrapedTransaction[],
  txnStatus: TransactionStatuses,
  options?: ScraperOptions,
): ITransaction[] {
  return txns.map(txn => convertOneTxn(txn, txnStatus, options));
}

export interface IFetchOneAccountOpts {
  page: Page;
  apiSiteUrl: string;
  accountNumber: string;
  startDateStr: string;
  options: ScraperOptions;
}

/**
 * Extracts pending (future) transactions from the API response.
 *
 * @param txnsResult - the full API transaction response
 * @param options - scraper options controlling rawTransaction inclusion
 * @returns an array of pending transactions
 */
function getPendingTxns(
  txnsResult: IScrapedTransactionData,
  options: ScraperOptions,
): ITransaction[] {
  const rawFutureTxns =
    txnsResult.CurrentAccountLastTransactions?.FutureTransactionsBlock.FutureTransactionEntry;
  if (!rawFutureTxns) return [];
  return convertTransactions(rawFutureTxns, TransactionStatuses.Pending, options);
}

/**
 * Builds a single account result with balance and combined transactions from the API data.
 *
 * @param txnsResult - the full API transaction response for one account
 * @param accountNumber - the account number this result belongs to
 * @param options - scraper options controlling rawTransaction inclusion
 * @returns the account data with balance and transactions
 */
function buildOneAccountResult(
  txnsResult: IScrapedTransactionData,
  accountNumber: string,
  options: ScraperOptions,
): { accountNumber: string; balance: number; txns: ITransaction[] } {
  const data = txnsResult.CurrentAccountLastTransactions ?? {
    OperationEntry: [],
    ICurrentAccountInfo: { AccountBalance: 0 },
  };
  const completedTxns = data.OperationEntry
    ? convertTransactions(data.OperationEntry, TransactionStatuses.Completed, options)
    : [];
  return {
    accountNumber,
    balance: data.ICurrentAccountInfo?.AccountBalance ?? 0,
    txns: [...completedTxns, ...getPendingTxns(txnsResult, options)],
  };
}

/**
 * Fetches transaction data for a single account via the Discount API.
 *
 * @param opts - options with page, API URL, account number, start date, and scraper options
 * @returns the account data or an error object if the API call failed
 */
async function fetchOneAccount(
  opts: IFetchOneAccountOpts,
): Promise<{ error: string } | { accountNumber: string; balance: number; txns: ITransaction[] }> {
  const { page, apiSiteUrl, accountNumber, startDateStr, options } = opts;
  const txnsQuery =
    'IsCategoryDescCode=True&IsTransactionDetails=True&IsEventNames=True' +
    `&IsFutureTransactionFlag=True&FromDate=${startDateStr}`;
  const txnsUrl = `${apiSiteUrl}/lastTransactions/${accountNumber}/Date?${txnsQuery}`;
  const txnsResult = await fetchGetWithinPage<IScrapedTransactionData>(page, txnsUrl);
  if (!txnsResult.isFound) {
    return { error: 'unknown error' };
  }
  if (txnsResult.value.Error) {
    return { error: txnsResult.value.Error.MsgText };
  }
  if (!txnsResult.value.CurrentAccountLastTransactions) {
    return { accountNumber, balance: 0, txns: [] };
  }
  return buildOneAccountResult(txnsResult.value, accountNumber, options);
}

/**
 * Calculates the start date string for the API request, limited to max 1 year back.
 *
 * @param options - scraper options containing the user-specified start date
 * @returns the formatted start date string for the Discount API
 */
function buildStartDateStr(options: ScraperOptions): string {
  const defaultStartMoment = moment().subtract(1, 'years').add(2, 'day');
  const optionsStartMoment = moment(options.startDate);
  const startMoment = moment.max(defaultStartMoment, optionsStartMoment);
  return startMoment.format(CFG.format.date);
}

export interface IFetchAllAccountsOpts {
  page: Page;
  apiSiteUrl: string;
  accountNumbers: string[];
  startDateStr: string;
  options: ScraperOptions;
}

/**
 * Fetches transaction data for all accounts in parallel and combines the results.
 *
 * @param opts - options with page, API URL, account numbers, start date, and scraper options
 * @returns a scraping result with all account data or the first error encountered
 */
async function fetchAllAccounts(opts: IFetchAllAccountsOpts): Promise<IScraperScrapingResult> {
  const { page, apiSiteUrl, accountNumbers, startDateStr, options } = opts;
  const fetchPromises = accountNumbers.map(accountNumber =>
    fetchOneAccount({ page, apiSiteUrl, accountNumber, startDateStr, options }),
  );
  const results = await Promise.all(fetchPromises);
  const errorResult = results.find(r => 'error' in r);
  if (errorResult && 'error' in errorResult)
    return {
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: errorResult.error,
    };
  const accounts = results.filter(
    (r): r is Exclude<typeof r, { error: string }> => !('error' in r),
  );
  return { success: true, accounts };
}

export interface IFetchAccountDataOpts {
  page: Page;
  apiSiteUrl: string;
  accountInfo: IScrapedAccountData;
  options: ScraperOptions;
}

/**
 * Builds the IFetchAllAccountsOpts from the account info and scraper options.
 *
 * @param opts - fetch account data options with page, API URL, account info, and scraper options
 * @returns options for fetching all accounts' transaction data
 */
function buildAccountsOpts(opts: IFetchAccountDataOpts): IFetchAllAccountsOpts {
  const { page, apiSiteUrl, accountInfo, options } = opts;
  const startDateStr = buildStartDateStr(options);
  const accountNumbers = accountInfo.UserAccountsData.UserAccounts.map(
    acc => acc.NewAccountInfo.AccountID,
  );
  return { page, apiSiteUrl, accountNumbers, startDateStr, options };
}

/**
 * Returns a generic error for failed account data fetch.
 *
 * @returns a failed IScraperScrapingResult with a Generic error type
 */
function noAccountDataError(): IScraperScrapingResult {
  return {
    success: false,
    errorType: ScraperErrorTypes.Generic,
    errorMessage: 'failed to get account data',
  };
}

/**
 * Fetches account metadata and then all account transaction data.
 *
 * @param page - the Playwright page for API requests
 * @param options - scraper options for date range and rawTransaction inclusion
 * @returns the complete scraping result for all Discount Bank accounts
 */
async function fetchAccountData(
  page: Page,
  options: ScraperOptions,
): Promise<IScraperScrapingResult> {
  const apiSiteUrl = `${CFG.api.base}/Titan/gatewayAPI`;
  const accountInfoResult = await fetchGetWithinPage<IScrapedAccountData>(
    page,
    `${apiSiteUrl}/userAccountsData`,
  );
  if (!accountInfoResult.isFound) return noAccountDataError();
  const allAccountsOpts = buildAccountsOpts({
    page,
    apiSiteUrl,
    accountInfo: accountInfoResult.value,
    options,
  });
  return fetchAllAccounts(allAccountsOpts);
}

export interface IScraperSpecificCredentials {
  id: string;
  password: string;
  num: string;
}

/** IScraper implementation for Discount Bank (Bank Discont). */
class DiscountScraper extends GenericBankScraper<IScraperSpecificCredentials> {
  /**
   * Creates a DiscountScraper with the bank-specific login configuration.
   *
   * @param options - scraper options including companyId and timeouts
   * @param config - login configuration (defaults to the Discount Bank config)
   */
  constructor(
    options: ScraperOptions,
    config: ILoginConfig = discountConfig(
      SCRAPER_CONFIGURATION.banks[CompanyTypes.Discount].urls.base,
    ),
  ) {
    super(options, config);
  }

  /**
   * Fetches all account data and transactions for the logged-in Discount Bank user.
   *
   * @returns a scraping result with all account data or an error
   */
  public async fetchData(): Promise<IScraperScrapingResult> {
    return fetchAccountData(this.page, this.options);
  }
}

export default DiscountScraper;
