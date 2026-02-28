import moment from 'moment';
import { type Page } from 'playwright';
import { v4 as uuid4 } from 'uuid';
import { getDebug } from '../helpers/debug';
import { fetchGetWithinPage, fetchPostWithinPage } from '../helpers/fetch';
import {} from '../helpers/navigation';
import { waitUntil } from '../helpers/waiting';
import { type Transaction, TransactionStatuses, TransactionTypes } from '../transactions';
import { CompanyTypes } from '../definitions';
import { BANK_REGISTRY } from './bank-registry';
import { GenericBankScraper } from './generic-bank-scraper';
import { type ScraperOptions } from './interface';
import { getRawTransaction } from '../helpers/transactions';

const debug = getDebug('hapoalim');

const DATE_FORMAT = 'YYYYMMDD';

// eslint-disable-next-line @typescript-eslint/no-namespace
declare namespace window {
  const bnhpApp: { restContext: string };
}

interface ScrapedTransaction {
  serialNumber?: number;
  activityDescription?: string;
  eventAmount: number;
  valueDate?: string;
  eventDate?: string;
  referenceNumber?: number;
  ScrapedTransaction?: string;
  eventActivityTypeCode: number;
  currentBalance: number;
  pfmDetails: string;
  beneficiaryDetailsData?: {
    partyHeadline?: string;
    partyName?: string;
    messageHeadline?: string;
    messageDetail?: string;
  };
  additionalInformation?: unknown;
}

interface ScrapedPfmTransaction {
  transactionNumber: number;
}

type FetchedAccountData = {
  bankNumber: string;
  accountNumber: string;
  branchNumber: string;
  accountClosingReasonCode: number;
}[];

type FetchedAccountTransactionsData = {
  transactions: ScrapedTransaction[];
};

type BalanceAndCreditLimit = {
  creditLimitAmount: number;
  creditLimitDescription: string;
  creditLimitUtilizationAmount: number;
  creditLimitUtilizationExistanceCode: number;
  creditLimitUtilizationPercent: number;
  currentAccountLimitsAmount: number;
  currentBalance: number;
  withdrawalBalance: number;
};

function buildMemo(txn: ScrapedTransaction): string {
  if (!txn.beneficiaryDetailsData) return '';
  const { partyHeadline, partyName, messageHeadline, messageDetail } = txn.beneficiaryDetailsData;
  const memoLines: string[] = [];
  if (partyHeadline) memoLines.push(partyHeadline);
  if (partyName) memoLines.push(`${partyName}.`);
  if (messageHeadline) memoLines.push(messageHeadline);
  if (messageDetail) memoLines.push(`${messageDetail}.`);
  return memoLines.join(' ');
}

function convertOneTxn(txn: ScrapedTransaction, options?: ScraperOptions): Transaction {
  const isOutbound = txn.eventActivityTypeCode === 2;
  const amount = isOutbound ? -txn.eventAmount : txn.eventAmount;
  const result: Transaction = {
    type: TransactionTypes.Normal,
    identifier: txn.referenceNumber,
    date: moment(txn.eventDate, DATE_FORMAT).toISOString(),
    processedDate: moment(txn.valueDate, DATE_FORMAT).toISOString(),
    originalAmount: amount,
    originalCurrency: 'ILS',
    chargedAmount: amount,
    description: txn.activityDescription || '',
    status: txn.serialNumber === 0 ? TransactionStatuses.Pending : TransactionStatuses.Completed,
    memo: buildMemo(txn),
  };
  if (options?.includeRawTransaction) result.rawTransaction = getRawTransaction(txn);
  return result;
}

function convertTransactions(txns: ScrapedTransaction[], options?: ScraperOptions): Transaction[] {
  return txns.map(txn => convertOneTxn(txn, options));
}

async function getRestContext(page: Page): Promise<string> {
  await waitUntil(() => {
    return page.evaluate(() => !!window.bnhpApp);
  }, 'waiting for app data load');

  const result = await page.evaluate(() => {
    return window.bnhpApp.restContext;
  });

  return result.slice(1);
}

async function fetchPoalimXSRFWithinPage(
  page: Page,
  url: string,
  pageUuid: string,
): Promise<FetchedAccountTransactionsData | null> {
  const cookies = await page.context().cookies();
  const XSRFCookie = cookies.find(cookie => cookie.name === 'XSRF-TOKEN');
  const headers: Record<string, string> = {};
  if (XSRFCookie != null) {
    headers['X-XSRF-TOKEN'] = XSRFCookie.value;
  }
  headers.pageUuid = pageUuid;
  headers.uuid = uuid4();
  headers['Content-Type'] = 'application/json;charset=UTF-8';
  return fetchPostWithinPage<FetchedAccountTransactionsData>(page, url, { data: [], extraHeaders: headers });
}

interface ExtraScrapOpts {
  txnsResult: FetchedAccountTransactionsData;
  baseUrl: string;
  page: Page;
  accountNumber: string;
}

interface EnrichTxnOpts {
  transaction: ScrapedTransaction;
  baseUrl: string;
  page: Page;
  accountNumber: string;
}

async function enrichOneTxn(opts: EnrichTxnOpts): Promise<ScrapedTransaction> {
  const { transaction, baseUrl, page, accountNumber } = opts;
  const { pfmDetails, serialNumber } = transaction;
  if (serialNumber === 0) return transaction;
  const url = `${baseUrl}${pfmDetails}&accountId=${accountNumber}&lang=he`;
  const extraDetails = (await fetchGetWithinPage<ScrapedPfmTransaction[]>(page, url)) || [];
  if (extraDetails.length && extraDetails[0].transactionNumber) {
    return { ...transaction, referenceNumber: extraDetails[0].transactionNumber, additionalInformation: extraDetails };
  }
  return transaction;
}

