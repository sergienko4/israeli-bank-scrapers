import { type Moment } from 'moment';
import moment from 'moment';
import { type Page } from 'playwright';

import {
  clickButton,
  pageEvalAll,
  waitUntilElementDisappear,
  waitUntilElementFound,
} from '../../Common/ElementsInteractions.js';
import { toFirstCss } from '../../Common/SelectorResolver.js';
import { getRawTransaction } from '../../Common/Transactions.js';
import { runSerial } from '../../Common/Waiting.js';
import { SHEKEL_CURRENCY } from '../../Constants.js';
import { CompanyTypes } from '../../Definitions.js';
import {
  type ITransaction,
  type ITransactionsAccount,
  TransactionStatuses,
  TransactionTypes,
} from '../../Transactions.js';
import GenericBankScraper from '../Base/GenericBankScraper.js';
import { type ScraperOptions } from '../Base/Interface.js';
import ScraperError from '../Base/ScraperError.js';
import { SCRAPER_CONFIGURATION } from '../Registry/Config/ScraperConfig.js';
import { YAHAV_CONFIG } from './Config/YahavLoginConfig.js';

const CFG = SCRAPER_CONFIGURATION.banks[CompanyTypes.Yahav];
const SELECTOR_ENTRIES = Object.entries(CFG.selectors).map(([k, cs]) => [k, toFirstCss(cs)]);
const SEL = Object.fromEntries(SELECTOR_ENTRIES) as Record<string, string>;

interface IScrapedTransaction {
  credit: string;
  debit: string;
  date: string;
  reference?: string;
  description: string;
  memo: string;
  status: TransactionStatuses;
}

/**
 * Retrieve the currently selected account ID from the page.
 * @param page - The Playwright page instance.
 * @returns The account ID string.
 */
async function getAccountID(page: Page): Promise<string> {
  try {
    return (await page.locator(SEL.accountId).first().textContent()) ?? '';
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new ScraperError(`Failed to retrieve account ID. Selector '${SEL.accountId}': ${msg}`);
  }
}

/**
 * Parse a numeric amount from a formatted string.
 * @param amountStr - The formatted amount string.
 * @returns The parsed numeric value.
 */
function getAmountData(amountStr: string): number {
  const amountStrCopy = amountStr.replace(',', '');
  return parseFloat(amountStrCopy);
}

/**
 * Calculate the net transaction amount from credit and debit.
 * @param txn - The scraped transaction.
 * @returns The net amount.
 */
function getTxnAmount(txn: IScrapedTransaction): number {
  const credit = getAmountData(txn.credit);
  const debit = getAmountData(txn.debit);
  return (Number.isNaN(credit) ? 0 : credit) - (Number.isNaN(debit) ? 0 : debit);
}

interface ITransactionsTr {
  id: string;
  innerDivs: string[];
}

/**
 * Build the base transaction object from scraped data.
 * @param txn - The scraped transaction.
 * @returns The base ITransaction without raw data.
 */
