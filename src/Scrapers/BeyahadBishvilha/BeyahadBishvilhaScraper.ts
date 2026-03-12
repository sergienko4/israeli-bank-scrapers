import moment from 'moment';
import { type Page } from 'playwright';

import { getDebug } from '../../Common/Debug.js';
import { pageEval, pageEvalAll, waitUntilElementFound } from '../../Common/ElementsInteractions.js';
import { toFirstCss } from '../../Common/SelectorResolver.js';
import { filterOldTransactions, getRawTransaction } from '../../Common/Transactions.js';
import {
  DOLLAR_CURRENCY,
  DOLLAR_CURRENCY_SYMBOL,
  EURO_CURRENCY,
  EURO_CURRENCY_SYMBOL,
  SHEKEL_CURRENCY,
  SHEKEL_CURRENCY_SYMBOL,
} from '../../Constants.js';
import { CompanyTypes } from '../../Definitions.js';
import { type ITransaction, TransactionStatuses, TransactionTypes } from '../../Transactions.js';
import GenericBankScraper from '../Base/GenericBankScraper.js';
import { type ScraperOptions } from '../Base/Interface.js';
import { SCRAPER_CONFIGURATION } from '../Registry/Config/ScraperConfig.js';
import { BEYAHAD_CONFIG } from './Config/BeyahadBishvilhaLoginConfig.js';

const LOG = getDebug('beyahadBishvilha');

const CFG = SCRAPER_CONFIGURATION.banks[CompanyTypes.BeyahadBishvilha];
const SELECTOR_ENTRIES = Object.entries(CFG.selectors).map(([k, cs]) => [k, toFirstCss(cs)]);
const SEL = Object.fromEntries(SELECTOR_ENTRIES) as Record<string, string>;

interface IScrapedTransaction {
  date: string;
  description: string;
  type: string;
  chargedAmount: string;
  identifier: string;
}

const CURRENCY_SYMBOLS: [string, string][] = [
  [SHEKEL_CURRENCY_SYMBOL, SHEKEL_CURRENCY],
  [DOLLAR_CURRENCY_SYMBOL, DOLLAR_CURRENCY],
  [EURO_CURRENCY_SYMBOL, EURO_CURRENCY],
];

/**
 * Parse a currency amount string into its numeric value and code.
 * @param amountStrCln - The cleaned amount string.
 * @returns The parsed amount and currency code.
 */
function parseCurrencyAmount(amountStrCln: string): { amount: number; currency: string } {
  for (const [symbol, currency] of CURRENCY_SYMBOLS) {
    if (amountStrCln.includes(symbol)) {
      const cleaned = amountStrCln.replace(symbol, '');
      return { amount: parseFloat(cleaned), currency };
    }
  }
  const parts = amountStrCln.split(' ');
  return { amount: parseFloat(parts[1]), currency: parts[0] };
}

/**
 * Get the numeric amount and currency from a formatted string.
 * @param amountStr - The formatted amount string.
 * @returns The parsed amount and currency code.
 */
function getAmountData(amountStr: string): { amount: number; currency: string } {
  const cleaned = amountStr.replace(',', '');
  return parseCurrencyAmount(cleaned);
}

/**
 * Build the base transaction from scraped data.
 * @param txn - The scraped transaction.
 * @returns The base ITransaction without raw data.
 */
function buildTxnBase(txn: IScrapedTransaction): ITransaction {
  const chargedAmountTuple = getAmountData(txn.chargedAmount || '');
  const txnProcessedDate = moment(txn.date, CFG.format.date);
  return {
    type: TransactionTypes.Normal,
    status: TransactionStatuses.Completed,
    date: txnProcessedDate.toISOString(),
    processedDate: txnProcessedDate.toISOString(),
    originalAmount: chargedAmountTuple.amount,
    originalCurrency: chargedAmountTuple.currency,
    chargedAmount: chargedAmountTuple.amount,
    chargedCurrency: chargedAmountTuple.currency,
    description: txn.description || '',
    memo: '',
    identifier: txn.identifier,
  };
}

/**
 * Convert a single scraped transaction to the standard format.
 * @param txn - The scraped transaction.
 * @param options - Optional scraper options for raw data.
 * @returns The converted ITransaction.
 */
function convertOneTxn(txn: IScrapedTransaction, options?: ScraperOptions): ITransaction {
  const result = buildTxnBase(txn);
  if (options?.includeRawTransaction) {
    result.rawTransaction = getRawTransaction(txn);
  }
  return result;
}

/**
 * Convert an array of scraped transactions to standard format.
 * @param txns - The scraped transactions array.
 * @param options - Optional scraper options.
 * @returns The converted ITransaction array.
 */
function convertTransactions(
  txns: IScrapedTransaction[],
  options?: ScraperOptions,
): ITransaction[] {
  const count = String(txns.length);
  LOG.debug(`convert ${count} raw transactions to ITransaction structure`);
  return txns.map(txn => convertOneTxn(txn, options));
}

/**
 * Extract transaction data from DOM elements.
 * @param items - The DOM elements.
 * @returns The extracted data or false for invalid rows.
 */
function extractTxnRows(items: Element[]): (IScrapedTransaction | false)[] {
  return items.map(el => {
    const cols: NodeListOf<HTMLSpanElement> = el.querySelectorAll(SEL.transactionColumns);
    if (cols.length !== 7) return false;
    return {
      date: cols[0].innerText,
      identifier: cols[1].innerText,
      description: cols[3].innerText,
      type: cols[5].innerText,
      chargedAmount: cols[6].innerText,
    };
  });
}

