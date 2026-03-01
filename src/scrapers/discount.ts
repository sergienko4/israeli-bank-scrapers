import _ from 'lodash';
import moment from 'moment';
import { type Page } from 'playwright';
import { fetchGetWithinPage } from '../Helpers/Fetch';
import { getRawTransaction } from '../Helpers/Transactions';
import { type Transaction, TransactionStatuses, TransactionTypes } from '../Transactions';
import { CompanyTypes } from '../Definitions';
import { BANK_REGISTRY } from './BankRegistry';
import { GenericBankScraper } from './GenericBankScraper';
import { ScraperErrorTypes } from './Errors';
import { type LoginConfig } from './LoginConfig';
import { type ScraperOptions, type ScraperScrapingResult } from './Interface';

const BASE_URL = 'https://start.telebank.co.il';
const DATE_FORMAT = 'YYYYMMDD';

interface ScrapedTransaction {
  OperationNumber: number;
  OperationDate: string;
  ValueDate: string;
  OperationAmount: number;
  OperationDescriptionToDisplay: string;
}

interface CurrentAccountInfo {
  AccountBalance: number;
}

interface ScrapedAccountData {
  UserAccountsData: {
    DefaultAccountNumber: string;
    UserAccounts: Array<{
      NewAccountInfo: {
        AccountID: string;
      };
    }>;
  };
}

interface ScrapedTransactionData {
  Error?: { MsgText: string };
  CurrentAccountLastTransactions?: {
    OperationEntry: ScrapedTransaction[];
    CurrentAccountInfo: CurrentAccountInfo;
    FutureTransactionsBlock: {
      FutureTransactionEntry: ScrapedTransaction[];
    };
  };
}

function convertOneTxn(
  txn: ScrapedTransaction,
  txnStatus: TransactionStatuses,
  options?: ScraperOptions,
): Transaction {
  const result: Transaction = {
    type: TransactionTypes.Normal,
    identifier: txn.OperationNumber,
    date: moment(txn.OperationDate, DATE_FORMAT).toISOString(),
    processedDate: moment(txn.ValueDate, DATE_FORMAT).toISOString(),
    originalAmount: txn.OperationAmount,
    originalCurrency: 'ILS',
    chargedAmount: txn.OperationAmount,
    description: txn.OperationDescriptionToDisplay,
    status: txnStatus,
  };
  if (options?.includeRawTransaction) result.rawTransaction = getRawTransaction(txn);
  return result;
}

function convertTransactions(
  txns: ScrapedTransaction[],
  txnStatus: TransactionStatuses,
  options?: ScraperOptions,
): Transaction[] {
  if (!txns) return [];
  return txns.map(txn => convertOneTxn(txn, txnStatus, options));
}

interface FetchOneAccOpts {
  page: Page;
  apiSiteUrl: string;
  accountNumber: string;
  startDateStr: string;
  options: ScraperOptions;
}

function getPendingTxns(
  txnsResult: ScrapedTransactionData,
  options: ScraperOptions,
): Transaction[] {
  const rawFutureTxns = _.get(
    txnsResult,
    'CurrentAccountLastTransactions.FutureTransactionsBlock.FutureTransactionEntry',
  ) as ScrapedTransaction[];
  return convertTransactions(rawFutureTxns, TransactionStatuses.Pending, options);
}

function buildOneAccountResult(
  txnsResult: ScrapedTransactionData,
  accountNumber: string,
  options: ScraperOptions,
): { accountNumber: string; balance: number; txns: Transaction[] } {
  const data = txnsResult.CurrentAccountLastTransactions!;
  const completedTxns = convertTransactions(
    data.OperationEntry,
    TransactionStatuses.Completed,
    options,
  );
  return {
    accountNumber,
    balance: data.CurrentAccountInfo.AccountBalance,
    txns: [...completedTxns, ...getPendingTxns(txnsResult, options)],
  };
}

async function fetchOneAccount(
  opts: FetchOneAccOpts,
): Promise<{ error: string } | { accountNumber: string; balance: number; txns: Transaction[] }> {
  const { page, apiSiteUrl, accountNumber, startDateStr, options } = opts;
  const txnsUrl = `${apiSiteUrl}/lastTransactions/${accountNumber}/Date?IsCategoryDescCode=True&IsTransactionDetails=True&IsEventNames=True&IsFutureTransactionFlag=True&FromDate=${startDateStr}`;
  const txnsResult = await fetchGetWithinPage<ScrapedTransactionData>(page, txnsUrl);
  if (!txnsResult || txnsResult.Error) {
    return { error: txnsResult?.Error?.MsgText ?? 'unknown error' };
  }
  if (!txnsResult.CurrentAccountLastTransactions) {
    return { accountNumber, balance: 0, txns: [] };
  }
  return buildOneAccountResult(txnsResult, accountNumber, options);
}

function buildStartDateStr(options: ScraperOptions): string {
  const defaultStartMoment = moment().subtract(1, 'years').add(2, 'day');
  const startMoment = moment.max(
    defaultStartMoment,
    moment(options.startDate || defaultStartMoment.toDate()),
  );
  return startMoment.format(DATE_FORMAT);
}

interface FetchAllAccountsOpts {
  page: Page;
  apiSiteUrl: string;
  accountNumbers: string[];
  startDateStr: string;
  options: ScraperOptions;
}

async function fetchAllAccounts(opts: FetchAllAccountsOpts): Promise<ScraperScrapingResult> {
  const { page, apiSiteUrl, accountNumbers, startDateStr, options } = opts;
  const accountsData = [];
  for (const accountNumber of accountNumbers) {
    const result = await fetchOneAccount({
      page,
      apiSiteUrl,
      accountNumber,
      startDateStr,
      options,
    });
    if ('error' in result)
      return { success: false, errorType: ScraperErrorTypes.Generic, errorMessage: result.error };
    accountsData.push(result);
  }
  return { success: true, accounts: accountsData };
}

interface FetchAccountDataOpts {
  page: Page;
  apiSiteUrl: string;
  accountInfo: ScrapedAccountData;
  options: ScraperOptions;
}

function buildAccountsOpts(opts: FetchAccountDataOpts): FetchAllAccountsOpts {
  const { page, apiSiteUrl, accountInfo, options } = opts;
  const startDateStr = buildStartDateStr(options);
  const accountNumbers = accountInfo.UserAccountsData.UserAccounts.map(
    acc => acc.NewAccountInfo.AccountID,
  );
  return { page, apiSiteUrl, accountNumbers, startDateStr, options };
}

async function fetchAccountData(
  page: Page,
  options: ScraperOptions,
): Promise<ScraperScrapingResult> {
  const apiSiteUrl = `${BASE_URL}/Titan/gatewayAPI`;
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
  return fetchAllAccounts(buildAccountsOpts({ page, apiSiteUrl, accountInfo, options }));
}

type ScraperSpecificCredentials = { id: string; password: string; num: string };

class DiscountScraper extends GenericBankScraper<ScraperSpecificCredentials> {
  constructor(
    options: ScraperOptions,
    config: LoginConfig = BANK_REGISTRY[CompanyTypes.Discount]!,
  ) {
    super(options, config);
  }

  async fetchData(): Promise<ScraperScrapingResult> {
    return fetchAccountData(this.page, this.options);
  }
}

export default DiscountScraper;
