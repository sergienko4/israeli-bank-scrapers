import moment, { type Moment } from 'moment';
import { type Page } from 'playwright';

import getAllMonthMoments from '../../Common/Dates';
import { getDebug } from '../../Common/Debug';
import { fetchGetWithinPage } from '../../Common/Fetch';
import {
  filterOldTransactions,
  fixInstallments,
  getRawTransaction,
  sortTransactionsByDate,
} from '../../Common/Transactions';
import { DOLLAR_CURRENCY, EURO_CURRENCY, SHEKEL_CURRENCY } from '../../Constants';
import { CompanyTypes } from '../../Definitions';
import { type Transaction, TransactionStatuses, TransactionTypes } from '../../Transactions';
import type { LoginOptions } from '../Base/BaseScraperWithBrowser';
import { GenericBankScraper } from '../Base/GenericBankScraper';
import { type ScraperOptions } from '../Base/Interface';
import { SCRAPER_CONFIGURATION } from '../Registry/ScraperConfig';
import { MAX_CONFIG, maxHandleSecondLoginStep } from './MaxLoginConfig';

const LOG = getDebug('max');

export type { ScrapedTransaction } from './MaxTypes';
import { MaxPlanName, type ScrapedTransaction } from './MaxTypes';

const BASE_API_ACTIONS_URL = SCRAPER_CONFIGURATION.banks[CompanyTypes.Max].api.base;

const CATEGORIES = new Map<number, string>();

/**
 * Builds the Max API URL for fetching transactions for a given billing month.
 *
 * @param monthMoment - the billing month to fetch transactions for
 * @returns the full API URL with filterData query parameter
 */
function getTransactionsUrl(monthMoment: Moment): string {
  const month = monthMoment.month() + 1;
  const year = monthMoment.year();
  const date = `${String(year)}-${String(month)}-01`;

  /**
   * url explanation:
   * userIndex: -1 for all account owners
   * cardIndex: -1 for all cards under the account
   * all other query params are static, beside the date which changes for request per month
   */
  const url = new URL(
    `${BASE_API_ACTIONS_URL}/api/registered/transactionDetails/getTransactionsAndGraphs`,
  );
  const filterData =
    `{"userIndex":-1,"cardIndex":-1,"monthView":true,"date":"${date}",` +
    '"dates":{"startDate":"0","endDate":"0"},"bankAccount":{"bankAccountIndex":-1,"cards":null}}';
  url.searchParams.set('filterData', filterData);
  url.searchParams.set('firstCallCardIndex', '-1');
  return url.toString();
}

export interface FetchCategoryResult {
  result?: {
    id: number;
    name: string;
  }[];
}

/**
 * Fetches and caches transaction category names from the Max API.
 *
 * @param page - the Playwright page with an active Max session
 */
