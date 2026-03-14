import moment, { type Moment } from 'moment';
import { type Page } from 'playwright-core';

import getAllMonthMoments from '../../Common/Dates.js';
import { getDebug } from '../../Common/Debug.js';
import { fetchGetWithinPage } from '../../Common/Fetch.js';
import {
  filterOldTransactions,
  fixInstallments,
  getRawTransaction,
  sortTransactionsByDate,
} from '../../Common/Transactions.js';
import { runSerial } from '../../Common/Waiting.js';
import { DOLLAR_CURRENCY, EURO_CURRENCY, SHEKEL_CURRENCY } from '../../Constants.js';
import { CompanyTypes } from '../../Definitions.js';
import {
  type ITransaction,
  TransactionStatuses,
  type TransactionTypes,
} from '../../Transactions.js';
import { type ScraperOptions } from '../Base/Interface.js';
import { SCRAPER_CONFIGURATION } from '../Registry/Config/ScraperConfig.js';
import {
  type IInstallmentInfo,
  type INoIdentifier,
  type INoInstallment,
  type IScrapedTransaction,
  type IUnknownCurrency,
  type MaxPlanName,
  PLAN_ID_MAP,
  PLAN_TYPE_MAP,
} from './MaxTypes.js';

const LOG = getDebug('max');
const BASE = SCRAPER_CONFIGURATION.banks[CompanyTypes.Max].api.base;
const CATEGORIES = new Map<number, string>();

/** Result shape for Max category API. */
interface ICategoryResult {
  result?: { id: number; name: string }[];
}
/** Shape of the transaction API response. */
interface ITransactionApiResult {
  result?: { transactions: IScrapedTransaction[] };
}

/**
 * Build the Max API URL for a given month.
 * @param monthMoment - The month to build the URL for.
 * @returns The full API URL string.
 */
function getTxnUrl(monthMoment: Moment): string {
  const month = monthMoment.month() + 1;
  const year = monthMoment.year();
  const date = `${String(year)}-${String(month)}-01`;
  const path = `${BASE}/api/registered/transactionDetails`;
  const url = new URL(`${path}/getTransactionsAndGraphs`);
  const filter =
    '{"userIndex":-1,"cardIndex":-1,"monthView":true,' +
    `"date":"${date}","dates":{"startDate":"0","endDate":"0"},` +
    '"bankAccount":{"bankAccountIndex":-1,"cards":null}}';
  url.searchParams.set('filterData', filter);
  url.searchParams.set('firstCallCardIndex', '-1');
  return url.toString();
}

/**
 * Load categories from Max API.
 * @param page - The Playwright page.
 * @returns True after loading.
 */
async function loadCategories(page: Page): Promise<boolean> {
  LOG.debug('Loading categories');
  const catUrl = `${BASE}/api/contents/getCategories`;
  const res = await fetchGetWithinPage<ICategoryResult>(page, catUrl);
  if (res && Array.isArray(res.result)) {
    LOG.debug(`${String(res.result.length)} categories loaded`);
    res.result.forEach(e => CATEGORIES.set(e.id, e.name));
  }
  return true;
}

/**
 * Resolve transaction type from plan name and ID.
 * @param planName - The raw plan name string.
 * @param planTypeId - The numeric plan type ID.
 * @returns The resolved transaction type.
 */
function getTxnType(planName: string, planTypeId: number): TransactionTypes {
  const cleaned = planName.replaceAll('\t', ' ').trim();
  return PLAN_TYPE_MAP[cleaned as MaxPlanName] ?? PLAN_ID_MAP[planTypeId];
}

/**
 * Extract installment info from comments.
 * @param comments - The raw comment string.
 * @returns Parsed installments or empty placeholder.
 */
function getInstallments(comments: string): IInstallmentInfo | INoInstallment {
  if (!comments) return { number: undefined, total: undefined };
  const matches = comments.match(/\d+/g);
  if (!matches || matches.length < 2) return { number: undefined, total: undefined };
  return {
    number: parseInt(matches[0], 10),
    total: parseInt(matches[1], 10),
  };
}

