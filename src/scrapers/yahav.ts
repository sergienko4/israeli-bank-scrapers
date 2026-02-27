import moment, { type Moment } from 'moment';
import { type Page } from 'playwright';
import { SHEKEL_CURRENCY } from '../constants';
import {
  clickButton,
  pageEvalAll,
  waitUntilElementDisappear,
  waitUntilElementFound,
} from '../helpers/elements-interactions';
import { getRawTransaction } from '../helpers/transactions';
import { TransactionStatuses, TransactionTypes, type Transaction, type TransactionsAccount } from '../transactions';
import { type ScraperOptions } from './interface';
import { CompanyTypes } from '../definitions';
import { BANK_REGISTRY } from './bank-registry';
import { GenericBankScraper } from './generic-bank-scraper';

const ACCOUNT_DETAILS_SELECTOR = '.account-details';
const ACCOUNT_ID_SELECTOR = 'span.portfolio-value[ng-if="mainController.data.portfolioList.length === 1"]';
const DATE_FORMAT = 'DD/MM/YYYY';

interface ScrapedTransaction {
  credit: string;
  debit: string;
  date: string;
  reference?: string;
  description: string;
  memo: string;
  status: TransactionStatuses;
}

async function getAccountID(page: Page): Promise<string> {
  try {
    const selectedSnifAccount = await page.$eval(ACCOUNT_ID_SELECTOR, (element: Element) => {
      return element.textContent ?? '';
    });

    return selectedSnifAccount;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to retrieve account ID. Possible outdated selector '${ACCOUNT_ID_SELECTOR}: ${errorMessage}`,
    );
  }
}

function getAmountData(amountStr: string) {
  const amountStrCopy = amountStr.replace(',', '');
  return parseFloat(amountStrCopy);
}

function getTxnAmount(txn: ScrapedTransaction) {
  const credit = getAmountData(txn.credit);
  const debit = getAmountData(txn.debit);
  return (Number.isNaN(credit) ? 0 : credit) - (Number.isNaN(debit) ? 0 : debit);
}

type TransactionsTr = { id: string; innerDivs: string[] };

function convertTransactions(txns: ScrapedTransaction[], options?: ScraperOptions): Transaction[] {
  return txns.map(txn => {
    const convertedDate = moment(txn.date, DATE_FORMAT).toISOString();
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

    if (options?.includeRawTransaction) {
      result.rawTransaction = getRawTransaction(txn);
    }

    return result;
  });
}

function handleTransactionRow(txns: ScrapedTransaction[], txnRow: TransactionsTr) {
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

async function getAccountTransactions(page: Page, options?: ScraperOptions): Promise<Transaction[]> {
  // Wait for transactions.
  await waitUntilElementFound(page, '.under-line-txn-table-header', true);

  const txns: ScrapedTransaction[] = [];
  const transactionsDivs = await pageEvalAll<TransactionsTr[]>(
    page,
    '.list-item-holder .entire-content-ctr',
    [],
    divs => {
      return (divs as HTMLElement[]).map(div => ({
        id: div.getAttribute('id') || '',
        innerDivs: Array.from(div.getElementsByTagName('div')).map(el => (el as HTMLElement).innerText),
      }));
    },
  );

  for (const txnRow of transactionsDivs) {
    handleTransactionRow(txns, txnRow);
  }

  return convertTransactions(txns, options);
}

// Manipulate the calendar drop down to choose the txs start date.
async function searchByDates(page: Page, startDate: Moment) {
  // Get the day number from startDate. 1-31 (usually 1)
  const startDateDay = startDate.format('D');
  const startDateMonth = startDate.format('M');
  const startDateYear = startDate.format('Y');

  // Open the calendar date picker
  const dateFromPick =
    'div.date-options-cell:nth-child(7) > date-picker:nth-child(1) > div:nth-child(1) > span:nth-child(2)';
  await waitUntilElementFound(page, dateFromPick, true);
  await clickButton(page, dateFromPick);

  // Wait until first day appear.
  await waitUntilElementFound(page, '.pmu-days > div:nth-child(1)', true);

  // Open Months options.
  const monthFromPick = '.pmu-month';
  await waitUntilElementFound(page, monthFromPick, true);
  await clickButton(page, monthFromPick);
  await waitUntilElementFound(page, '.pmu-months > div:nth-child(1)', true);

  // Open Year options.
  // Use same selector... Yahav knows why...
  await waitUntilElementFound(page, monthFromPick, true);
  await clickButton(page, monthFromPick);
  await waitUntilElementFound(page, '.pmu-years > div:nth-child(1)', true);

  // Select year from a 12 year grid.
  for (let i = 1; i < 13; i += 1) {
    const selector = `.pmu-years > div:nth-child(${i})`;
    const year = await page.$eval(selector, y => {
      return (y as HTMLElement).innerText;
    });
    if (startDateYear === year) {
      await clickButton(page, selector);
      break;
    }
  }

  // Select Month.
  await waitUntilElementFound(page, '.pmu-months > div:nth-child(1)', true);
  // The first element (1) is January.
  const monthSelector = `.pmu-months > div:nth-child(${startDateMonth})`;
  await clickButton(page, monthSelector);

  // Select Day.
  // The calendar grid shows 7 days and 6 weeks = 42 days.
  // In theory, the first day of the month will be in the first row.
  // Let's check everything just in case...
  for (let i = 1; i < 42; i += 1) {
    const selector = `.pmu-days > div:nth-child(${i})`;
    const day = await page.$eval(selector, d => {
      return (d as HTMLElement).innerText;
    });

    if (startDateDay === day) {
      await clickButton(page, selector);
      break;
    }
  }
}

async function fetchAccountData(
  page: Page,
  startDate: Moment,
  accountID: string,
  options?: ScraperOptions,
): Promise<TransactionsAccount> {
  await waitUntilElementDisappear(page, '.loading-bar-spinner');
  await searchByDates(page, startDate);
  await waitUntilElementDisappear(page, '.loading-bar-spinner');
  const txns = await getAccountTransactions(page, options);

  return {
    accountNumber: accountID,
    txns,
  };
}

async function fetchAccounts(page: Page, startDate: Moment, options?: ScraperOptions): Promise<TransactionsAccount[]> {
  const accounts: TransactionsAccount[] = [];

  // TODO: get more accounts. Not sure is supported.
  const accountID = await getAccountID(page);
  const accountData = await fetchAccountData(page, startDate, accountID, options);
  accounts.push(accountData);

  return accounts;
}

type ScraperSpecificCredentials = { username: string; password: string; nationalID: string };

class YahavScraper extends GenericBankScraper<ScraperSpecificCredentials> {
  constructor(options: ScraperOptions) {
    super(options, BANK_REGISTRY[CompanyTypes.yahav]!);
  }

  async fetchData() {
    // Goto statements page
    await waitUntilElementFound(this.page, ACCOUNT_DETAILS_SELECTOR, true);
    await clickButton(this.page, ACCOUNT_DETAILS_SELECTOR);
    await waitUntilElementFound(this.page, '.statement-options .selected-item-top', true);

    const defaultStartMoment = moment().subtract(3, 'months').add(1, 'day');
    const startDate = this.options.startDate || defaultStartMoment.toDate();
    const startMoment = moment.max(defaultStartMoment, moment(startDate));

    const accounts = await fetchAccounts(this.page, startMoment, this.options);

    return {
      success: true,
      accounts,
    };
  }
}

export default YahavScraper;
