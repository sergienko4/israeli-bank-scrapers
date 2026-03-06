import moment, { type Moment } from 'moment';
import { type Page } from 'playwright';

import {
  clickButton,
  pageEvalAll,
  waitUntilElementDisappear,
  waitUntilElementFound,
} from '../../Common/ElementsInteractions';
import {
  type DashboardFieldOpts,
  resolveDashboardField,
  toFirstCss,
} from '../../Common/SelectorResolver';
import { getRawTransaction } from '../../Common/Transactions';
import { SHEKEL_CURRENCY } from '../../Constants';
import { CompanyTypes } from '../../Definitions';
import {
  type Transaction,
  type TransactionsAccount,
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
 * Builds a DashboardFieldOpts for a Yahav selector key.
 *
 * @param page - the Playwright page to resolve the selector in
 * @param key - the Yahav dashboard selector key
 * @returns a DashboardFieldOpts ready for resolveDashboardField()
 */
function dashOpts(page: Page, key: YahavDashKey): DashboardFieldOpts {
  return {
    pageOrFrame: page,
    fieldKey: key,
    bankCandidates: [...(CFG.selectors[key] as SelectorCandidate[])],
    pageUrl: page.url(),
  };
}

export interface ScrapedTransaction {
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
function getTxnAmount(txn: ScrapedTransaction): number {
  const credit = getAmountData(txn.credit);
  const debit = getAmountData(txn.debit);
  return (Number.isNaN(credit) ? 0 : credit) - (Number.isNaN(debit) ? 0 : debit);
}

export interface TransactionsTr {
  id: string;
  innerDivs: string[];
}

/**
 * Converts a single scraped Yahav transaction to a normalized Transaction.
 *
 * @param txn - the raw scraped Yahav transaction
 * @param options - scraper options controlling rawTransaction inclusion
 * @returns a normalized Transaction object
 */
function convertOneTxn(txn: ScrapedTransaction, options?: ScraperOptions): Transaction {
  const convertedDate = moment(txn.date, CFG.format.date).toISOString();
  const convertedAmount = getTxnAmount(txn);
  const result: Transaction = {
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
 * Converts an array of scraped Yahav transactions to normalized Transaction objects.
 *
 * @param txns - the raw scraped transactions
 * @param options - scraper options controlling rawTransaction inclusion
 * @returns an array of normalized Transaction objects
 */
function convertTransactions(txns: ScrapedTransaction[], options?: ScraperOptions): Transaction[] {
  return txns.map(txn => convertOneTxn(txn, options));
}

/**
 * Parses a single transaction row div into a ScrapedTransaction and appends to the accumulator.
 *
 * @param txns - the accumulator array to append the parsed transaction to
 * @param txnRow - the raw transaction row with div contents
 */
function handleTransactionRow(txns: ScrapedTransaction[], txnRow: TransactionsTr): void {
  const div = txnRow.innerDivs;

  // Remove anything except digits.
  const regex = /\D+/gm;

  const tx: ScrapedTransaction = {
    date: div[1],
    reference: div[2].replace(regex, ''),
    memo: '',
    description: div[3],
    debit: div[4],
    credit: div[5],
    status: TransactionStatuses.Completed,
  };

  txns.push(tx);
}

/**
 * Extracts all transaction div elements from the Yahav transactions table.
 *
 * @param page - the Playwright page showing the transactions table
 * @returns an array of TransactionsTr objects with div text contents
 */
async function scrapeTransactionDivs(page: Page): Promise<TransactionsTr[]> {
  return pageEvalAll<TransactionsTr[]>(page, {
    selector: SEL.transactionRows,
    defaultResult: [],
    /**
     * Maps each transaction div to a TransactionsTr with ID and inner div texts.
     *
     * @param divs - the list of transaction div elements
     * @returns an array of TransactionsTr objects
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
 * @returns an array of normalized Transaction objects
 */
async function getAccountTransactions(
  page: Page,
  options?: ScraperOptions,
): Promise<Transaction[]> {
  await waitUntilElementFound(page, SEL.transactionTableHeader, { visible: true });
  const txns: ScrapedTransaction[] = [];
  const transactionsDivs = await scrapeTransactionDivs(page);
  for (const txnRow of transactionsDivs) {
    handleTransactionRow(txns, txnRow);
  }
  return convertTransactions(txns, options);
}

export interface SelectFromGridOpts {
  page: Page;
  baseSelector: string;
  count: number;
  target: string;
}

/**
 * Clicks the grid item that matches the target text.
 *
 * @param opts - options with page, base selector, item count, and target text
 */
async function selectFromGrid(opts: SelectFromGridOpts): Promise<void> {
  const { page, baseSelector, count, target } = opts;
  const indices = Array.from({ length: count }, (_, i) => i + 1);
  const textPromises = indices.map(i =>
    page.$eval(`${baseSelector}:nth-child(${String(i)})`, el => (el as HTMLElement).innerText),
  );
  const texts = await Promise.all(textPromises);
  const matchIdx = texts.findIndex(t => t === target);
  if (matchIdx >= 0) await clickButton(page, `${baseSelector}:nth-child(${String(matchIdx + 1)})`);
}

/**
 * Selects a year from the Yahav date picker year grid.
 *
 * @param page - the Playwright page with the date picker open
 * @param targetYear - the year string to select (e.g. '2024')
 */
async function selectYearFromGrid(page: Page, targetYear: string): Promise<void> {
  await selectFromGrid({ page, baseSelector: SEL.pmuYearsCell, count: 12, target: targetYear });
}

/**
 * Selects a day from the Yahav date picker day grid.
 *
 * @param page - the Playwright page with the date picker open
 * @param targetDay - the day string to select (e.g. '15')
 */
async function selectDayFromGrid(page: Page, targetDay: string): Promise<void> {
  await selectFromGrid({ page, baseSelector: SEL.pmuDaysCell, count: 41, target: targetDay });
}

/**
 * Resolves a dashboard selector by key and waits for the element to be visible.
 *
 * @param page - the Playwright page to search for the element
 * @param key - the Yahav dashboard selector key
 */
async function resolveAndWait(page: Page, key: YahavDashKey): Promise<void> {
  const fieldOpts = dashOpts(page, key);
  const r = await resolveDashboardField(fieldOpts);
  if (r.isResolved) await waitUntilElementFound(r.context, r.selector, { visible: true });
}

/**
 * Resolves a dashboard selector by key and waits for the element to disappear.
 *
 * @param page - the Playwright page to search for the element
 * @param key - the Yahav dashboard selector key
 */
async function resolveAndDisappear(page: Page, key: YahavDashKey): Promise<void> {
  const fieldOpts = dashOpts(page, key);
  const r = await resolveDashboardField(fieldOpts);
  if (r.isResolved) await waitUntilElementDisappear(page, r.selector);
}

/**
 * Resolves a dashboard selector by key and clicks the resulting element.
 *
 * @param page - the Playwright page to search for the element
 * @param key - the Yahav dashboard selector key
 */
async function resolveAndClick(page: Page, key: YahavDashKey): Promise<void> {
  const fieldOpts = dashOpts(page, key);
  const r = await resolveDashboardField(fieldOpts);
  if (!r.isResolved) return;
  await waitUntilElementFound(r.context, r.selector, { visible: true });
  await clickButton(r.context, r.selector);
}

/**
 * Opens the Yahav date picker by clicking the opener and waiting for the day grid.
 *
 * @param page - the Playwright page with the date picker controls
 */
async function openDatePicker(page: Page): Promise<void> {
  await resolveAndClick(page, KEYS.datePickerOpener);
  await resolveAndWait(page, KEYS.pmuDaysFirstCell);
}

/**
 * Opens the date picker and navigates to the start date's year, month, and day.
 *
 * @param page - the Playwright page with the date filter controls
 * @param startDate - the start date to set in the date picker
 */
async function searchByDates(page: Page, startDate: Moment): Promise<void> {
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
}

export interface FetchAccDataOpts {
  page: Page;
  startDate: Moment;
  accountID: string;
  options?: ScraperOptions;
}

/**
 * Applies date filter and fetches transactions for the current Yahav account.
 *
 * @param opts - options with page, start date, account ID, and scraper options
 * @returns a TransactionsAccount with account number and transactions
 */
async function fetchAccountData(opts: FetchAccDataOpts): Promise<TransactionsAccount> {
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
 * @returns an array of TransactionsAccount objects
 */
async function fetchAccounts(
  page: Page,
  startDate: Moment,
  options?: ScraperOptions,
): Promise<TransactionsAccount[]> {
  const accounts: TransactionsAccount[] = [];

  // Only one account fetched — multi-account not confirmed as supported by Yahav API.
  const accountID = await getAccountID(page);
  const accountData = await fetchAccountData({ page, startDate, accountID, options });
  accounts.push(accountData);

  return accounts;
}

export interface ScraperSpecificCredentials {
  username: string;
  password: string;
  nationalID: string;
}

/** Scraper implementation for Yahav Bank. */
class YahavScraper extends GenericBankScraper<ScraperSpecificCredentials> {
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
  public async fetchData(): Promise<{ success: boolean; accounts: TransactionsAccount[] }> {
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