/**
 * Scrape raw transaction data from the page.
 * @param page - The Playwright page instance.
 * @returns The array of scraped transactions.
 */
async function scrapeRawTransactions(page: Page): Promise<IScrapedTransaction[]> {
  const rawItems = await pageEvalAll<(IScrapedTransaction | false)[]>(page, {
    selector: SEL.transactionContainer,
    defaultResult: [],
    callback: extractTxnRows,
  });
  return rawItems.filter((item): item is IScrapedTransaction => item !== false);
}

/**
 * Scrape the account number and balance from the page.
 * @param page - The Playwright page instance.
 * @returns The account number and balance strings.
 */
async function scrapeAccountInfo(page: Page): Promise<{ accountNumber: string; balance: string }> {
  /**
   * Extract the card number from an element.
   * @param element - The DOM element.
   * @returns The card number string.
   */
  const extractCard = (element: Element): string =>
    (element as HTMLElement).innerText.replace('מספר כרטיס ', '');
  /**
   * Extract balance text from an element.
   * @param element - The DOM element.
   * @returns The balance text.
   */
  const extractBalance = (element: Element): string => (element as HTMLElement).innerText;
  const accountNumber = await pageEval(page, {
    selector: SEL.cardNumber,
    defaultResult: '',
    callback: extractCard,
  });
  const balance = await pageEval(page, {
    selector: SEL.balance,
    defaultResult: '',
    callback: extractBalance,
  });
  return { accountNumber, balance };
}

/**
 * Apply date filtering to the transactions if enabled.
 * @param txns - The transactions to filter.
 * @param options - The scraper options.
 * @param startMoment - The start date moment.
 * @returns The filtered transactions.
 */
function applyDateFilter(
  txns: ITransaction[],
  options: ScraperOptions,
  startMoment: moment.Moment,
): ITransaction[] {
  const isEnabled = options.outputData?.isFilterByDateEnabled ?? true;
  return isEnabled ? filterOldTransactions(txns, startMoment, false) : txns;
}

/**
 * Get filtered transactions from the page.
 * @param page - The Playwright page instance.
 * @param options - The scraper options.
 * @param startMoment - The start date moment.
 * @returns The account and filtered transactions.
 */
async function getFilteredTxns(
  page: Page,
  options: ScraperOptions,
  startMoment: moment.Moment,
): Promise<{ accountTransactions: ITransaction[]; txns: ITransaction[] }> {
  LOG.debug('fetch raw transactions from page');
  const rawTransactions = await scrapeRawTransactions(page);
  const rawCount = String(rawTransactions.length);
  LOG.debug(`fetched ${rawCount} raw transactions from page`);
  const accountTransactions = convertTransactions(rawTransactions, options);
  const txns = applyDateFilter(accountTransactions, options, startMoment);
  return { accountTransactions, txns };
}

/**
 * Navigate to the card transactions page and wait for load.
 * @param page - The Playwright page instance.
 * @returns True after navigation completes.
 */
async function navigateToCardPage(page: Page): Promise<boolean> {
  await page.goto(CFG.api.card);
  await waitUntilElementFound(page, SEL.loadingIndicator, { visible: false });
  return true;
}

/**
 * Fetch all transactions for the account.
 * @param page - The Playwright page instance.
 * @param options - The scraper options.
 * @returns The account result with number, balance, and transactions.
 */
async function fetchTransactions(
  page: Page,
  options: ScraperOptions,
): Promise<{ accountNumber: string; balance: number; txns: ITransaction[] }> {
  await navigateToCardPage(page);
  const defaultStartMoment = moment().subtract(1, 'years');
  const optionsStart = moment(options.startDate);
  const startMoment = moment.max(defaultStartMoment, optionsStart);
  const { accountNumber, balance } = await scrapeAccountInfo(page);
  const suffix = accountNumber.substring(accountNumber.length - 2);
  const { txns } = await getFilteredTxns(page, options, startMoment);
  LOG.debug(`found ${String(txns.length)} valid txns for acct ${suffix}`);
  return { accountNumber, balance: getAmountData(balance).amount, txns };
}

interface IScraperSpecificCredentials {
  id: string;
  password: string;
}

/** BeyahadBishvilha scraper — fetches transactions from the portal. */
class BeyahadBishvilhaScraper extends GenericBankScraper<IScraperSpecificCredentials> {
  /**
   * Create a BeyahadBishvilha scraper with the given options.
   * @param options - The scraper configuration options.
   */
  constructor(options: ScraperOptions) {
    super(options, BEYAHAD_CONFIG);
  }

  /**
   * Fetch transaction data from BeyahadBishvilha online banking.
   * @returns The scraping result with accounts and transactions.
   */
  public async fetchData(): Promise<{
    success: boolean;
    accounts: {
      accountNumber: string;
      balance: number;
      txns: ITransaction[];
    }[];
  }> {
    const account = await fetchTransactions(this.page, this.options);
    return { success: true, accounts: [account] };
  }

  /**
   * Get the viewport dimensions for this scraper.
   * @returns The viewport width and height.
   */
  public static getViewPort(): { width: number; height: number } {
    return { width: 1500, height: 800 };
  }
}

export default BeyahadBishvilhaScraper;
