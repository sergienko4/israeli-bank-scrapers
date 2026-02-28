import _ from 'lodash';
import moment, { type Moment } from 'moment';
import { type Page } from 'playwright';
import { ALT_SHEKEL_CURRENCY, SHEKEL_CURRENCY, SHEKEL_CURRENCY_KEYWORD } from '../constants';
import { ScraperProgressTypes } from '../definitions';
import getAllMonthMoments from '../helpers/dates';
import { getDebug } from '../helpers/debug';
import { fetchGetWithinPage, fetchPostWithinPage } from '../helpers/fetch';
import { filterOldTransactions, fixInstallments, getRawTransaction } from '../helpers/transactions';
import { humanDelay, runSerial, sleep } from '../helpers/waiting';
import {
  TransactionStatuses,
  TransactionTypes,
  type Transaction,
  type TransactionInstallments,
} from '../transactions';
import { BaseScraperWithBrowser } from './base-scraper-with-browser';
import { ScraperErrorTypes, WafBlockError } from './errors';
import { type ScraperOptions, type ScraperScrapingResult } from './interface';
import {
  type AdditionalInfoOpts,
  type BuildTxnsOpts,
  type CollectTxnsOpts,
  type ExtraScrapAccountOpts,
  type ExtraScrapTxnOpts,
  type FetchAllOpts,
  type FetchTransactionsOpts,
  type ScrapedAccount,
  type ScrapedAccountsWithIndex,
  type ScrapedAccountsWithinPageResponse,
  type ScrapedCurrentCardTransactions,
  type ScrapedLoginValidation,
  type ScrapedTransaction,
  type ScrapedTransactionData,
} from './base-isracard-amex-types';

const RATE_LIMIT = {
  SLEEP_BETWEEN: 1000,
  TRANSACTIONS_BATCH_SIZE: 10,
} as const;

const COUNTRY_CODE = '212';
const ID_TYPE = '1';
const INSTALLMENTS_KEYWORD = 'תשלום';

const DATE_FORMAT = 'DD/MM/YYYY';

const debug = getDebug('base-isracard-amex');

function getAccountsUrl(servicesUrl: string, monthMoment: Moment) {
  const billingDate = monthMoment.format('YYYY-MM-DD');
  const url = new URL(servicesUrl);
  url.searchParams.set('reqName', 'DashboardMonth');
  url.searchParams.set('actionCode', '0');
  url.searchParams.set('billingDate', billingDate);
  url.searchParams.set('format', 'Json');
  return url.toString();
}

async function fetchAccounts(page: Page, servicesUrl: string, monthMoment: Moment): Promise<ScrapedAccount[]> {
  const dataUrl = getAccountsUrl(servicesUrl, monthMoment);
  debug(`fetching accounts from ${dataUrl}`);
  const dataResult = await fetchGetWithinPage<ScrapedAccountsWithinPageResponse>(page, dataUrl);
  if (dataResult && _.get(dataResult, 'Header.Status') === '1' && dataResult.DashboardMonthBean) {
    const { cardsCharges } = dataResult.DashboardMonthBean;
    if (cardsCharges) {
      return cardsCharges.map(cardCharge => ({
        index: parseInt(cardCharge.cardIndex, 10),
        accountNumber: cardCharge.cardNumber,
        processedDate: moment(cardCharge.billingDate, DATE_FORMAT).toISOString(),
      }));
    }
  }
  return [];
}

function getTransactionsUrl(servicesUrl: string, monthMoment: Moment) {
  const month = monthMoment.month() + 1;
  const year = monthMoment.year();
  const monthStr = month < 10 ? `0${month}` : month.toString();
  const url = new URL(servicesUrl);
  url.searchParams.set('reqName', 'CardsTransactionsList');
  url.searchParams.set('month', monthStr);
  url.searchParams.set('year', `${year}`);
  url.searchParams.set('requiredDate', 'N');
  return url.toString();
}

function convertCurrency(currencyStr: string) {
  return (currencyStr === SHEKEL_CURRENCY_KEYWORD || currencyStr === ALT_SHEKEL_CURRENCY) ? SHEKEL_CURRENCY : currencyStr;
}

function getInstallmentsInfo(txn: ScrapedTransaction): TransactionInstallments | undefined {
  if (!txn.moreInfo || !txn.moreInfo.includes(INSTALLMENTS_KEYWORD)) return undefined;
  const matches = txn.moreInfo.match(/\d+/g);
  if (!matches || matches.length < 2) return undefined;
  return { number: parseInt(matches[0], 10), total: parseInt(matches[1], 10) };
}

