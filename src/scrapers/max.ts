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
  paymentDate?: string;
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

function getTransactionsUrl(monthMoment: Moment) {
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

async function loadCategories(page: Page) {
  debug('Loading categories');
  const res = await fetchGetWithinPage<FetchCategoryResult>(page, `${BASE_API_ACTIONS_URL}/api/contents/getCategories`);
  if (res && Array.isArray(res.result)) {
    debug(`${res.result.length} categories loaded`);
    res.result?.forEach(({ id, name }) => categories.set(id, name));
  }
}

function getTransactionType(planName: string, planTypeId: number) {
  const cleanedUpTxnTypeStr = planName.replaceAll('\t', ' ').trim() as MaxPlanName;
  switch (cleanedUpTxnTypeStr) {
    case MaxPlanName.ImmediateCharge:
    case MaxPlanName.Normal:
    case MaxPlanName.MonthlyCharge:
    case MaxPlanName.OneMonthPostponed:
    case MaxPlanName.MonthlyPostponed:
    case MaxPlanName.FuturePurchaseFinancing:
    case MaxPlanName.MonthlyPayment:
    case MaxPlanName.MonthlyPostponedInstallments:
    case MaxPlanName.ThirtyDaysPlus:
    case MaxPlanName.TwoMonthsPostponed:
    case MaxPlanName.TwoMonthsPostponed2:
    case MaxPlanName.AccumulatingBasket:
    case MaxPlanName.InternetShopping:
    case MaxPlanName.MonthlyChargePlusInterest:
    case MaxPlanName.PostponedTransactionInstallments:
    case MaxPlanName.ReplacementCard:
    case MaxPlanName.EarlyRepayment:
    case MaxPlanName.MonthlyCardFee:
    case MaxPlanName.CurrencyPocket:
    case MaxPlanName.MonthlyChargeDistribution:
      return TransactionTypes.Normal;
    case MaxPlanName.Installments:
    case MaxPlanName.Credit:
    case MaxPlanName.CreditOutsideTheLimit:
      return TransactionTypes.Installments;
    default:
      switch (planTypeId) {
        case 2:
        case 3:
          return TransactionTypes.Installments;
        case 5:
          return TransactionTypes.Normal;
        default:
          throw new Error(`Unknown transaction type ${cleanedUpTxnTypeStr as string}`);
      }
  }
}

function getInstallmentsInfo(comments: string) {
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

function getChargedCurrency(currencyId: number | null) {
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
}: Pick<ScrapedTransaction, 'comments' | 'fundsTransferReceiverOrTransfer' | 'fundsTransferComment'>) {
  if (fundsTransferReceiverOrTransfer) {
    const memo = comments ? `${comments} ${fundsTransferReceiverOrTransfer}` : fundsTransferReceiverOrTransfer;
    return fundsTransferComment ? `${memo}: ${fundsTransferComment}` : memo;
  }

  return comments;
}

function mapTransaction(rawTransaction: ScrapedTransaction, options?: ScraperOptions): Transaction {
  const isPending = rawTransaction.paymentDate === null;
  const processedDate = moment(isPending ? rawTransaction.purchaseDate : rawTransaction.paymentDate).toISOString();
  const status = isPending ? TransactionStatuses.Pending : TransactionStatuses.Completed;

  const installments = getInstallmentsInfo(rawTransaction.comments);
  const identifier = installments
    ? `${rawTransaction.dealData?.arn}_${installments.number}`
    : rawTransaction.dealData?.arn;

  const result: Transaction = {
    type: getTransactionType(rawTransaction.planName, rawTransaction.planTypeId),
    date: moment(rawTransaction.purchaseDate).toISOString(),
    processedDate,
    originalAmount: -rawTransaction.originalAmount,
    originalCurrency: rawTransaction.originalCurrency,
    chargedAmount: -rawTransaction.actualPaymentAmount,
    chargedCurrency: getChargedCurrency(rawTransaction.paymentCurrency),
    description: rawTransaction.merchantName.trim(),
    memo: getMemo(rawTransaction),
    category: categories.get(rawTransaction?.categoryId),
    installments,
    identifier,
    status,
  };

  if (options?.includeRawTransaction) {
    result.rawTransaction = getRawTransaction(rawTransaction);
  }

  return result;
}
interface ScrapedTransactionsResult {
  result?: {
    transactions: ScrapedTransaction[];
  };
}

async function fetchTransactionsForMonth(page: Page, monthMoment: Moment, options?: ScraperOptions) {
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

function addResult(allResults: Record<string, Transaction[]>, result: Record<string, Transaction[]>) {
  const clonedResults: Record<string, Transaction[]> = { ...allResults };
  Object.keys(result).forEach(accountNumber => {
    if (!clonedResults[accountNumber]) {
      clonedResults[accountNumber] = [];
    }
    clonedResults[accountNumber].push(...result[accountNumber]);
  });
  return clonedResults;
}

function prepareTransactions(
  txns: Transaction[],
  startMoment: moment.Moment,
  combineInstallments: boolean,
  enableTransactionsFilterByDate: boolean,
) {
  let clonedTxns = Array.from(txns);
  if (!combineInstallments) {
    clonedTxns = fixInstallments(clonedTxns);
  }
  clonedTxns = sortTransactionsByDate(clonedTxns);
  clonedTxns = enableTransactionsFilterByDate
    ? filterOldTransactions(clonedTxns, startMoment, combineInstallments || false)
    : clonedTxns;
  return clonedTxns;
}

async function fetchTransactions(page: Page, options: ScraperOptions) {
  const futureMonthsToScrape = options.futureMonthsToScrape ?? 1;
  const defaultStartMoment = moment().subtract(1, 'years');
  const startMomentLimit = moment().subtract(4, 'years');
  const startDate = options.startDate || defaultStartMoment.toDate();
  const startMoment = moment.max(startMomentLimit, moment(startDate));
  const allMonths = getAllMonthMoments(startMoment, futureMonthsToScrape);

  await loadCategories(page);

  let allResults: Record<string, Transaction[]> = {};
  for (let i = 0; i < allMonths.length; i += 1) {
    const result = await fetchTransactionsForMonth(page, allMonths[i], options);
    allResults = addResult(allResults, result);
  }

  Object.keys(allResults).forEach(accountNumber => {
    let txns = allResults[accountNumber];
    txns = prepareTransactions(
      txns,
      startMoment,
      options.combineInstallments || false,
      options.outputData?.enableTransactionsFilterByDate ?? true,
    );
    allResults[accountNumber] = txns;
  });

  return allResults;
}

type ScraperSpecificCredentials = { username: string; password: string };

class MaxScraper extends GenericBankScraper<ScraperSpecificCredentials> {
  constructor(options: ScraperOptions) {
    super(options, BANK_REGISTRY[CompanyTypes.max]!);
  }

  async fetchData() {
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
