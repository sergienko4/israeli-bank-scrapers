import moment from 'moment';
import { type Page } from 'playwright';

import { fetchGetWithinPage } from '../../Common/Fetch';
import { getRawTransaction } from '../../Common/Transactions';
import { CompanyTypes } from '../../Definitions';
import { type Transaction, TransactionStatuses, TransactionTypes } from '../../Transactions';
import { ScraperErrorTypes } from '../Base/Errors';
import { GenericBankScraper } from '../Base/GenericBankScraper';
import { type ScraperOptions, type ScraperScrapingResult } from '../Base/Interface';
import { type LoginConfig } from '../Base/LoginConfig';
import { SCRAPER_CONFIGURATION } from '../Registry/ScraperConfig';
import { discountConfig } from './DiscountLoginConfig';

const CFG = SCRAPER_CONFIGURATION.banks[CompanyTypes.Discount];

export interface ScrapedTransaction {
  OperationNumber: number;
  OperationDate: string;
  ValueDate: string;
  OperationAmount: number;
  OperationDescriptionToDisplay: string;
}

export interface CurrentAccountInfo {
  AccountBalance: number;
}

export interface ScrapedAccountData {
  UserAccountsData: {
    DefaultAccountNumber: string;
    UserAccounts: {
      NewAccountInfo: {
        AccountID: string;
      };
    }[];
  };
}

export interface ScrapedTransactionData {
  Error?: { MsgText: string };
  CurrentAccountLastTransactions?: {
    OperationEntry: ScrapedTransaction[] | null;
    CurrentAccountInfo: CurrentAccountInfo;
    FutureTransactionsBlock: {
      FutureTransactionEntry: ScrapedTransaction[] | null;
    };
  };
}

/**
 * Converts a single scraped Discount Bank transaction to a normalized Transaction.
 *
 * @param txn - the raw scraped transaction
 * @param txnStatus - whether the transaction is pending or completed
 * @param options - scraper options controlling rawTransaction inclusion
 * @returns a normalized Transaction object
 */
function convertOneTxn(
  txn: ScrapedTransaction,
  txnStatus: TransactionStatuses,
  options?: ScraperOptions,
): Transaction {
  const result: Transaction = {
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
 * Converts an array of scraped transactions to normalized Transaction objects.
 *
 * @param txns - the raw scraped transactions
 * @param txnStatus - whether the transactions are pending or completed
 * @param options - scraper options controlling rawTransaction inclusion
 * @returns an array of normalized Transaction objects
 */
function convertTransactions(
  txns: ScrapedTransaction[],
  txnStatus: TransactionStatuses,
  options?: ScraperOptions,
): Transaction[] {
  return txns.map(txn => convertOneTxn(txn, txnStatus, options));
}

export interface FetchOneAccOpts {
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
  txnsResult: ScrapedTransactionData,
  options: ScraperOptions,
): Transaction[] {
  const rawFutureTxns: ScrapedTransaction[] | null | undefined =
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
  txnsResult: ScrapedTransactionData,
  accountNumber: string,
  options: ScraperOptions,
): { accountNumber: string; balance: number; txns: Transaction[] } {
  const data = txnsResult.CurrentAccountLastTransactions ?? {
    OperationEntry: [],
    CurrentAccountInfo: { AccountBalance: 0 },
  };
  const completedTxns = data.OperationEntry
    ? convertTransactions(data.OperationEntry, TransactionStatuses.Completed, options)
    : [];
  return {
    accountNumber,
    balance: data.CurrentAccountInfo.AccountBalance,
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
  opts: FetchOneAccOpts,
): Promise<{ error: string } | { accountNumber: string; balance: number; txns: Transaction[] }> {
  const { page, apiSiteUrl, accountNumber, startDateStr, options } = opts;
  const txnsQuery =
    'IsCategoryDescCode=True&IsTransactionDetails=True&IsEventNames=True' +
    `&IsFutureTransactionFlag=True&FromDate=${startDateStr}`;
  const txnsUrl = `${apiSiteUrl}/lastTransactions/${accountNumber}/Date?${txnsQuery}`;
  const txnsResult = await fetchGetWithinPage<ScrapedTransactionData>(page, txnsUrl);
  if (!txnsResult || txnsResult.Error) {
    return { error: txnsResult?.Error?.MsgText ?? 'unknown error' };
  }
  if (!txnsResult.CurrentAccountLastTransactions) {
    return { accountNumber, balance: 0, txns: [] };
  }
  return buildOneAccountResult(txnsResult, accountNumber, options);
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

export interface FetchAllAccountsOpts {
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
async function fetchAllAccounts(opts: FetchAllAccountsOpts): Promise<ScraperScrapingResult> {
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

export interface FetchAccountDataOpts {
  page: Page;
  apiSiteUrl: string;
  accountInfo: ScrapedAccountData;
  options: ScraperOptions;
}

/**
 * Builds the FetchAllAccountsOpts from the account info and scraper options.
 *
 * @param opts - fetch account data options with page, API URL, account info, and scraper options
 * @returns options for fetching all accounts' transaction data
 */
function buildAccountsOpts(opts: FetchAccountDataOpts): FetchAllAccountsOpts {
  const { page, apiSiteUrl, accountInfo, options } = opts;
  const startDateStr = buildStartDateStr(options);
  const accountNumbers = accountInfo.UserAccountsData.UserAccounts.map(
    acc => acc.NewAccountInfo.AccountID,
  );
  return { page, apiSiteUrl, accountNumbers, startDateStr, options };
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
): Promise<ScraperScrapingResult> {
  const apiSiteUrl = `${CFG.api.base}/Titan/gatewayAPI`;
  const accountInfo = await fetchGetWithinPage<ScrapedAccountData>(
    page,
    `${apiSiteUrl}/userAccountsData`,
  );
  if (!accountInfo)
    return {
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: 'failed to get account data',
    };
  const allAccountsOpts = buildAccountsOpts({ page, apiSiteUrl, accountInfo, options });
  return fetchAllAccounts(allAccountsOpts);
}

export interface ScraperSpecificCredentials {
  id: string;
  password: string;
  num: string;
}

/** Scraper implementation for Discount Bank (Bank Discont). */
class DiscountScraper extends GenericBankScraper<ScraperSpecificCredentials> {
  /**
   * Creates a DiscountScraper with the bank-specific login configuration.
   *
   * @param options - scraper options including companyId and timeouts
   * @param config - login configuration (defaults to the Discount Bank config)
   */
  constructor(
    options: ScraperOptions,
    config: LoginConfig = discountConfig(
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
  public async fetchData(): Promise<ScraperScrapingResult> {
    return fetchAccountData(this.page, this.options);
  }
}

export default DiscountScraper;
