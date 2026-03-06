import moment from 'moment';
import { type Page } from 'playwright';

import { getDebug } from '../../Common/Debug';
import { pageEval, pageEvalAll, waitUntilElementFound } from '../../Common/ElementsInteractions';
import { toFirstCss } from '../../Common/SelectorResolver';
import { filterOldTransactions, getRawTransaction } from '../../Common/Transactions';
import {
  DOLLAR_CURRENCY,
  DOLLAR_CURRENCY_SYMBOL,
  EURO_CURRENCY,
  EURO_CURRENCY_SYMBOL,
  SHEKEL_CURRENCY,
  SHEKEL_CURRENCY_SYMBOL,
} from '../../Constants';
import { CompanyTypes } from '../../Definitions';
import { type Transaction, TransactionStatuses, TransactionTypes } from '../../Transactions';
import { GenericBankScraper } from '../Base/GenericBankScraper';
import { type ScraperOptions } from '../Base/Interface';
import { SCRAPER_CONFIGURATION } from '../Registry/ScraperConfig';
import { BEYAHAD_CONFIG } from './BeyahadBishvilhaLoginConfig';

const LOG = getDebug('beyahadBishvilha');

const CFG = SCRAPER_CONFIGURATION.banks[CompanyTypes.BeyahadBishvilha];
// Phase-1 compat: extract first CSS candidate until full resolveDashboardField() migration
const SELECTOR_ENTRIES = Object.entries(CFG.selectors).map(([k, cs]) => [k, toFirstCss(cs)]);
const SEL = Object.fromEntries(SELECTOR_ENTRIES) as Record<string, string>;

