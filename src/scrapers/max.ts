import moment, { type Moment } from 'moment';
import { type Page } from 'playwright';
import { DOLLAR_CURRENCY, EURO_CURRENCY, SHEKEL_CURRENCY } from '../constants';
import getAllMonthMoments from '../helpers/dates';
import { getDebug } from '../helpers/debug';
import { fetchGetWithinPage } from '../helpers/fetch';
import {
  filterOldTransactions,
  fixInstallments,
  sortTransactionsByDate,
  getRawTransaction,
} from '../helpers/transactions';
import { TransactionStatuses, TransactionTypes, type Transaction } from '../transactions';
import { type ScraperOptions } from './interface';
import { CompanyTypes } from '../definitions';
import { BANK_REGISTRY } from './bank-registry';
import { GenericBankScraper } from './generic-bank-scraper';

const debug = getDebug('max');

export interface ScrapedTransaction {
  shortCardNumber: string;
  paymentDate?: string | null;
  purchaseDate: string;
  actualPaymentAmount: string;
  paymentCurrency: number | null;
  originalCurrency: string;
  originalAmount: number;
  planName: string;
  planTypeId: number;
  comments: string;
  merchantName: string;
  categoryId: number;
  fundsTransferComment?: string;
  fundsTransferReceiverOrTransfer?: string;
  dealData?: {
    arn: string;
  };
}

const BASE_API_ACTIONS_URL = 'https://onlinelcapi.max.co.il';

enum MaxPlanName {
  Normal = 'רגילה',
  ImmediateCharge = 'חיוב עסקות מיידי',
  InternetShopping = 'אינטרנט/חו"ל',
  Installments = 'תשלומים',
  MonthlyCharge = 'חיוב חודשי',
  OneMonthPostponed = 'דחוי חודש',
  MonthlyPostponed = 'דחוי לחיוב החודשי',
  MonthlyPayment = 'תשלום חודשי',
  FuturePurchaseFinancing = 'מימון לרכישה עתידית',
  MonthlyPostponedInstallments = 'דחוי חודש תשלומים',
  ThirtyDaysPlus = 'עסקת 30 פלוס',
  TwoMonthsPostponed = 'דחוי חודשיים',
  TwoMonthsPostponed2 = "דחוי 2 ח' תשלומים",
  MonthlyChargePlusInterest = 'חודשי + ריבית',
  Credit = 'קרדיט',
  CreditOutsideTheLimit = 'קרדיט-מחוץ למסגרת',
  AccumulatingBasket = 'סל מצטבר',
  PostponedTransactionInstallments = 'פריסת העסקה הדחויה',
  ReplacementCard = 'כרטיס חליפי',
  EarlyRepayment = 'פרעון מוקדם',
  MonthlyCardFee = 'דמי כרטיס',
  CurrencyPocket = 'חיוב ארנק מטח',
  MonthlyChargeDistribution = 'חלוקת חיוב חודשי',
}

const categories = new Map<number, string>();

function getTransactionsUrl(monthMoment: Moment): string {
  const month = monthMoment.month() + 1;
  const year = monthMoment.year();
  const date = `${year}-${month}-01`;

  /**
   * url explanation:
   * userIndex: -1 for all account owners
   * cardIndex: -1 for all cards under the account
   * all other query params are static, beside the date which changes for request per month
   */
  const url = new URL(`${BASE_API_ACTIONS_URL}/api/registered/transactionDetails/getTransactionsAndGraphs`);
  url.searchParams.set(
    'filterData',
    `{"userIndex":-1,"cardIndex":-1,"monthView":true,"date":"${date}","dates":{"startDate":"0","endDate":"0"},"bankAccount":{"bankAccountIndex":-1,"cards":null}}`,
  );
  url.searchParams.set('firstCallCardIndex', '-1');
  return url.toString();
}

interface FetchCategoryResult {
  result?: Array<{
    id: number;
    name: string;
  }>;
}

async function loadCategories(page: Page): Promise<void> {
  debug('Loading categories');
  const res = await fetchGetWithinPage<FetchCategoryResult>(page, `${BASE_API_ACTIONS_URL}/api/contents/getCategories`);
  if (res && Array.isArray(res.result)) {
    debug(`${res.result.length} categories loaded`);
    res.result?.forEach(({ id, name }) => categories.set(id, name));
  }
}

