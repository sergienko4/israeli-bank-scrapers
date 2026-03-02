import moment, { type Moment } from 'moment';
import { type Page } from 'playwright';

import { SHEKEL_CURRENCY } from '../Constants';
import { CompanyTypes } from '../Definitions';
import {
  clickButton,
  pageEvalAll,
  waitUntilElementDisappear,
  waitUntilElementFound,
} from '../Helpers/ElementsInteractions';
import { getRawTransaction } from '../Helpers/Transactions';
import {
  type Transaction,
  type TransactionsAccount,
  TransactionStatuses,
  TransactionTypes,
} from '../Transactions';
import { BANK_REGISTRY } from './BankRegistry';
import { GenericBankScraper } from './GenericBankScraper';
import { type ScraperOptions } from './Interface';

const ACCOUNT_DETAILS_SELECTOR = '.account-details';
const ACCOUNT_ID_SELECTOR =
  'span.portfolio-value[ng-if="mainController.data.portfolioList.length === 1"]';
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
      return element.textContent;
    });

    return selectedSnifAccount;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to retrieve account ID. Possible outdated selector '${ACCOUNT_ID_SELECTOR}: ${errorMessage}`,
    );
  }
}

function getAmountData(amountStr: string): number {
  const amountStrCopy = amountStr.replace(',', '');
  return parseFloat(amountStrCopy);
}

function getTxnAmount(txn: ScrapedTransaction): number {
  const credit = getAmountData(txn.credit);
  const debit = getAmountData(txn.debit);
  return (Number.isNaN(credit) ? 0 : credit) - (Number.isNaN(debit) ? 0 : debit);
}

interface TransactionsTr {
  id: string;
  innerDivs: string[];
}

function convertOneTxn(txn: ScrapedTransaction, options?: ScraperOptions): Transaction {
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
  if (options?.includeRawTransaction) result.rawTransaction = getRawTransaction(txn);
  return result;
}

function convertTransactions(txns: ScrapedTransaction[], options?: ScraperOptions): Transaction[] {
  return txns.map(txn => convertOneTxn(txn, options));
}

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

async function scrapeTransactionDivs(page: Page): Promise<TransactionsTr[]> {
  return pageEvalAll<TransactionsTr[]>(page, {
    selector: '.list-item-holder .entire-content-ctr',
    defaultResult: [],
    callback: divs =>
      (divs as HTMLElement[]).map(div => ({
        id: div.getAttribute('id') ?? '',
        innerDivs: Array.from(div.getElementsByTagName('div')).map(
          el => (el as HTMLElement).innerText,
        ),
      })),
  });
}

async function getAccountTransactions(
  page: Page,
  options?: ScraperOptions,
): Promise<Transaction[]> {
  await waitUntilElementFound(page, '.under-line-txn-table-header', { visible: true });
  const txns: ScrapedTransaction[] = [];
  const transactionsDivs = await scrapeTransactionDivs(page);
  for (const txnRow of transactionsDivs) {
    handleTransactionRow(txns, txnRow);
  }
  return convertTransactions(txns, options);
}

async function selectYearFromGrid(page: Page, targetYear: string): Promise<void> {
  for (let i = 1; i < 13; i += 1) {
    const selector = `.pmu-years > div:nth-child(${i})`;
    const year = await page.$eval(selector, y => (y as HTMLElement).innerText);
    if (targetYear === year) {
      await clickButton(page, selector);
      break;
    }
  }
}

async function selectDayFromGrid(page: Page, targetDay: string): Promise<void> {
  for (let i = 1; i < 42; i += 1) {
    const selector = `.pmu-days > div:nth-child(${i})`;
    const day = await page.$eval(selector, d => (d as HTMLElement).innerText);
    if (targetDay === day) {
      await clickButton(page, selector);
      break;
    }
  }
}

async function openDatePicker(page: Page): Promise<void> {
  const dateFromPick =
    'div.date-options-cell:nth-child(7) > date-picker:nth-child(1) > div:nth-child(1) > span:nth-child(2)';
  await waitUntilElementFound(page, dateFromPick, { visible: true });
  await clickButton(page, dateFromPick);
  await waitUntilElementFound(page, '.pmu-days > div:nth-child(1)', { visible: true });
}

async function searchByDates(page: Page, startDate: Moment): Promise<void> {
  const startDateDay = startDate.format('D');
  const startDateMonth = startDate.format('M');
  const startDateYear = startDate.format('Y');
  const monthFromPick = '.pmu-month';
  await openDatePicker(page);
  await waitUntilElementFound(page, monthFromPick, { visible: true });
  await clickButton(page, monthFromPick);
  await waitUntilElementFound(page, '.pmu-months > div:nth-child(1)', { visible: true });
  await waitUntilElementFound(page, monthFromPick, { visible: true });
  await clickButton(page, monthFromPick);
  await waitUntilElementFound(page, '.pmu-years > div:nth-child(1)', { visible: true });
  await selectYearFromGrid(page, startDateYear);
  await waitUntilElementFound(page, '.pmu-months > div:nth-child(1)', { visible: true });
  await clickButton(page, `.pmu-months > div:nth-child(${startDateMonth})`);
  await selectDayFromGrid(page, startDateDay);
}

interface FetchAccDataOpts {
  page: Page;
  startDate: Moment;
  accountID: string;
  options?: ScraperOptions;
}

async function fetchAccountData(opts: FetchAccDataOpts): Promise<TransactionsAccount> {
  const { page, startDate, accountID, options } = opts;
  await waitUntilElementDisappear(page, '.loading-bar-spinner');
  await searchByDates(page, startDate);
  await waitUntilElementDisappear(page, '.loading-bar-spinner');
  const txns = await getAccountTransactions(page, options);
  return { accountNumber: accountID, txns };
}

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

interface ScraperSpecificCredentials {
  username: string;
  password: string;
  nationalID: string;
}

class YahavScraper extends GenericBankScraper<ScraperSpecificCredentials> {
  constructor(options: ScraperOptions) {
    super(options, BANK_REGISTRY[CompanyTypes.Yahav]!);
  }

  async fetchData(): Promise<{ success: boolean; accounts: TransactionsAccount[] }> {
    // Goto statements page
    await waitUntilElementFound(this.page, ACCOUNT_DETAILS_SELECTOR, { visible: true });
    await clickButton(this.page, ACCOUNT_DETAILS_SELECTOR);
    await waitUntilElementFound(this.page, '.statement-options .selected-item-top', {
      visible: true,
    });

    const defaultStartMoment = moment().subtract(3, 'months').add(1, 'day');
    const startDate = this.options.startDate;
    const startMoment = moment.max(defaultStartMoment, moment(startDate));

    const accounts = await fetchAccounts(this.page, startMoment, this.options);

    return {
      success: true,
      accounts,
    };
  }
}

export default YahavScraper;