function getTransactionType(txn: ScrapedTransaction) {
  return getInstallmentsInfo(txn) ? TransactionTypes.Installments : TransactionTypes.Normal;
}

function buildTransactionBase(txn: ScrapedTransaction, processedDate: string): Omit<Transaction, 'rawTransaction'> {
  const isOutbound = txn.dealSumOutbound;
  const txnDateStr = isOutbound ? txn.fullPurchaseDateOutbound : txn.fullPurchaseDate;
  return {
    type: getTransactionType(txn),
    identifier: parseInt(isOutbound ? txn.voucherNumberRatzOutbound : txn.voucherNumberRatz, 10),
    date: moment(txnDateStr, DATE_FORMAT).toISOString(),
    processedDate: txn.fullPaymentDate ? moment(txn.fullPaymentDate, DATE_FORMAT).toISOString() : processedDate,
    originalAmount: isOutbound ? -txn.dealSumOutbound : -txn.dealSum,
    originalCurrency: convertCurrency(txn.currentPaymentCurrency ?? txn.currencyId),
    chargedAmount: isOutbound ? -txn.paymentSumOutbound : -txn.paymentSum,
    chargedCurrency: convertCurrency(txn.currencyId),
    description: isOutbound ? txn.fullSupplierNameOutbound : txn.fullSupplierNameHeb,
    memo: txn.moreInfo || '',
    installments: getInstallmentsInfo(txn) || undefined,
    status: TransactionStatuses.Completed,
  };
}

function buildTransaction(txn: ScrapedTransaction, processedDate: string, options?: ScraperOptions): Transaction {
  const result: Transaction = buildTransactionBase(txn, processedDate);
  if (options?.includeRawTransaction) result.rawTransaction = getRawTransaction(txn);
  return result;
}

function filterValidTransactions(txns: ScrapedTransaction[]) {
  return txns.filter(
    txn =>
      txn.dealSumType !== '1' &&
      txn.voucherNumberRatz !== '000000000' &&
      txn.voucherNumberRatzOutbound !== '000000000',
  );
}

function convertTransactions(txns: ScrapedTransaction[], processedDate: string, options?: ScraperOptions): Transaction[] {
  return filterValidTransactions(txns).map(txn => buildTransaction(txn, processedDate, options));
}

function collectAccountTxns(opts: CollectTxnsOpts) {
  const { txnGroups, account, options, startMoment } = opts;
  let allTxns: Transaction[] = [];
  txnGroups.forEach(txnGroup => {
    if (txnGroup.txnIsrael) allTxns.push(...convertTransactions(txnGroup.txnIsrael, account.processedDate, options));
    if (txnGroup.txnAbroad) allTxns.push(...convertTransactions(txnGroup.txnAbroad, account.processedDate, options));
  });
  if (!options.combineInstallments) allTxns = fixInstallments(allTxns);
  if (options.outputData?.enableTransactionsFilterByDate ?? true) allTxns = filterOldTransactions(allTxns, startMoment, options.combineInstallments || false);
  return allTxns;
}

function buildAccountTxns(bOpts: BuildTxnsOpts): ScrapedAccountsWithIndex {
  const { accounts, dataResult, options, startMoment } = bOpts;
  const accountTxns: ScrapedAccountsWithIndex = {};
  accounts.forEach(account => {
    const txnGroups: ScrapedCurrentCardTransactions[] | undefined = _.get(dataResult, `CardsTransactionsListBean.Index${account.index}.CurrentCardTransactions`);
    if (txnGroups) accountTxns[account.accountNumber] = { accountNumber: account.accountNumber, index: account.index, txns: collectAccountTxns({ txnGroups, account, options, startMoment }) };
  });
  return accountTxns;
}

async function fetchTransactions(opts: FetchTransactionsOpts): Promise<ScrapedAccountsWithIndex> {
  const { page, companyServiceOptions, monthMoment } = opts;
  const accounts = await fetchAccounts(page, companyServiceOptions.servicesUrl, monthMoment);
  const dataUrl = getTransactionsUrl(companyServiceOptions.servicesUrl, monthMoment);
  await sleep(RATE_LIMIT.SLEEP_BETWEEN);
  debug(`fetching transactions from ${dataUrl} for month ${monthMoment.format('YYYY-MM')}`);
  const dataResult = await fetchGetWithinPage<ScrapedTransactionData>(page, dataUrl);
  if (!dataResult || _.get(dataResult, 'Header.Status') !== '1' || !dataResult.CardsTransactionsListBean) return {};
  return buildAccountTxns({ accounts, dataResult, options: opts.options, startMoment: opts.startMoment });
}

