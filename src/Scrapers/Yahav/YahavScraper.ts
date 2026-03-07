import moment, { type Moment } from 'moment';
import { type Page } from 'playwright';

import {
  clickButton,
  pageEvalAll,
  waitUntilElementDisappear,
  waitUntilElementFound,
} from '../../Common/ElementsInteractions';
import {
  type IDashboardFieldOpts,
  resolveDashboardField,
  toFirstCss,
} from '../../Common/SelectorResolver';
import { getRawTransaction } from '../../Common/Transactions';
import { SHEKEL_CURRENCY } from '../../Constants';
import { CompanyTypes } from '../../Definitions';
import type { IDoneResult } from '../../Interfaces/Common/StepResult';
import {
  type ITransaction,
  type ITransactionsAccount,
  TransactionStatuses,
  TransactionTypes,
} from '../../Transactions';
import { GenericBankScraper } from '../Base/GenericBankScraper';
import { type ScraperOptions } from '../Base/Interface';
import { type SelectorCandidate } from '../Base/LoginConfig';
import { ScraperWebsiteChangedError } from '../Base/ScraperWebsiteChangedError';
import { SCRAPER_CONFIGURATION } from '../Registry/ScraperConfig';
import { YAHAV_CONFIG } from './YahavLoginConfig';

const CFG = SCRAPER_CONFIGURATION.banks[CompanyTypes.Yahav];
// SEL kept for data-extraction fields (accountId, transactionRows, transactionTableHeader, accountDetails)
const SELECTOR_ENTRIES = Object.entries(CFG.selectors).map(([k, cs]) => [k, toFirstCss(cs)]);
const SEL = Object.fromEntries(SELECTOR_ENTRIES) as Record<string, string>;

export type YahavDashKey = keyof typeof CFG.selectors;
// Typed key constants derived from config — no inline string literals in scraper code
const KEYS_ENTRIES = Object.keys(CFG.selectors).map(k => [k, k]);
const KEYS = Object.fromEntries(KEYS_ENTRIES) as {
  [K in YahavDashKey]: K;
};

/**
 * Builds a IDashboardFieldOpts for a Yahav selector key.
 *
 * @param page - the Playwright page to resolve the selector in
 * @param key - the Yahav dashboard selector key
 * @returns a IDashboardFieldOpts ready for resolveDashboardField()
 */
function dashOpts(page: Page, key: YahavDashKey): IDashboardFieldOpts {
  return {
    pageOrFrame: page,
    fieldKey: key,
    bankCandidates: [...(CFG.selectors[key] as SelectorCandidate[])],
    pageUrl: page.url(),
  };
}

export interface IScrapedTransaction {
  credit: string;
  debit: string;
  date: string;
  reference?: string;
  description: string;
  memo: string;
  status: TransactionStatuses;
}

/**
 * Reads the account ID from the Yahav dashboard.
 *
 * @param page - the Playwright page showing the account dashboard
 * @returns the account ID string
 */
async function getAccountID(page: Page): Promise<string> {
  try {
    const selectedSnifAccount = await page.$eval(SEL.accountId, (element: Element) => {
      return element.textContent;
    });

    return selectedSnifAccount;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const detail = `Possible outdated selector '${SEL.accountId}: ${errorMessage}`;
    throw new ScraperWebsiteChangedError('Yahav', `Failed to retrieve account ID. ${detail}`);
  }
}

/**
 * Parses a Hebrew-formatted amount string to a floating-point number.
 *
 * @param amountStr - the raw amount string (may contain commas)
 * @returns the numeric amount value
 */
function getAmountData(amountStr: string): number {
  const amountStrCopy = amountStr.replace(',', '');
  return parseFloat(amountStrCopy);
}

/**
 * Calculates the net transaction amount from credit and debit fields.
 *
 * @param txn - the scraped transaction with credit and debit string values
 * @returns the net amount (credit - debit) as a number
 */
function getTxnAmount(txn: IScrapedTransaction): number {
  const credit = getAmountData(txn.credit);
  const debit = getAmountData(txn.debit);
  return (Number.isNaN(credit) ? 0 : credit) - (Number.isNaN(debit) ? 0 : debit);
}

export interface ITransactionTableRow {
  id: string;
  innerDivs: string[];
}

/**
 * Converts a single scraped Yahav transaction to a normalized ITransaction.
 *
 * @param txn - the raw scraped Yahav transaction
 * @param options - scraper options controlling rawTransaction inclusion
 * @returns a normalized ITransaction object
 */