export interface ScrapedTransaction {
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
 * Parses a cleaned amount string into a numeric amount and currency code.
 *
 * @param amountStrCln - amount string without commas, containing a currency symbol or code
 * @returns the parsed amount and currency code
 */
function parseCurrencyAmount(amountStrCln: string): { amount: number; currency: string } {
  for (const [symbol, currency] of CURRENCY_SYMBOLS) {
    if (amountStrCln.includes(symbol)) {
      const amountWithoutSymbol = amountStrCln.replace(symbol, '');
      return { amount: parseFloat(amountWithoutSymbol), currency };
    }
  }
  const parts = amountStrCln.split(' ');
  const numericPart = parts[1];
  return { amount: parseFloat(numericPart), currency: parts[0] };
}

/**
 * Strips commas from an amount string and delegates to parseCurrencyAmount.
 *
 * @param amountStr - the raw amount string (may contain commas)
 * @returns the parsed amount and currency code
 */
function getAmountData(amountStr: string): { amount: number; currency: string } {
  const cleanedAmountStr = amountStr.replace(',', '');
  return parseCurrencyAmount(cleanedAmountStr);
}

/**
 * Converts a single scraped transaction to a normalized Transaction object.
 *
 * @param txn - the raw scraped transaction
 * @param options - scraper options controlling rawTransaction inclusion
 * @returns a normalized Transaction
 */
function convertOneTxn(txn: ScrapedTransaction, options?: ScraperOptions): Transaction {
  const chargedAmountTuple = getAmountData(txn.chargedAmount || '');
  const txnProcessedDate = moment(txn.date, CFG.format.date);
  const result: Transaction = {
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
  if (options?.includeRawTransaction) result.rawTransaction = getRawTransaction(txn);
  return result;
}

/**
 * Converts an array of scraped transactions to normalized Transaction objects.
 *
 * @param txns - the raw scraped transactions
 * @param options - scraper options controlling rawTransaction inclusion
 * @returns an array of normalized Transaction objects
 */
function convertTransactions(txns: ScrapedTransaction[], options?: ScraperOptions): Transaction[] {
  LOG.info(`convert ${String(txns.length)} raw transactions to official Transaction structure`);
  return txns.map(txn => convertOneTxn(txn, options));
}

/**
 * Extracts raw transaction rows from the page's transaction container.
 *
 * @param page - the Playwright page showing the transactions table
 * @returns an array of ScrapedTransaction objects (null for rows with unexpected structure)
 */
async function scrapeRawTransactions(page: Page): Promise<(ScrapedTransaction | null)[]> {
  return pageEvalAll<(ScrapedTransaction | null)[]>(page, {
    selector: SEL.transactionContainer,
    defaultResult: [],
    /**
     * Maps transaction container elements to raw transaction objects.
     *
     * @param items - the list of transaction container elements
     * @returns an array of ScrapedTransaction or null for malformed rows
     */
    callback: items =>
      items.map(el => {
        const columns: NodeListOf<HTMLSpanElement> = el.querySelectorAll(SEL.transactionColumns);
        if (columns.length !== 7) return null;
        return {
          date: columns[0].innerText,
          identifier: columns[1].innerText,
          description: columns[3].innerText,
          type: columns[5].innerText,
          chargedAmount: columns[6].innerText,
        };
      }),
  });
}

/**
 * Reads the card number and balance from the account summary page.
 *
 * @param page - the Playwright page showing the account summary
 * @returns the account number and balance as strings
 */
async function scrapeAccountInfo(page: Page): Promise<{ accountNumber: string; balance: string }> {
  const accountNumber = await pageEval(page, {
    selector: SEL.cardNumber,
    defaultResult: '',
    /**
     * Extracts the card number text from the element.
     *
     * @param element - the card number DOM element
     * @returns the card number string with the Hebrew prefix removed
     */
    callback: element => (element as HTMLElement).innerText.replace('מספר כרטיס ', ''),
  });
  const balance = await pageEval(page, {
    selector: SEL.balance,
    defaultResult: '',
    /**
     * Extracts the balance text from the element.
     *
     * @param element - the balance DOM element
     * @returns the raw balance text
     */
    callback: element => (element as HTMLElement).innerText,
  });
  return { accountNumber, balance };
}

/**
 * Applies the date filter to transactions if date filtering is enabled.
 *
 * @param txns - the full list of converted transactions
 * @param options - scraper options controlling date filtering
 * @param startMoment - the earliest date to include
 * @returns the filtered list of transactions
 */
function applyDateFilter(
  txns: Transaction[],
  options: ScraperOptions,
  startMoment: moment.Moment,
): Transaction[] {
  return (options.outputData?.isFilterByDateEnabled ?? true)
    ? filterOldTransactions(txns, startMoment, false)
    : txns;
}

/**
 * Scrapes, converts, and filters transactions from the current page.
 *
 * @param page - the Playwright page showing the transactions
 * @param options - scraper options for conversion and date filtering
 * @param startMoment - the earliest date to include
 * @returns all converted transactions and the date-filtered subset
 */
async function getFilteredTxns(
  page: Page,
  options: ScraperOptions,
  startMoment: moment.Moment,
): Promise<{ accountTransactions: Transaction[]; txns: Transaction[] }> {
  LOG.info('fetch raw transactions from page');
  const rawTransactions = await scrapeRawTransactions(page);
  LOG.info(`fetched ${String(rawTransactions.length)} raw transactions from page`);
  const validRawTransactions = rawTransactions.filter(item => !!item);
  const accountTransactions = convertTransactions(validRawTransactions, options);
  return { accountTransactions, txns: applyDateFilter(accountTransactions, options, startMoment) };
}

/**
 * Navigates to the card page and fetches account info and transactions.
 *
 * @param page - the Playwright page to navigate
 * @param options - scraper options for date filtering and rawTransaction inclusion
 * @returns the account number, balance, and filtered transactions
 */
async function fetchTransactions(
  page: Page,
  options: ScraperOptions,
): Promise<{ accountNumber: string; balance: number; txns: Transaction[] }> {
  await page.goto(CFG.api.card);
  await waitUntilElementFound(page, SEL.loadingIndicator, { visible: false });
  const defaultStartMoment = moment().subtract(1, 'years');
  const optionsStartMoment = moment(options.startDate);
  const startMoment = moment.max(defaultStartMoment, optionsStartMoment);
  const { accountNumber, balance } = await scrapeAccountInfo(page);
  const { accountTransactions, txns } = await getFilteredTxns(page, options, startMoment);
  const last2 = accountNumber.substring(accountNumber.length - 2);
  LOG.info(
    `found ${String(txns.length)} valid transactions out of ` +
      `${String(accountTransactions.length)} transactions for account ending with ${last2}`,
  );
  const balanceData = getAmountData(balance);
  return { accountNumber, balance: balanceData.amount, txns };
}

/** Scraper for the BeyahadBishvilha (Together For You) benefits card portal. */
class BeyahadBishvilhaScraper extends GenericBankScraper<{ id: string; password: string }> {
  /**
   * Creates a BeyahadBishvilhaScraper with the shared benefits portal login configuration.
   *
   * @param options - scraper options including companyId and timeouts
   */
  constructor(options: ScraperOptions) {
    super(options, BEYAHAD_CONFIG);
  }

  /**
   * Fetches transaction data for the BeyahadBishvilha card account.
   *
   * @returns a successful scraping result with the single card account and transactions
   */
  public async fetchData(): Promise<{
    success: boolean;
    accounts: { accountNumber: string; balance: number; txns: Transaction[] }[];
  }> {
    const account = await fetchTransactions(this.page, this.options);
    return {
      success: true,
      accounts: [account],
    };
  }
}

export default BeyahadBishvilhaScraper;