async function getExtraScrapTransaction(opts: ExtraScrapTxnOpts): Promise<Transaction> {
  const { page, options, month, accountIndex, transaction } = opts;
  const url = new URL(options.servicesUrl);
  url.searchParams.set('reqName', 'PirteyIska_204');
  url.searchParams.set('CardIndex', accountIndex.toString());
  url.searchParams.set('shovarRatz', transaction.identifier!.toString());
  url.searchParams.set('moedChiuv', month.format('MMYYYY'));
  debug(`fetching extra scrap for transaction ${transaction.identifier} for month ${month.format('YYYY-MM')}`);
  const data = await fetchGetWithinPage<ScrapedTransactionData>(page, url.toString());
  if (!data) return transaction;
  const rawCategory = _.get(data, 'PirteyIska_204Bean.sector') ?? '';
  return { ...transaction, category: rawCategory.trim(), rawTransaction: getRawTransaction(data, transaction) };
}

async function getExtraScrapAccount(opts: ExtraScrapAccountOpts): Promise<ScrapedAccountsWithIndex> {
  const { page, options, accountMap, month } = opts;
  const accounts: ScrapedAccountsWithIndex[string][] = [];
  for (const account of Object.values(accountMap)) {
    debug(`get extra scrap for ${account.accountNumber} with ${account.txns.length} transactions`, month.format('YYYY-MM'));
    const txns: Transaction[] = [];
    for (const txnsChunk of _.chunk(account.txns, RATE_LIMIT.TRANSACTIONS_BATCH_SIZE)) {
      debug(`processing chunk of ${txnsChunk.length} transactions for account ${account.accountNumber}`);
      const updatedTxns = await Promise.all(
        txnsChunk.map(t => getExtraScrapTransaction({ page, options, month, accountIndex: account.index, transaction: t })),
      );
      await sleep(RATE_LIMIT.SLEEP_BETWEEN);
      txns.push(...updatedTxns);
    }
    accounts.push({ ...account, txns });
  }
  return accounts.reduce((m, x) => ({ ...m, [x.accountNumber]: x }), {});
}

async function getAdditionalTransactionInformation(opts: AdditionalInfoOpts): Promise<ScrapedAccountsWithIndex[]> {
  const { scraperOptions, accountsWithIndex, page, options, allMonths } = opts;
  if (!scraperOptions.additionalTransactionInformation || scraperOptions.optInFeatures?.includes('isracard-amex:skipAdditionalTransactionInformation')) {
    return accountsWithIndex;
  }
  return runSerial(accountsWithIndex.map((a, i) => () => getExtraScrapAccount({ page, options, accountMap: a, month: allMonths[i] })));
}

function combineTxnsFromResults(finalResult: ScrapedAccountsWithIndex[]) {
  const combinedTxns: Record<string, Transaction[]> = {};
  finalResult.forEach(result => {
    Object.keys(result).forEach(accountNumber => {
      if (!combinedTxns[accountNumber]) combinedTxns[accountNumber] = [];
      combinedTxns[accountNumber].push(...result[accountNumber].txns);
    });
  });
  return combinedTxns;
}

async function fetchAllTransactions(opts: FetchAllOpts) {
  const { page, options, companyServiceOptions, startMoment } = opts;
  const futureMonthsToScrape = options.futureMonthsToScrape ?? 1;
  const allMonths = getAllMonthMoments(startMoment, futureMonthsToScrape);
  const results: ScrapedAccountsWithIndex[] = await runSerial(
    allMonths.map(monthMoment => () => fetchTransactions({ page, options, companyServiceOptions, startMoment, monthMoment })),
  );
  const finalResult = await getAdditionalTransactionInformation({ scraperOptions: options, accountsWithIndex: results, page, options: companyServiceOptions, allMonths });
  const combinedTxns = combineTxnsFromResults(finalResult);
  const accounts = Object.keys(combinedTxns).map(accountNumber => ({
    accountNumber,
    txns: combinedTxns[accountNumber],
  }));
  return { success: true, accounts };
}

type ScraperSpecificCredentials = { id: string; password: string; card6Digits: string };

class IsracardAmexBaseScraper extends BaseScraperWithBrowser<ScraperSpecificCredentials> {
  private baseUrl: string;

  private companyCode: string;

  private servicesUrl: string;

  constructor(options: ScraperOptions, baseUrl: string, companyCode: string) {
    super(options);
    this.baseUrl = baseUrl;
    this.companyCode = companyCode;
    this.servicesUrl = `${baseUrl}/services/ProxyRequestHandler.ashx`;
  }