const PLAN_TYPE_MAP: Partial<Record<MaxPlanName, TransactionTypes>> = {
  [MaxPlanName.ImmediateCharge]: TransactionTypes.Normal,
  [MaxPlanName.Normal]: TransactionTypes.Normal,
  [MaxPlanName.MonthlyCharge]: TransactionTypes.Normal,
  [MaxPlanName.OneMonthPostponed]: TransactionTypes.Normal,
  [MaxPlanName.MonthlyPostponed]: TransactionTypes.Normal,
  [MaxPlanName.FuturePurchaseFinancing]: TransactionTypes.Normal,
  [MaxPlanName.MonthlyPayment]: TransactionTypes.Normal,
  [MaxPlanName.MonthlyPostponedInstallments]: TransactionTypes.Normal,
  [MaxPlanName.ThirtyDaysPlus]: TransactionTypes.Normal,
  [MaxPlanName.TwoMonthsPostponed]: TransactionTypes.Normal,
  [MaxPlanName.TwoMonthsPostponed2]: TransactionTypes.Normal,
  [MaxPlanName.AccumulatingBasket]: TransactionTypes.Normal,
  [MaxPlanName.InternetShopping]: TransactionTypes.Normal,
  [MaxPlanName.MonthlyChargePlusInterest]: TransactionTypes.Normal,
  [MaxPlanName.PostponedTransactionInstallments]: TransactionTypes.Normal,
  [MaxPlanName.ReplacementCard]: TransactionTypes.Normal,
  [MaxPlanName.EarlyRepayment]: TransactionTypes.Normal,
  [MaxPlanName.MonthlyCardFee]: TransactionTypes.Normal,
  [MaxPlanName.CurrencyPocket]: TransactionTypes.Normal,
  [MaxPlanName.MonthlyChargeDistribution]: TransactionTypes.Normal,
  [MaxPlanName.Installments]: TransactionTypes.Installments,
  [MaxPlanName.Credit]: TransactionTypes.Installments,
  [MaxPlanName.CreditOutsideTheLimit]: TransactionTypes.Installments,
};

const PLAN_ID_MAP: Record<number, TransactionTypes> = { 2: TransactionTypes.Installments, 3: TransactionTypes.Installments, 5: TransactionTypes.Normal };

function getTransactionType(planName: string, planTypeId: number): TransactionTypes {
  const cleanedUpTxnTypeStr = planName.replaceAll('\t', ' ').trim() as MaxPlanName;
  const byName = PLAN_TYPE_MAP[cleanedUpTxnTypeStr];
  if (byName !== undefined) return byName;
  const byId = PLAN_ID_MAP[planTypeId];
  if (byId !== undefined) return byId;
  throw new Error(`Unknown transaction type ${cleanedUpTxnTypeStr as string}`);
}

function getInstallmentsInfo(comments: string): { number: number; total: number } | undefined {
  if (!comments) {
    return undefined;
  }
  const matches = comments.match(/\d+/g);
  if (!matches || matches.length < 2) {
    return undefined;
  }

  return {
    number: parseInt(matches[0], 10),
    total: parseInt(matches[1], 10),
  };
}

function getChargedCurrency(currencyId: number | null): string | undefined {
  switch (currencyId) {
    case 376:
      return SHEKEL_CURRENCY;
    case 840:
      return DOLLAR_CURRENCY;
    case 978:
      return EURO_CURRENCY;
    default:
      return undefined;
  }
}

export function getMemo({
  comments,
  fundsTransferReceiverOrTransfer,
  fundsTransferComment,
}: Pick<ScrapedTransaction, 'comments' | 'fundsTransferReceiverOrTransfer' | 'fundsTransferComment'>): string {
  if (fundsTransferReceiverOrTransfer) {
    const memo = comments ? `${comments} ${fundsTransferReceiverOrTransfer}` : fundsTransferReceiverOrTransfer;
    return fundsTransferComment ? `${memo}: ${fundsTransferComment}` : memo;
  }

  return comments;
}

function buildTxnBase(rawTransaction: ScrapedTransaction): Omit<Transaction, 'rawTransaction'> {
  const isPending = rawTransaction.paymentDate === null;
  const installments = getInstallmentsInfo(rawTransaction.comments);
  return {
    type: getTransactionType(rawTransaction.planName, rawTransaction.planTypeId),
    date: moment(rawTransaction.purchaseDate).toISOString(),
    processedDate: moment(isPending ? rawTransaction.purchaseDate : rawTransaction.paymentDate).toISOString(),
    originalAmount: -rawTransaction.originalAmount,
    originalCurrency: rawTransaction.originalCurrency,
    chargedAmount: -rawTransaction.actualPaymentAmount,
    chargedCurrency: getChargedCurrency(rawTransaction.paymentCurrency),
    description: rawTransaction.merchantName.trim(),
    memo: getMemo(rawTransaction),
    category: categories.get(rawTransaction?.categoryId),
    installments,
    identifier: installments ? `${rawTransaction.dealData?.arn}_${installments.number}` : rawTransaction.dealData?.arn,
    status: isPending ? TransactionStatuses.Pending : TransactionStatuses.Completed,
  };
}