async function getExtraScrap(opts: ExtraScrapOpts): Promise<FetchedAccountTransactionsData> {
  const { txnsResult, baseUrl, page, accountNumber } = opts;
  const res = await Promise.all(
    txnsResult.transactions.map(t => enrichOneTxn({ transaction: t, baseUrl, page, accountNumber })),
  );
  return { transactions: res };
}

interface GetAccountTxnsOpts {
  baseUrl: string;
  apiSiteUrl: string;
  page: Page;
  accountNumber: string;
  startDate: string;
  endDate: string;
  additionalTransactionInformation?: boolean;
  options?: ScraperOptions;
}

async function getAccountTransactions(opts: GetAccountTxnsOpts): Promise<Transaction[]> {
  const {
    apiSiteUrl,
    accountNumber,
    startDate,
    endDate,
    baseUrl,
    page,
    additionalTransactionInformation = false,
    options,
  } = opts;
  const txnsUrl = `${apiSiteUrl}/current-account/transactions?accountId=${accountNumber}&numItemsPerPage=1000&retrievalEndDate=${endDate}&retrievalStartDate=${startDate}&sortCode=1`;
  const txnsResult = await fetchPoalimXSRFWithinPage(page, txnsUrl, '/current-account/transactions');
  const finalResult =
    additionalTransactionInformation && txnsResult?.transactions.length
      ? await getExtraScrap({ txnsResult, baseUrl, page, accountNumber })
      : txnsResult;
  return convertTransactions(finalResult?.transactions ?? [], options);
}

async function getAccountBalance(apiSiteUrl: string, page: Page, accountNumber: string): Promise<number | undefined> {
  const balanceAndCreditLimitUrl = `${apiSiteUrl}/current-account/composite/balanceAndCreditLimit?accountId=${accountNumber}&view=details&lang=he`;
  const balanceAndCreditLimit = await fetchGetWithinPage<BalanceAndCreditLimit>(page, balanceAndCreditLimitUrl);

  return balanceAndCreditLimit?.currentBalance;
}

interface FetchOneAccountOpts {
  page: Page;
  baseUrl: string;
  apiSiteUrl: string;
  account: FetchedAccountData[0];
  dateOpts: { startDateStr: string; endDateStr: string };
  options: ScraperOptions;
}

async function fetchOneAccount(
  opts: FetchOneAccountOpts,
): Promise<{ accountNumber: string; balance: number | undefined; txns: Transaction[] }> {
  const { page, baseUrl, apiSiteUrl, account, dateOpts, options } = opts;
  const accountNumber = `${account.bankNumber}-${account.branchNumber}-${account.accountNumber}`;
  debug('getting information for account %s', accountNumber);
  const balance = await getAccountBalance(apiSiteUrl, page, accountNumber);
  const txns = await getAccountTransactions({
    baseUrl,
    apiSiteUrl,
    page,
    accountNumber,
    startDate: dateOpts.startDateStr,
    endDate: dateOpts.endDateStr,
    additionalTransactionInformation: options.additionalTransactionInformation,
    options,
  });
  return { accountNumber, balance, txns };
}

async function fetchOpenAccounts(page: Page, baseUrl: string): Promise<FetchedAccountData> {
  const accountsInfo =
    (await fetchGetWithinPage<FetchedAccountData>(page, `${baseUrl}/ServerServices/general/accounts`)) || [];
  const openAccountsInfo = accountsInfo.filter(account => account.accountClosingReasonCode === 0);
  debug(
    'got %d open accounts from %d total accounts, fetching txns and balance',
    openAccountsInfo.length,
    accountsInfo.length,
  );
  return openAccountsInfo;
}

async function fetchAccountData(
  page: Page,
  baseUrl: string,
  options: ScraperOptions,
): Promise<{
  success: boolean;
  accounts: { accountNumber: string; balance: number | undefined; txns: Transaction[] }[];
}> {
  const restContext = await getRestContext(page);
  const apiSiteUrl = `${baseUrl}/${restContext}`;
  const openAccountsInfo = await fetchOpenAccounts(page, baseUrl);
  const defaultStartMoment = moment().subtract(1, 'years').add(1, 'day');
  const startMoment = moment.max(defaultStartMoment, moment(options.startDate || defaultStartMoment.toDate()));
  const dateOpts = { startDateStr: startMoment.format(DATE_FORMAT), endDateStr: moment().format(DATE_FORMAT) };
  const accounts = await Promise.all(
    openAccountsInfo.map(acc => fetchOneAccount({ page, baseUrl, apiSiteUrl, account: acc, dateOpts, options })),
  );
  debug('fetching ended');
  return { success: true, accounts };
}

type ScraperSpecificCredentials = { userCode: string; password: string };

class HapoalimScraper extends GenericBankScraper<ScraperSpecificCredentials> {
  get baseUrl(): string {
    return 'https://login.bankhapoalim.co.il';
  }

  constructor(options: ScraperOptions) {
    super(options, BANK_REGISTRY[CompanyTypes.hapoalim]!);
  }

  async fetchData(): Promise<{
    success: boolean;
    accounts: { accountNumber: string; balance: number | undefined; txns: Transaction[] }[];
  }> {
    return fetchAccountData(this.page, this.baseUrl, this.options);
  }
}

export default HapoalimScraper;