const CURRENCY_MAP = new Map<number, string>([
  [376, SHEKEL_CURRENCY],
  [840, DOLLAR_CURRENCY],
  [978, EURO_CURRENCY],
]);

/**
 * Map a currency ID to its ISO code.
 * @param id - The numeric currency ID.
 * @returns The currency string or fallback.
 */
function getCharged(id: number): string | IUnknownCurrency {
  return CURRENCY_MAP.get(id) ?? { code: undefined };
}

/**
 * Build a memo from transaction fields.
 * @param root0 - The transaction fields.
 * @param root0.comments - Transaction comments.
 * @param root0.fundsTransferReceiverOrTransfer - Receiver.
 * @param root0.fundsTransferComment - Transfer comment.
 * @returns The composed memo string.
 */
export function getMemo({
  comments,
  fundsTransferReceiverOrTransfer,
  fundsTransferComment,
}: Pick<
  IScrapedTransaction,
  'comments' | 'fundsTransferReceiverOrTransfer' | 'fundsTransferComment'
>): string {
  if (!fundsTransferReceiverOrTransfer) return comments;
  const receiver = fundsTransferReceiverOrTransfer;
  const base = comments ? `${comments} ${receiver}` : receiver;
  return fundsTransferComment ? `${base}: ${fundsTransferComment}` : base;
}

/**
 * Get a unique transaction identifier.
 * @param raw - The raw transaction.
 * @param inst - Parsed installment info.
 * @returns The identifier or fallback.
 */
function getTxnId(
  raw: IScrapedTransaction,
  inst: IInstallmentInfo | INoInstallment,
): string | INoIdentifier {
  if (inst.number !== undefined) {
    const arn = raw.dealData?.arn ?? '';
    return `${arn}_${String(inst.number)}`;
  }
  return raw.dealData?.arn ?? { id: undefined };
}

/**
 * Build date fields for a transaction.
 * @param raw - The raw scraped transaction.
 * @returns ISO date strings.
 */
function buildDates(raw: IScrapedTransaction): {
  date: string;
  processedDate: string;
} {
  const isPending = raw.paymentDate === null;
  const src = isPending ? raw.purchaseDate : raw.paymentDate;
  return {
    date: moment(raw.purchaseDate).toISOString(),
    processedDate: moment(src).toISOString(),
  };
}

/**
 * Build core transaction fields.
 * @param raw - The raw scraped transaction.
 * @returns Normalized transaction without rawTransaction.
 */
function buildTxn(raw: IScrapedTransaction): Omit<ITransaction, 'rawTransaction'> {
  const inst = getInstallments(raw.comments);
  const ident = getTxnId(raw, inst);
  const charged = getCharged(raw.paymentCurrency ?? 0);
  const isPending = raw.paymentDate === null;
  return {
    type: getTxnType(raw.planName, raw.planTypeId),
    ...buildDates(raw),
    originalAmount: 0 - raw.originalAmount,
    originalCurrency: raw.originalCurrency,
    chargedAmount: 0 - Number(raw.actualPaymentAmount),
    chargedCurrency: typeof charged === 'string' ? charged : undefined,
    description: raw.merchantName.trim(),
    memo: getMemo(raw),
    category: CATEGORIES.get(raw.categoryId),
    installments: inst.number !== undefined ? inst : undefined,
    identifier: typeof ident === 'string' ? ident : undefined,
    status: isPending ? TransactionStatuses.Pending : TransactionStatuses.Completed,
  };
}

/**
 * Map a raw transaction to normalized shape.
 * @param raw - The raw scraped transaction.
 * @param opts - Scraper options.
 * @returns The normalized transaction.
 */
function mapTxn(raw: IScrapedTransaction, opts?: ScraperOptions): ITransaction {
  const result: ITransaction = buildTxn(raw);
  if (opts?.includeRawTransaction) result.rawTransaction = getRawTransaction(raw);
  return result;
}