function buildTxnBase(txn: IScrapedTransaction): ITransaction {
  const convertedDate = moment(txn.date, CFG.format.date).toISOString();
  const convertedAmount = getTxnAmount(txn);
  return {
    type: TransactionTypes.Normal,
    identifier: txn.reference ? parseInt(txn.reference, 10) : undefined,
    date: convertedDate,
    processedDate: convertedDate,
    originalAmount: convertedAmount,
    originalCurrency: SHEKEL_CURRENCY,
    chargedAmount: convertedAmount,
    status: txn.status,
    description: txn.description,
    memo: txn.memo,
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
  return txns.map(txn => convertOneTxn(txn, options));
}

/**
 * Process a single transaction row and add it to the collection.
 * @param txns - The collection to append to.
 * @param txnRow - The table row data.
 * @returns True after processing.
 */
function handleTransactionRow(txns: IScrapedTransaction[], txnRow: ITransactionsTr): boolean {
  const div = txnRow.innerDivs;
  const regex = /\D+/gm;
  const tx: IScrapedTransaction = {
    date: div[1],
    reference: div[2].replace(regex, ''),
    memo: '',
    description: div[3],
    debit: div[4],
    credit: div[5],
    status: TransactionStatuses.Completed,
  };
  txns.push(tx);
  return true;
}

/**
 * Scrape transaction table rows from the page.
 * @param page - The Playwright page instance.
 * @returns The scraped row data array.
 */
async function scrapeTransactionDivs(page: Page): Promise<ITransactionsTr[]> {
  /**
   * Extract row data from transaction divs.
   * @param divs - The raw DOM elements.
   * @returns The parsed row data.
   */
  const extractRows = (divs: Element[]): ITransactionsTr[] =>
    (divs as HTMLElement[]).map(div => {
      const childDivs = div.getElementsByTagName('div');
      const innerDivs = Array.from(childDivs).map(el => (el as HTMLElement).innerText);
      return { id: div.getAttribute('id') ?? '', innerDivs };
    });
  return pageEvalAll<ITransactionsTr[]>(page, {
    selector: SEL.transactionRows,
    defaultResult: [],
    callback: extractRows,
  });
}

/**
 * Get all account transactions from the page.
 * @param page - The Playwright page instance.
 * @param options - Optional scraper options.
 * @returns The array of parsed transactions.
 */
async function getAccountTransactions(
  page: Page,
  options?: ScraperOptions,
): Promise<ITransaction[]> {
  await waitUntilElementFound(page, SEL.transactionTableHeader, { visible: true });
  const txns: IScrapedTransaction[] = [];
  const transactionsDivs = await scrapeTransactionDivs(page);
  for (const txnRow of transactionsDivs) {
    handleTransactionRow(txns, txnRow);
  }
  return convertTransactions(txns, options);
}

/**
 * Select a year from the date picker grid.
 * @param page - The Playwright page instance.
 * @param targetYear - The year string to select.
 * @returns True after selection.
 */
async function selectYearFromGrid(page: Page, targetYear: string): Promise<boolean> {
  const yearCell = page.getByText(targetYear, { exact: true }).first();
  const actions = [(): Promise<boolean> => yearCell.click().then(() => true)];
  await runSerial(actions);
  return true;
}

/**
 * Select a day from the date picker grid.
 * @param page - The Playwright page instance.
 * @param targetDay - The day string to select.
 * @returns True after selection.
 */
async function selectDayFromGrid(page: Page, targetDay: string): Promise<boolean> {
  const dayCell = page.getByText(targetDay, { exact: true }).first();
  const actions = [(): Promise<boolean> => dayCell.click().then(() => true)];
  await runSerial(actions);
  return true;
}

/**
 * Open the date picker widget.
 * @param page - The Playwright page instance.
 * @returns True after the picker is open.
 */
async function openDatePicker(page: Page): Promise<boolean> {
  await waitUntilElementFound(page, SEL.datePickerOpener, { visible: true });
  await clickButton(page, SEL.datePickerOpener);
  await waitUntilElementFound(page, 'text=1', { visible: true });
  return true;
}

/**
 * Navigate the date picker to the year/month view.
 * @param page - The Playwright page instance.
 * @returns True after navigation.
 */
async function navigateToYearView(page: Page): Promise<boolean> {
  await waitUntilElementFound(page, SEL.monthPickerBtn, { visible: true });
  await clickButton(page, SEL.monthPickerBtn);
  await waitUntilElementFound(page, SEL.monthsGridCheck, { visible: true });
  await waitUntilElementFound(page, SEL.monthPickerBtn, { visible: true });
  await clickButton(page, SEL.monthPickerBtn);
  await waitUntilElementFound(page, SEL.yearsGridCheck, { visible: true });
  return true;
}

/**
 * Search transactions by start date using the date picker.
 * @param page - The Playwright page instance.
 * @param startDate - The start date for filtering.
 * @returns True after search is applied.
 */
async function searchByDates(page: Page, startDate: Moment): Promise<boolean> {
  const day = startDate.format('D');
  const month = startDate.format('M');
  const year = startDate.format('Y');
  await openDatePicker(page);
  await navigateToYearView(page);
  await selectYearFromGrid(page, year);
  await waitUntilElementFound(page, SEL.monthsGridCheck, { visible: true });
  const monthCell = page.getByText(month, { exact: true }).first();
  await monthCell.click();
  await selectDayFromGrid(page, day);
  return true;
}

interface IFetchAccountDataOpts {
  page: Page;
  startDate: Moment;
  accountID: string;
  options?: ScraperOptions;
}

/**
 * Fetch transaction data for a single account.
 * @param opts - The fetch options.
 * @returns The account transactions result.
 */
async function fetchAccountData(opts: IFetchAccountDataOpts): Promise<ITransactionsAccount> {
  const { page, startDate, accountID, options } = opts;
  await waitUntilElementDisappear(page, SEL.loadingSpinner);
  await searchByDates(page, startDate);
  await waitUntilElementDisappear(page, SEL.loadingSpinner);
  const txns = await getAccountTransactions(page, options);
  return { accountNumber: accountID, txns };
}

/**
 * Fetch transactions for all accounts.
 * @param page - The Playwright page instance.
 * @param startDate - The start date for filtering.
 * @param options - Optional scraper options.
 * @returns The array of account transaction results.
 */
async function fetchAccounts(
  page: Page,
  startDate: Moment,
  options?: ScraperOptions,
): Promise<ITransactionsAccount[]> {
  const accountID = await getAccountID(page);
  const accountData = await fetchAccountData({
    page,
    startDate,
    accountID,
    options,
  });
  return [accountData];
}

interface IScraperSpecificCredentials {
  username: string;
  password: string;
  nationalID: string;
}

/** Yahav bank scraper — fetches transactions from Yahav online banking. */
class YahavScraper extends GenericBankScraper<IScraperSpecificCredentials> {
  /**
   * Create a Yahav scraper with the given options.
   * @param options - The scraper configuration options.
   */
  constructor(options: ScraperOptions) {
    super(options, YAHAV_CONFIG);
  }

  /**
   * Fetch transaction data from Yahav online banking.
   * @returns The scraping result with accounts and transactions.
   */
  public async fetchData(): Promise<{
    success: boolean;
    accounts: ITransactionsAccount[];
  }> {
    await this.navigateToStatements();
    const defaultStart = moment().subtract(3, 'months').add(1, 'day');
    const optStart = moment(this.options.startDate);
    const startMoment = moment.max(defaultStart, optStart);
    const accounts = await fetchAccounts(this.page, startMoment, this.options);
    return { success: true, accounts };
  }

  /**
   * Navigate to the statements page.
   * @returns True after navigation completes.
   */
  private async navigateToStatements(): Promise<boolean> {
    await waitUntilElementFound(this.page, SEL.accountDetails, { visible: true });
    await clickButton(this.page, SEL.accountDetails);
    const statementsReadySel = 'text=תנועות בחשבון';
    await waitUntilElementFound(this.page, statementsReadySel, {
      visible: true,
    });
    return true;
  }
}

export default YahavScraper;
