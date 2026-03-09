import moment from 'moment';
import { type Page } from 'playwright';

import { fetchGetWithinPage } from '../../Common/Fetch.js';
import { getRawTransaction } from '../../Common/Transactions.js';
import { runSerial } from '../../Common/Waiting.js';
import { CompanyTypes } from '../../Definitions.js';
import { type ITransaction, TransactionStatuses, TransactionTypes } from '../../Transactions.js';
import { ScraperErrorTypes } from '../Base/Errors.js';
import GenericBankScraper from '../Base/GenericBankScraper.js';
import { type IScraperScrapingResult, type ScraperOptions } from '../Base/Interface.js';
import { type ILoginConfig } from '../Base/LoginConfig.js';
import { SCRAPER_CONFIGURATION } from '../Registry/ScraperConfig.js';
import discountConfig from './DiscountLoginConfig.js';

const CFG = SCRAPER_CONFIGURATION.banks[CompanyTypes.Discount];

interface IScrapedTransaction {
  OperationNumber: number;
  OperationDate: string;
  ValueDate: string;
  OperationAmount: number;
  OperationDescriptionToDisplay: string;
}

interface ICurrentAccountInfo {
  AccountBalance: number;
}

interface IScrapedAccountData {
  UserAccountsData: {
    DefaultAccountNumber: string;
    UserAccounts: {
      NewAccountInfo: {
        AccountID: string;
      };
    }[];
  };
}

interface IScrapedTransactionData {
  Error?: { MsgText: string };
  CurrentAccountLastTransactions?: {
    OperationEntry: IScrapedTransaction[] | null;
    CurrentAccountInfo: ICurrentAccountInfo;
    FutureTransactionsBlock: {
      FutureTransactionEntry: IScrapedTransaction[] | null;
    };
  };
}

/**
 * Build the base transaction object from a scraped API entry.
 * @param txn - The scraped transaction from the API.
 * @param txnStatus - The status to assign to the transaction.
 * @returns The base ITransaction object.
 */