/**
 * Fetch and map transactions for a single month.
 * @param page - The Playwright page.
 * @param month - The month to fetch.
 * @param opts - Scraper options.
 * @returns Transactions grouped by account number.
 */
async function fetchMonth(
  page: Page,
  month: Moment,
  opts?: ScraperOptions,
): Promise<Record<string, ITransaction[]>> {
  const url = getTxnUrl(month);
  const data = await fetchGetWithinPage<ITransactionApiResult>(page, url);
  const result: Record<string, ITransaction[]> = {};
  if (!data?.result) return result;
  const valid = data.result.transactions.filter(t => !!t.planName);
  valid.forEach(t => {
    const mapped = mapTxn(t, opts);
    (result[t.shortCardNumber] ??= []).push(mapped);
  });
  return result;
}

/**
 * Merge monthly results into accumulated map.
 * @param all - The accumulated results.
 * @param part - New monthly results.
 * @returns The merged map.
 */
function mergeResults(
  all: Record<string, ITransaction[]>,
  part: Record<string, ITransaction[]>,
): Record<string, ITransaction[]> {
  const out: Record<string, ITransaction[]> = { ...all };
  Object.keys(part).forEach(k => {
    (out[k] ??= []).push(...part[k]);
  });
  return out;
}

/** Options for preparing transactions. */
interface IPrepareTransactionsOpts {
  txns: ITransaction[];
  start: moment.Moment;
  shouldCombine: boolean;
  isFilter: boolean;
}

/**
 * Sort, fix installments, filter old transactions.
 * @param opts - Preparation options.
 * @returns The prepared transactions.
 */
function prepare(opts: IPrepareTransactionsOpts): ITransaction[] {
  let out = Array.from(opts.txns);
  if (!opts.shouldCombine) out = fixInstallments(out);
  out = sortTransactionsByDate(out);
  if (!opts.isFilter) return out;
  return filterOldTransactions(out, opts.start, opts.shouldCombine);
}

/**
 * Build month-fetch actions for runSerial.
 * @param page - The Playwright page.
 * @param months - Array of month moments.
 * @param options - Scraper options.
 * @returns Array of async action factories.
 */
function buildMonthActions(
  page: Page,
  months: Moment[],
  options: ScraperOptions,
): (() => Promise<Record<string, ITransaction[]>>)[] {
  return months.map(
    m => (): Promise<Record<string, ITransaction[]>> => fetchMonth(page, m, options),
  );
}

/**
 * Prepare all accounts after fetching.
 * @param all - All results by account.
 * @param start - The start date cutoff.
 * @param options - Scraper options.
 * @returns The prepared results.
 */
function prepareAll(
  all: Record<string, ITransaction[]>,
  start: moment.Moment,
  options: ScraperOptions,
): Record<string, ITransaction[]> {
  const shouldCombine = options.shouldCombineInstallments ?? false;
  const isFilter = options.outputData?.isFilterByDateEnabled ?? true;
  Object.keys(all).forEach(k => {
    all[k] = prepare({ txns: all[k], start, shouldCombine, isFilter });
  });
  return all;
}

/**
 * Fetch all transactions across all months.
 * @param page - The Playwright page.
 * @param options - Scraper options.
 * @returns All transactions by account number.
 */
export async function fetchTransactions(
  page: Page,
  options: ScraperOptions,
): Promise<Record<string, ITransaction[]>> {
  const future = options.futureMonthsToScrape ?? 1;
  const fourYearsAgo = moment().subtract(4, 'years');
  const startDate = moment(options.startDate);
  const start = moment.max(fourYearsAgo, startDate);
  const months = getAllMonthMoments(start, future);
  await loadCategories(page);
  const actions = buildMonthActions(page, months, options);
  const results = await runSerial(actions);
  let all: Record<string, ITransaction[]> = {};
  for (const r of results) {
    all = mergeResults(all, r);
  }
  return prepareAll(all, start, options);
}