function mapTransaction(rawTransaction: ScrapedTransaction, options?: ScraperOptions): Transaction {
  const result: Transaction = buildTxnBase(rawTransaction);
  if (options?.includeRawTransaction) result.rawTransaction = getRawTransaction(rawTransaction);
  return result;
}
interface ScrapedTransactionsResult {
  result?: {
    transactions: ScrapedTransaction[];
  };
}

async function fetchTransactionsForMonth(page: Page, monthMoment: Moment, options?: ScraperOptions): Promise<Record<string, Transaction[]>> {
  const url = getTransactionsUrl(monthMoment);

  const data = await fetchGetWithinPage<ScrapedTransactionsResult>(page, url);
  const transactionsByAccount: Record<string, Transaction[]> = {};

  if (!data || !data.result) return transactionsByAccount;

  data.result.transactions
    // Filter out non-transactions without a plan type, e.g. summary rows
    .filter(transaction => !!transaction.planName)
    .forEach((transaction: ScrapedTransaction) => {
      if (!transactionsByAccount[transaction.shortCardNumber]) {
        transactionsByAccount[transaction.shortCardNumber] = [];
      }

      const mappedTransaction = mapTransaction(transaction, options);
      transactionsByAccount[transaction.shortCardNumber].push(mappedTransaction);
    });

  return transactionsByAccount;
}

function addResult(allResults: Record<string, Transaction[]>, result: Record<string, Transaction[]>): Record<string, Transaction[]> {
  const clonedResults: Record<string, Transaction[]> = { ...allResults };
  Object.keys(result).forEach(accountNumber => {
    if (!clonedResults[accountNumber]) {
      clonedResults[accountNumber] = [];
    }
    clonedResults[accountNumber].push(...result[accountNumber]);
  });
  return clonedResults;
}

interface PrepareOpts {
  txns: Transaction[];
  startMoment: moment.Moment;
  combineInstallments: boolean;
  enableTransactionsFilterByDate: boolean;
}

function prepareTransactions(opts: PrepareOpts): Transaction[] {
  const { txns, startMoment, combineInstallments, enableTransactionsFilterByDate } = opts;
  let clonedTxns = Array.from(txns);
  if (!combineInstallments) clonedTxns = fixInstallments(clonedTxns);
  clonedTxns = sortTransactionsByDate(clonedTxns);
  return enableTransactionsFilterByDate ? filterOldTransactions(clonedTxns, startMoment, combineInstallments || false) : clonedTxns;
}

async function collectAllMonthResults(page: Page, allMonths: Moment[], options: ScraperOptions): Promise<Record<string, Transaction[]>> {
  let allResults: Record<string, Transaction[]> = {};
  for (const month of allMonths) {
    allResults = addResult(allResults, await fetchTransactionsForMonth(page, month, options));
  }
  return allResults;
}

async function fetchTransactions(page: Page, options: ScraperOptions): Promise<Record<string, Transaction[]>> {
  const futureMonthsToScrape = options.futureMonthsToScrape ?? 1;
  const defaultStartMoment = moment().subtract(1, 'years');
  const startMoment = moment.max(moment().subtract(4, 'years'), moment(options.startDate || defaultStartMoment.toDate()));
  const allMonths = getAllMonthMoments(startMoment, futureMonthsToScrape);
  await loadCategories(page);
  const allResults = await collectAllMonthResults(page, allMonths, options);
  const combineInstallments = options.combineInstallments || false;
  const enableTransactionsFilterByDate = options.outputData?.enableTransactionsFilterByDate ?? true;
  Object.keys(allResults).forEach(accountNumber => {
    allResults[accountNumber] = prepareTransactions({ txns: allResults[accountNumber], startMoment, combineInstallments, enableTransactionsFilterByDate });
  });
  return allResults;
}

type ScraperSpecificCredentials = { username: string; password: string };

class MaxScraper extends GenericBankScraper<ScraperSpecificCredentials> {
  constructor(options: ScraperOptions) {
    super(options, BANK_REGISTRY[CompanyTypes.max]!);
  }

  async fetchData(): Promise<{ success: boolean; accounts: { accountNumber: string; txns: Transaction[] }[] }> {
    const results = await fetchTransactions(this.page, this.options);
    const accounts = Object.keys(results).map(accountNumber => {
      return {
        accountNumber,
        txns: results[accountNumber],
      };
    });

    return {
      success: true,
      accounts,
    };
  }
}

export default MaxScraper;
