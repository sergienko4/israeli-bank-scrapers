import _ from 'lodash';
import moment from 'moment';
import { type Page } from 'playwright';
import { fetchGetWithinPage } from '../helpers/fetch';
import { getRawTransaction } from '../helpers/transactions';
import { type Transaction, TransactionStatuses, TransactionTypes } from '../transactions';
import { CompanyTypes } from '../definitions';
import { BANK_REGISTRY } from './bank-registry';
import { GenericBankScraper } from './generic-bank-scraper';
import { ScraperErrorTypes } from './errors';
import { type LoginConfig } from './login-config';
import { type ScraperOptions, type ScraperScrapingResult } from './interface';

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

function convertOneTxn(txn: ScrapedTransaction, txnStatus: TransactionStatuses, options?: ScraperOptions): Transaction {
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

function buildOneAccountResult(
  txnsResult: ScrapedTransactionData,
  accountNumber: string,
  options: ScraperOptions,
): { accountNumber: string; balance: number; txns: Transaction[] } {
  const data = txnsResult.CurrentAccountLastTransactions!;
  const completedTxns = convertTransactions(data.OperationEntry, TransactionStatuses.Completed, options);
  const rawFutureTxns = _.get(
    txnsResult,
    'CurrentAccountLastTransactions.FutureTransactionsBlock.FutureTransactionEntry',
  ) as ScrapedTransaction[];
  return {
    accountNumber,
    balance: data.CurrentAccountInfo.AccountBalance,
    txns: [...completedTxns, ...convertTransactions(rawFutureTxns, TransactionStatuses.Pending, options)],
  };
}

async function fetchOneAccount(
  opts: FetchOneAccOpts,
): Promise<{ error: string } | { accountNumber: string; balance: number; txns: Transaction[] }> {
  const { page, apiSiteUrl, accountNumber, startDateStr, options } = opts;
  const txnsUrl = `${apiSiteUrl}/lastTransactions/${accountNumber}/Date?IsCategoryDescCode=True&IsTransactionDetails=True&IsEventNames=True&IsFutureTransactionFlag=True&FromDate=${startDateStr}`;
  const txnsResult = await fetchGetWithinPage<ScrapedTransactionData>(page, txnsUrl);
  if (!txnsResult || txnsResult.Error || !txnsResult.CurrentAccountLastTransactions) {
    return { error: txnsResult?.Error?.MsgText ?? 'unknown error' };
  }
  return buildOneAccountResult(txnsResult, accountNumber, options);
}

async function fetchAccountData(page: Page, options: ScraperOptions): Promise<ScraperScrapingResult> {
  const apiSiteUrl = `${BASE_URL}/Titan/gatewayAPI`;
  const accountInfo = await fetchGetWithinPage<ScrapedAccountData>(page, `${apiSiteUrl}/userAccountsData`);
  if (!accountInfo)
    return { success: false, errorType: ScraperErrorTypes.Generic, errorMessage: 'failed to get account data' };

  const defaultStartMoment = moment().subtract(1, 'years').add(2, 'day');
  const startMoment = moment.max(defaultStartMoment, moment(options.startDate || defaultStartMoment.toDate()));
  const startDateStr = startMoment.format(DATE_FORMAT);
  const accounts = accountInfo.UserAccountsData.UserAccounts.map(acc => acc.NewAccountInfo.AccountID);
  const accountsData = [];
  for (const accountNumber of accounts) {
    const result = await fetchOneAccount({ page, apiSiteUrl, accountNumber, startDateStr, options });
    if ('error' in result) return { success: false, errorType: ScraperErrorTypes.Generic, errorMessage: result.error };
    accountsData.push(result);
  }
  return { success: true, accounts: accountsData };
}

type ScraperSpecificCredentials = { id: string; password: string; num: string };

class DiscountScraper extends GenericBankScraper<ScraperSpecificCredentials> {
  constructor(options: ScraperOptions, config: LoginConfig = BANK_REGISTRY[CompanyTypes.discount]!) {
    super(options, config);
  }

  async fetchData(): Promise<ScraperScrapingResult> {
    return fetchAccountData(this.page, this.options);
  }
}

export default DiscountScraper;