function convertOneTxn(txn: IScrapedTransaction, options?: ScraperOptions): ITransaction {
  const convertedDate = moment(txn.date, CFG.format.date).toISOString();
  const convertedAmount = getTxnAmount(txn);
  const result: ITransaction = {
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
  if (options?.includeRawTransaction) result.rawTransaction = getRawTransaction(txn);
  return result;
}

/**
 * Converts an array of scraped Yahav transactions to normalized ITransaction objects.
 *
 * @param txns - the raw scraped transactions
 * @param options - scraper options controlling rawTransaction inclusion
 * @returns an array of normalized ITransaction objects
 */
function convertTransactions(
  txns: IScrapedTransaction[],
  options?: ScraperOptions,
): ITransaction[] {
  return txns.map(txn => convertOneTxn(txn, options));
}

/**
 * Parses a single transaction row div into a IScrapedTransaction and appends to the accumulator.
 *
 * @param txns - the accumulator array to append the parsed transaction to
 * @param txnRow - the raw transaction row with div contents
 * @returns a done result after appending the parsed transaction
 */
function handleTransactionRow(
  txns: IScrapedTransaction[],
  txnRow: ITransactionTableRow,
): IDoneResult {
  const div = txnRow.innerDivs;

  // Remove anything except digits.
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
  return { done: true };
}

/**
 * Extracts all transaction div elements from the Yahav transactions table.
 *
 * @param page - the Playwright page showing the transactions table
 * @returns an array of ITransactionTableRow objects with div text contents
 */
async function scrapeTransactionDivs(page: Page): Promise<ITransactionTableRow[]> {
  return pageEvalAll<ITransactionTableRow[]>(page, {
    selector: SEL.transactionRows,
    defaultResult: [],
    /**
     * Maps each transaction div to a ITransactionTableRow with ID and inner div texts.
     *
     * @param divs - the list of transaction div elements
     * @returns an array of ITransactionTableRow objects
     */
    callback: divs =>
      (divs as HTMLElement[]).map(div => {
        const childDivs = div.getElementsByTagName('div');
        return {
          id: div.getAttribute('id') ?? '',
          innerDivs: Array.from(childDivs).map(el => (el as HTMLElement).innerText),
        };
      }),
  });
}

/**
 * Scrapes and converts all transactions from the Yahav transactions table.
 *
 * @param page - the Playwright page showing the transactions table
 * @param options - scraper options controlling rawTransaction inclusion
 * @returns an array of normalized ITransaction objects
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

export interface ISelectFromGridOpts {
  page: Page;
  baseSelector: string;
  count: number;
  target: string;
}

/**
 * Clicks the grid item that matches the target text.
 *
 * @param opts - options with page, base selector, item count, and target text
 * @returns a done result after the matching item is clicked
 */
async function selectFromGrid(opts: ISelectFromGridOpts): Promise<IDoneResult> {
  const { page, baseSelector, count, target } = opts;
  const indices = Array.from({ length: count }, (_, i) => i + 1);
  const textPromises = indices.map(i =>
    page.$eval(`${baseSelector}:nth-child(${String(i)})`, el => (el as HTMLElement).innerText),
  );
  const texts = await Promise.all(textPromises);
  const matchIdx = texts.findIndex(t => t === target);
  if (matchIdx >= 0) await clickButton(page, `${baseSelector}:nth-child(${String(matchIdx + 1)})`);
  return { done: true };
}

/**
 * Selects a year from the Yahav date picker year grid.
 *
 * @param page - the Playwright page with the date picker open
 * @param targetYear - the year string to select (e.g. '2024')
 * @returns a done result after the year is selected
 */
async function selectYearFromGrid(page: Page, targetYear: string): Promise<IDoneResult> {
  return selectFromGrid({ page, baseSelector: SEL.pmuYearsCell, count: 12, target: targetYear });
}

/**
 * Selects a day from the Yahav date picker day grid.
 *
 * @param page - the Playwright page with the date picker open
 * @param targetDay - the day string to select (e.g. '15')
 * @returns a done result after the day is selected
 */
async function selectDayFromGrid(page: Page, targetDay: string): Promise<IDoneResult> {
  return selectFromGrid({ page, baseSelector: SEL.pmuDaysCell, count: 41, target: targetDay });
}

/**
 * Resolves a dashboard selector by key and waits for the element to be visible.
 *
 * @param page - the Playwright page to search for the element
 * @param key - the Yahav dashboard selector key
 * @returns a done result after waiting
 */
async function resolveAndWait(page: Page, key: YahavDashKey): Promise<IDoneResult> {
  const fieldOpts = dashOpts(page, key);
  const r = await resolveDashboardField(fieldOpts);
  if (r.isResolved) await waitUntilElementFound(r.context, r.selector, { visible: true });
  return { done: true };
}

/**
 * Resolves a dashboard selector by key and waits for the element to disappear.
 *
 * @param page - the Playwright page to search for the element
 * @param key - the Yahav dashboard selector key
 * @returns a done result after the element disappears
 */
async function resolveAndDisappear(page: Page, key: YahavDashKey): Promise<IDoneResult> {
  const fieldOpts = dashOpts(page, key);
  const r = await resolveDashboardField(fieldOpts);
  if (r.isResolved) await waitUntilElementDisappear(page, r.selector);
  return { done: true };
}

/**
 * Resolves a dashboard selector by key and clicks the resulting element.
 *
 * @param page - the Playwright page to search for the element
 * @param key - the Yahav dashboard selector key
 * @returns a done result after clicking
 */
async function resolveAndClick(page: Page, key: YahavDashKey): Promise<IDoneResult> {
  const fieldOpts = dashOpts(page, key);
  const r = await resolveDashboardField(fieldOpts);
  if (!r.isResolved) return { done: true };
  await waitUntilElementFound(r.context, r.selector, { visible: true });
  await clickButton(r.context, r.selector);
  return { done: true };
}

/**
 * Opens the Yahav date picker by clicking the opener and waiting for the day grid.
 *
 * @param page - the Playwright page with the date picker controls
 * @returns a done result after the date picker is open
 */
async function openDatePicker(page: Page): Promise<IDoneResult> {
  await resolveAndClick(page, KEYS.datePickerOpener);
  await resolveAndWait(page, KEYS.pmuDaysFirstCell);
  return { done: true };
}

/**
 * Opens the date picker and navigates to the start date's year, month, and day.
 *
 * @param page - the Playwright page with the date filter controls
 * @param startDate - the start date to set in the date picker
 * @returns a done result after setting the date
 */
async function searchByDates(page: Page, startDate: Moment): Promise<IDoneResult> {
  const startDateDay = startDate.format('D');
  const startDateMonth = startDate.format('M');
  const startDateYear = startDate.format('Y');
  await openDatePicker(page);
  await resolveAndClick(page, KEYS.monthPickerBtn);
  await resolveAndWait(page, KEYS.monthsGridCheck);
  await resolveAndClick(page, KEYS.monthPickerBtn);
  await resolveAndWait(page, KEYS.yearsGridCheck);
  await selectYearFromGrid(page, startDateYear);
  await resolveAndWait(page, KEYS.monthsGridCheck);
  await clickButton(page, `${SEL.pmuMonthsCell}:nth-child(${startDateMonth})`);
  await selectDayFromGrid(page, startDateDay);
  return { done: true };
}

export interface IFetchAccountDataOpts {
  page: Page;
  startDate: Moment;
  accountID: string;
  options?: ScraperOptions;
}

/**
 * Applies date filter and fetches transactions for the current Yahav account.
 *
 * @param opts - options with page, start date, account ID, and scraper options
 * @returns a ITransactionsAccount with account number and transactions
 */
async function fetchAccountData(opts: IFetchAccountDataOpts): Promise<ITransactionsAccount> {
  const { page, startDate, accountID, options } = opts;
  await resolveAndDisappear(page, KEYS.loadingSpinner);
  await searchByDates(page, startDate);
  await resolveAndDisappear(page, KEYS.loadingSpinner);
  const txns = await getAccountTransactions(page, options);
  return { accountNumber: accountID, txns };
}

/**
 * Fetches all available accounts from the Yahav dashboard (currently single-account only).
 *
 * @param page - the Playwright page with an active Yahav session
 * @param startDate - the earliest date to include in the transaction search
 * @param options - scraper options for rawTransaction inclusion
 * @returns an array of ITransactionsAccount objects
 */
async function fetchAccounts(
  page: Page,
  startDate: Moment,
  options?: ScraperOptions,
): Promise<ITransactionsAccount[]> {
  const accounts: ITransactionsAccount[] = [];

  // Only one account fetched — multi-account not confirmed as supported by Yahav API.
  const accountID = await getAccountID(page);
  const accountData = await fetchAccountData({ page, startDate, accountID, options });
  accounts.push(accountData);

  return accounts;
}

export interface IScraperSpecificCredentials {
  username: string;
  password: string;
  nationalID: string;
}

/** IScraper implementation for Yahav Bank. */
class YahavScraper extends GenericBankScraper<IScraperSpecificCredentials> {
  /**
   * Creates a YahavScraper with the Yahav login configuration.
   *
   * @param options - scraper options including companyId and timeouts
   */
  constructor(options: ScraperOptions) {
    super(options, YAHAV_CONFIG);
  }

  /**
   * Navigates to the account statements page and fetches transactions.
   *
   * @returns a successful scraping result with all Yahav account transactions
   */
  public async fetchData(): Promise<{ success: boolean; accounts: ITransactionsAccount[] }> {
    // Goto statements page
    await resolveAndClick(this.page, KEYS.accountDetails);
    await resolveAndWait(this.page, KEYS.statementOptionsTop);

    const defaultStartMoment = moment().subtract(3, 'months').add(1, 'day');
    const startDate = this.options.startDate;
    const startDateMoment = moment(startDate);
    const startMoment = moment.max(defaultStartMoment, startDateMoment);

    const accounts = await fetchAccounts(this.page, startMoment, this.options);

    return {
      success: true,
      accounts,
    };
  }
}

export default YahavScraper;