  private async validateCredentials(credentials: ScraperSpecificCredentials) {
    const validateUrl = `${this.servicesUrl}?reqName=ValidateIdData`;
    const validateRequest = { id: credentials.id, cardSuffix: credentials.card6Digits, countryCode: COUNTRY_CODE, idType: ID_TYPE, checkLevel: '1', companyCode: this.companyCode };
    debug('validating credentials');
    const result = await fetchPostWithinPage<ScrapedLoginValidation>(this.page, validateUrl, { data: validateRequest });
    if (!result?.Header || result.Header.Status !== '1' || !result.ValidateIdDataBean) {
      debug('validation failed: result=%s', JSON.stringify(result)?.substring(0, 300) ?? 'null');
      return null;
    }
    return result.ValidateIdDataBean;
  }

  private buildLoginRequest(credentials: ScraperSpecificCredentials, userName: string) {
    return { KodMishtamesh: userName, MisparZihuy: credentials.id, Sisma: credentials.password, cardSuffix: credentials.card6Digits, countryCode: COUNTRY_CODE, idType: ID_TYPE };
  }

  private interpretLoginStatus(status: string | undefined): ScraperScrapingResult {
    if (status === '1') { this.emitProgress(ScraperProgressTypes.LoginSuccess); return { success: true }; }
    if (status === '3') { this.emitProgress(ScraperProgressTypes.ChangePassword); return { success: false, errorType: ScraperErrorTypes.ChangePassword }; }
    this.emitProgress(ScraperProgressTypes.LoginFailed);
    return { success: false, errorType: ScraperErrorTypes.InvalidPassword, errorMessage: `Login failed with status: ${status ?? 'unknown'}` };
  }

  private async performLogin(credentials: ScraperSpecificCredentials, userName: string): Promise<ScraperScrapingResult> {
    const loginUrl = `${this.servicesUrl}?reqName=performLogonI`;
    debug('user login started');
    const loginResult = await fetchPostWithinPage<{ status: string }>(this.page, loginUrl, { data: this.buildLoginRequest(credentials, userName) });
    debug(`user login with status '${loginResult?.status}'`, loginResult);
    return this.interpretLoginStatus(loginResult?.status);
  }

  private handleValidateReturnCode(returnCode: string): ScraperScrapingResult {
    if (returnCode === '4') { this.emitProgress(ScraperProgressTypes.ChangePassword); return { success: false, errorType: ScraperErrorTypes.ChangePassword }; }
    this.emitProgress(ScraperProgressTypes.LoginFailed);
    return { success: false, errorType: ScraperErrorTypes.InvalidPassword, errorMessage: `Validate failed with returnCode: ${returnCode}` };
  }

  private setupResponseLogging() {
    this.page.on('response', response => {
      const url = response.url();
      if (url.includes('ProxyRequestHandler') || url.includes('personalarea')) debug('response: %d %s', response.status(), url.substring(0, 120));
    });
  }

  private async navigateToLoginPage() {
    debug(`navigating to ${this.baseUrl}/personalarea/Login`);
    await this.navigateTo(`${this.baseUrl}/personalarea/Login`);
    await this.page.waitForFunction(() => document.readyState === 'complete');
    await humanDelay(1500, 3000);
    this.emitProgress(ScraperProgressTypes.LoggingIn);
  }

  async login(credentials: ScraperSpecificCredentials): Promise<ScraperScrapingResult> {
    this.setupResponseLogging();
    await this.navigateToLoginPage();
    const validatedData = await this.validateCredentials(credentials);
    if (!validatedData) {
      throw WafBlockError.apiBlock(0, this.page.url(), { pageTitle: await this.page.title(), responseSnippet: 'validateCredentials returned null' });
    }
    const validateReturnCode = validatedData.returnCode;
    debug(`user validate with return code '${validateReturnCode}'`);
    return validateReturnCode === '1' ? this.performLogin(credentials, validatedData.userName ?? '') : this.handleValidateReturnCode(validateReturnCode);
  }

  async fetchData() {
    const defaultStartMoment = moment().subtract(1, 'years');
    const startDate = this.options.startDate || defaultStartMoment.toDate();
    const startMoment = moment.max(defaultStartMoment, moment(startDate));
    return fetchAllTransactions({
      page: this.page,
      options: this.options,
      companyServiceOptions: { servicesUrl: this.servicesUrl, companyCode: this.companyCode },
      startMoment,
    });
  }
}

export default IsracardAmexBaseScraper;