function buildTxnBase(txn: IScrapedTransaction, txnStatus: TransactionStatuses): ITransaction {
  return {
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
}

/**
 * Convert a single scraped transaction to the standard format.
 * @param txn - The scraped transaction from the API.
 * @param txnStatus - The status to assign to the transaction.
 * @param options - Optional scraper options for raw data inclusion.
 * @returns The converted ITransaction.
 */
function convertOneTxn(
  txn: IScrapedTransaction,
  txnStatus: TransactionStatuses,
  options?: ScraperOptions,
): ITransaction {
  const result = buildTxnBase(txn, txnStatus);
  if (options?.includeRawTransaction) {
    result.rawTransaction = getRawTransaction(txn);
  }
  return result;
}

/**
 * Convert an array of scraped transactions to the standard format.
 * @param txns - The array of scraped transactions.
 * @param txnStatus - The status to assign to all transactions.
 * @param options - Optional scraper options.
 * @returns The converted ITransaction array.
 */
function convertTransactions(
  txns: IScrapedTransaction[],
  txnStatus: TransactionStatuses,
  options?: ScraperOptions,
): ITransaction[] {
  return txns.map(txn => convertOneTxn(txn, txnStatus, options));
}

interface IFetchOneAccountOpts {
  page: Page;
  apiSiteUrl: string;
  accountNumber: string;
  startDateStr: string;
  options: ScraperOptions;
}

/**
 * Extract pending (future) transactions from the response.
 * @param txnsResult - The scraped transaction data.
 * @param options - The scraper options.
 * @returns The array of pending transactions.
 */
function getPendingTxns(
  txnsResult: IScrapedTransactionData,
  options: ScraperOptions,
): ITransaction[] {
  const futureBlock = txnsResult.CurrentAccountLastTransactions?.FutureTransactionsBlock;
  const rawFutureTxns = futureBlock?.FutureTransactionEntry;
  if (!rawFutureTxns) return [];
  return convertTransactions(rawFutureTxns, TransactionStatuses.Pending, options);
}

/**
 * Extract completed transactions from the account data.
 * @param data - The current account last transactions block.
 * @param options - The scraper options.
 * @returns The array of completed transactions.
 */
function getCompletedTxns(
  data: NonNullable<IScrapedTransactionData['CurrentAccountLastTransactions']>,
  options: ScraperOptions,
): ITransaction[] {
  if (!data.OperationEntry) return [];
  return convertTransactions(data.OperationEntry, TransactionStatuses.Completed, options);
}

const DEFAULT_ACCOUNT_DATA = {
  OperationEntry: null,
  CurrentAccountInfo: { AccountBalance: 0 },
  FutureTransactionsBlock: { FutureTransactionEntry: null },
} as const;

interface IAccountResult {
  accountNumber: string;
  balance: number;
  txns: ITransaction[];
}

/**
 * Build the result for a single account from its transaction data.
 * @param txnsResult - The scraped transaction data.
 * @param accountNumber - The account number string.
 * @param options - The scraper options.
 * @returns The account result with number, balance, and transactions.
 */
function buildOneAccountResult(
  txnsResult: IScrapedTransactionData,
  accountNumber: string,
  options: ScraperOptions,
): IAccountResult {
  const data = txnsResult.CurrentAccountLastTransactions ?? DEFAULT_ACCOUNT_DATA;
  const completed = getCompletedTxns(data, options);
  const pending = getPendingTxns(txnsResult, options);
  return {
    accountNumber,
    balance: data.CurrentAccountInfo.AccountBalance,
    txns: [...completed, ...pending],
  };
}

/**
 * Build the transactions URL for a specific account.
 * @param apiSiteUrl - The base API site URL.
 * @param accountNumber - The account number.
 * @param startDateStr - The formatted start date string.
 * @returns The full transactions URL.
 */
function buildTxnsUrl(apiSiteUrl: string, accountNumber: string, startDateStr: string): string {
  return (
    `${apiSiteUrl}/lastTransactions/${accountNumber}/Date` +
    '?IsCategoryDescCode=True&IsTransactionDetails=True' +
    '&IsEventNames=True&IsFutureTransactionFlag=True' +
    `&FromDate=${startDateStr}`
  );
}

type IFetchOneResult = { error: string } | IAccountResult;

/**
 * Fetch transaction data for a single account from the API.
 * @param opts - The fetch options for a single account.
 * @returns Either an error object or the account result.
 */
async function fetchOneAccount(opts: IFetchOneAccountOpts): Promise<IFetchOneResult> {
  const { page, apiSiteUrl, accountNumber, startDateStr, options } = opts;
  const txnsUrl = buildTxnsUrl(apiSiteUrl, accountNumber, startDateStr);
  const txnsResult = await fetchGetWithinPage<IScrapedTransactionData>(page, txnsUrl);
  if (!txnsResult) return { accountNumber, balance: 0, txns: [] };
  if (txnsResult.Error) {
    return { error: txnsResult.Error.MsgText };
  }
  if (!txnsResult.CurrentAccountLastTransactions) {
    return { accountNumber, balance: 0, txns: [] };
  }
  return buildOneAccountResult(txnsResult, accountNumber, options);
}

/**
 * Build the formatted start date string from scraper options.
 * @param options - The scraper options.
 * @returns The formatted start date string.
 */
function buildStartDateStr(options: ScraperOptions): string {
  const defaultStartMoment = moment().subtract(1, 'years').add(2, 'day');
  const optionsStartMoment = moment(options.startDate);
  const startMoment = moment.max(defaultStartMoment, optionsStartMoment);
  return startMoment.format(CFG.format.date);
}

interface IFetchAllAccountsOpts {
  page: Page;
  apiSiteUrl: string;
  accountNumbers: string[];
  startDateStr: string;
  options: ScraperOptions;
}

/**
 * Check results for errors and collect successful account data.
 * @param results - The array of fetch results.
 * @returns The scraping result with all accounts or an error.
 */
function collectAccountResults(results: IFetchOneResult[]): IScraperScrapingResult {
  const accountsData: IAccountResult[] = [];
  for (const result of results) {
    if ('error' in result) {
      return {
        success: false,
        errorType: ScraperErrorTypes.Generic,
        errorMessage: result.error,
      };
    }
    accountsData.push(result);
  }
  return { success: true, accounts: accountsData };
}

/**
 * Fetch transaction data for all accounts sequentially.
 * @param opts - The fetch options for all accounts.
 * @returns The scraping result with all accounts.
 */
async function fetchAllAccounts(opts: IFetchAllAccountsOpts): Promise<IScraperScrapingResult> {
  const { page, apiSiteUrl, accountNumbers, startDateStr, options } = opts;
  const actions = accountNumbers.map(
    (accountNumber): (() => Promise<IFetchOneResult>) =>
      () =>
        fetchOneAccount({
          page,
          apiSiteUrl,
          accountNumber,
          startDateStr,
          options,
        }),
  );
  const results = await runSerial(actions);
  return collectAccountResults(results);
}

interface IFetchAccountDataOpts {
  page: Page;
  apiSiteUrl: string;
  accountInfo: IScrapedAccountData;
  options: ScraperOptions;
}

/**
 * Build the options for fetching all accounts.
 * @param opts - The account data fetch options.
 * @returns The options for fetchAllAccounts.
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
 * Fetch account data from the Discount API.
 * @param page - The Playwright page instance.
 * @param options - The scraper options.
 * @returns The scraping result with all accounts.
 */
async function fetchAccountData(
  page: Page,
  options: ScraperOptions,
): Promise<IScraperScrapingResult> {
  const apiSiteUrl = `${CFG.api.base}/Titan/gatewayAPI`;
  const accountInfoUrl = `${apiSiteUrl}/userAccountsData`;
  const accountInfo = await fetchGetWithinPage<IScrapedAccountData>(page, accountInfoUrl);
  if (!accountInfo) return { success: false, errorMessage: 'Failed to fetch account data' };
  const accountsOpts = buildAccountsOpts({
    page,
    apiSiteUrl,
    accountInfo,
    options,
  });
  return fetchAllAccounts(accountsOpts);
}

interface IScraperSpecificCredentials {
  id: string;
  password: string;
  num: string;
}

/** Discount bank scraper — fetches transactions from Discount online banking. */
class DiscountScraper extends GenericBankScraper<IScraperSpecificCredentials> {
  /**
   * Create a Discount scraper with the given options and login config.
   * @param options - The scraper configuration options.
   * @param config - Optional login configuration override.
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
   * Fetch transaction data from Discount online banking.
   * @returns The scraping result with accounts and transactions.
   */
  public async fetchData(): Promise<IScraperScrapingResult> {
    return fetchAccountData(this.page, this.options);
  }
}

export default DiscountScraper;