async function loadCategories(page: Page): Promise<void> {
  LOG.info('Loading categories');
  const res = await fetchGetWithinPage<FetchCategoryResult>(
    page,
    `${BASE_API_ACTIONS_URL}/api/contents/getCategories`,
  );
  if (res && Array.isArray(res.result)) {
    LOG.info(`${String(res.result.length)} categories loaded`);
    res.result.forEach(({ id, name }) => CATEGORIES.set(id, name));
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

const PLAN_ID_MAP: Record<number, TransactionTypes> = {
  2: TransactionTypes.Installments,
  3: TransactionTypes.Installments,
  5: TransactionTypes.Normal,
};

/**
 * Determines the transaction type from the Max plan name and plan type ID.
 *
 * @param planName - the raw plan name string from the API
 * @param planTypeId - the numeric plan type ID
 * @returns the TransactionType (Normal or Installments)
 */
function getTransactionType(planName: string, planTypeId: number): TransactionTypes {
  const cleanedUpTxnTypeStr = planName.replaceAll('\t', ' ').trim() as MaxPlanName;
  const byName = PLAN_TYPE_MAP[cleanedUpTxnTypeStr];
  if (byName !== undefined) return byName;
  const byId = PLAN_ID_MAP[planTypeId];
  return byId;
}

/**
 * Parses installment plan information from the Max transaction comments field.
 *
 * @param comments - the raw comments string from the API
 * @returns installment info (current number and total) if this is an installment, otherwise undefined
 */
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

/**
 * Maps a Max API currency ID to the standard currency code string.
 *
 * @param currencyId - the numeric currency ID from the Max API
 * @returns the currency code (ILS, USD, EUR) or undefined if not recognized
 */
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

/**
 * Builds the transaction memo from funds transfer fields or comments.
 *
 * @param memoFields - the relevant fields from a scraped Max transaction
 * @param memoFields.comments - general transaction comments
 * @param memoFields.fundsTransferReceiverOrTransfer - receiver or transfer label for fund transfers
 * @param memoFields.fundsTransferComment - additional comment for fund transfers
 * @returns the constructed memo string
 */
export function getMemo({
  comments,
  fundsTransferReceiverOrTransfer,
  fundsTransferComment,
}: Pick<
  ScrapedTransaction,
  'comments' | 'fundsTransferReceiverOrTransfer' | 'fundsTransferComment'
>): string {
  if (fundsTransferReceiverOrTransfer) {
    const memo = comments
      ? `${comments} ${fundsTransferReceiverOrTransfer}`
      : fundsTransferReceiverOrTransfer;
    return fundsTransferComment ? `${memo}: ${fundsTransferComment}` : memo;
  }

  return comments;
}

/**
 * Builds a unique transaction identifier from the ARN and installment number.
 *
 * @param rawTransaction - the raw scraped transaction
 * @param installments - the parsed installment info (if applicable)
 * @returns a unique identifier string or undefined if ARN is unavailable
 */
function getTxnIdentifier(
  rawTransaction: ScrapedTransaction,
  installments: ReturnType<typeof getInstallmentsInfo>,
): string | undefined {
  return installments
    ? `${rawTransaction.dealData?.arn ?? ''}_${String(installments.number)}`
    : rawTransaction.dealData?.arn;
}

/**
 * Extracts the purchase and payment dates from a scraped Max transaction.
 *
 * @param raw - the raw scraped transaction
 * @returns ISO date strings for the transaction date and processed date
 */
function buildTxnDates(raw: ScrapedTransaction): { date: string; processedDate: string } {
  const isPending = raw.paymentDate === null;
  return {
    date: moment(raw.purchaseDate).toISOString(),
    processedDate: moment(isPending ? raw.purchaseDate : raw.paymentDate).toISOString(),
  };
}

/**
 * Builds the core Transaction fields from a raw Max transaction (without rawTransaction).
 *
 * @param rawTransaction - the raw scraped transaction from the Max API
 * @returns a Transaction object without the rawTransaction field
 */
function buildTxnBase(rawTransaction: ScrapedTransaction): Omit<Transaction, 'rawTransaction'> {
  const isPending = rawTransaction.paymentDate === null;
  const installments = getInstallmentsInfo(rawTransaction.comments);
  return {
    type: getTransactionType(rawTransaction.planName, rawTransaction.planTypeId),
    ...buildTxnDates(rawTransaction),
    originalAmount: -rawTransaction.originalAmount,
    originalCurrency: rawTransaction.originalCurrency,
    chargedAmount: -parseFloat(rawTransaction.actualPaymentAmount),
    chargedCurrency: getChargedCurrency(rawTransaction.paymentCurrency),
    description: rawTransaction.merchantName.trim(),
    memo: getMemo(rawTransaction),
    category: CATEGORIES.get(rawTransaction.categoryId),
    installments,
    identifier: getTxnIdentifier(rawTransaction, installments),
    status: isPending ? TransactionStatuses.Pending : TransactionStatuses.Completed,
  };
}

/**
 * Converts a raw Max transaction to a normalized Transaction, optionally including raw data.
 *
 * @param rawTransaction - the raw scraped transaction from the Max API
 * @param options - scraper options controlling rawTransaction inclusion
 * @returns a complete Transaction object
 */
function mapTransaction(rawTransaction: ScrapedTransaction, options?: ScraperOptions): Transaction {
  const result: Transaction = buildTxnBase(rawTransaction);
  if (options?.includeRawTransaction) result.rawTransaction = getRawTransaction(rawTransaction);
  return result;
}
export interface ScrapedTransactionsResult {
  result?: {
    transactions: ScrapedTransaction[];
  };
}

/**
 * Fetches and maps all transactions for a given billing month from the Max API.
 *
 * @param page - the Playwright page with an active Max session
 * @param monthMoment - the billing month to fetch transactions for
 * @param options - scraper options controlling rawTransaction inclusion
 * @returns a map of card number to transactions for the given month
 */
async function fetchTransactionsForMonth(
  page: Page,
  monthMoment: Moment,
  options?: ScraperOptions,
): Promise<Record<string, Transaction[]>> {
  const url = getTransactionsUrl(monthMoment);

  const data = await fetchGetWithinPage<ScrapedTransactionsResult>(page, url);
  const transactionsByAccount: Record<string, Transaction[]> = {};

  if (!data?.result) return transactionsByAccount;

  data.result.transactions
    // Filter out non-transactions without a plan type, e.g. summary rows
    .filter(transaction => !!transaction.planName)
    .forEach((transaction: ScrapedTransaction) => {
      const mappedTransaction = mapTransaction(transaction, options);
      (transactionsByAccount[transaction.shortCardNumber] ??= []).push(mappedTransaction);
    });

  return transactionsByAccount;
}

/**
 * Merges a monthly result map into the accumulator map.
 *
 * @param allResults - the accumulated card-to-transactions map
 * @param result - the per-month result to merge in
 * @returns a new merged map with all transactions combined
 */
function addResult(
  allResults: Record<string, Transaction[]>,
  result: Record<string, Transaction[]>,
): Record<string, Transaction[]> {
  const clonedResults: Record<string, Transaction[]> = { ...allResults };
  Object.keys(result).forEach(accountNumber => {
    (clonedResults[accountNumber] ??= []).push(...result[accountNumber]);
  });
  return clonedResults;
}

export interface PrepareOpts {
  txns: Transaction[];
  startMoment: moment.Moment;
  shouldCombineInstallments: boolean;
  isFilterByDateEnabled: boolean;
}

/**
 * Applies installment fix, date sort, and date filtering to a list of transactions.
 *
 * @param opts - preparation options including transactions, start date, and filtering settings
 * @returns the prepared and filtered transaction list
 */
function prepareTransactions(opts: PrepareOpts): Transaction[] {
  const { txns, startMoment, shouldCombineInstallments, isFilterByDateEnabled } = opts;
  let clonedTxns = Array.from(txns);
  if (!shouldCombineInstallments) clonedTxns = fixInstallments(clonedTxns);
  clonedTxns = sortTransactionsByDate(clonedTxns);
  return isFilterByDateEnabled
    ? filterOldTransactions(clonedTxns, startMoment, shouldCombineInstallments || false)
    : clonedTxns;
}

/**
 * Fetches and merges transaction results for all billing months.
 *
 * @param page - the Playwright page with an active Max session
 * @param allMonths - the list of billing months to fetch
 * @param options - scraper options controlling rawTransaction inclusion
 * @returns a merged map of card number to all transactions across all months
 */
async function collectAllMonthResults(
  page: Page,
  allMonths: Moment[],
  options: ScraperOptions,
): Promise<Record<string, Transaction[]>> {
  const initialResults = Promise.resolve({} as Record<string, Transaction[]>);
  return allMonths.reduce(async (prevPromise, month) => {
    const prev = await prevPromise;
    return addResult(prev, await fetchTransactionsForMonth(page, month, options));
  }, initialResults);
}

/**
 * Applies installment fix, sort, and date filtering to all accounts in-place.
 *
 * @param allResults - the map of card numbers to transaction arrays (mutated in-place)
 * @param startMoment - the earliest transaction date to retain
 * @param options - scraper options for shouldCombineInstallments and isFilterByDateEnabled
 */
function applyPrepareToAllAccounts(
  allResults: Record<string, Transaction[]>,
  startMoment: moment.Moment,
  options: ScraperOptions,
): void {
  const shouldCombineInstallments = options.shouldCombineInstallments ?? false;
  const isFilterByDateEnabled = options.outputData?.isFilterByDateEnabled ?? true;
  Object.keys(allResults).forEach(accountNumber => {
    allResults[accountNumber] = prepareTransactions({
      txns: allResults[accountNumber],
      startMoment,
      shouldCombineInstallments,
      isFilterByDateEnabled,
    });
  });
}

/**
 * Orchestrates the full Max transaction fetch: categories → months → prepare → return.
 *
 * @param page - the Playwright page with an active Max session
 * @param options - scraper options for date range, installments, and filtering
 * @returns a map of card number to all prepared transactions
 */
async function fetchTransactions(
  page: Page,
  options: ScraperOptions,
): Promise<Record<string, Transaction[]>> {
  const futureMonthsToScrape = options.futureMonthsToScrape ?? 1;
  const defaultStartMoment = moment().subtract(4, 'years');
  const optionsStartMoment = moment(options.startDate);
  const startMoment = moment.max(defaultStartMoment, optionsStartMoment);
  const allMonths = getAllMonthMoments(startMoment, futureMonthsToScrape);
  await loadCategories(page);
  const allResults = await collectAllMonthResults(page, allMonths, options);
  applyPrepareToAllAccounts(allResults, startMoment, options);
  return allResults;
}

/**
 * Max has two login flows:
 *  - Flow A (common):     home → username+password → dashboard
 *  - Flow B (occasional): home → username+password → 2nd form (username+password+id) → dashboard
 * Provide `id` (Israeli national ID / ת.ז.) so Flow B is handled automatically.
 */
export interface ScraperSpecificCredentials {
  username: string;
  password: string;
  id?: string;
}

/** Scraper implementation for Max (מקס) credit card. */
class MaxScraper extends GenericBankScraper<ScraperSpecificCredentials> {
  /**
   * Creates a MaxScraper with the Max login configuration.
   *
   * @param options - scraper options including companyId and timeouts
   */
  constructor(options: ScraperOptions) {
    super(options, MAX_CONFIG);
  }

  /**
   * Returns login options augmented with the maxHandleSecondLoginStep for Flow B.
   *
   * @param credentials - Max credentials including optional national ID for Flow B
   * @returns login options with an extended postAction for the second login step
   */
  public override getLoginOptions(credentials: ScraperSpecificCredentials): LoginOptions {
    const opts = super.getLoginOptions(credentials);
    const original = opts.postAction;
    return {
      ...opts,
      /** Handles the optional Flow B second-login step before the original postAction. */
      postAction: async (): Promise<void> => {
        await maxHandleSecondLoginStep(this.page, credentials);
        if (original) await original();
      },
    };
  }

  /**
   * Fetches transactions for all Max card accounts.
   *
   * @returns a successful scraping result with all card account transactions
   */
  public async fetchData(): Promise<{
    success: boolean;
    accounts: { accountNumber: string; txns: Transaction[] }[];
  }> {
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
