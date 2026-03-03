import moment, { type Moment } from 'moment';
import { type Frame, type Page } from 'playwright';

import {
  clickButton,
  elementPresentOnPage,
  fillInput,
  pageEvalAll,
  waitUntilElementFound,
} from '../../Common/ElementsInteractions';
import { waitForNavigation } from '../../Common/Navigation';
import { CompanyTypes } from '../../Definitions';
import {
  type Transaction,
  type TransactionsAccount,
  TransactionStatuses,
} from '../../Transactions';
import { GenericBankScraper } from '../Base/GenericBankScraper';
import { type ScraperOptions } from '../Base/Interface';
import {
  getAccountIdsBothUIs,
  getTransactionsFrame,
  selectAccountFromDropdown,
} from '../Beinleumi/BeinleumiAccountSelector';
export {
  clickAccountSelectorGetAccountIds,
  selectAccountFromDropdown,
} from '../Beinleumi/BeinleumiAccountSelector';
import { SCRAPER_CONFIGURATION } from '../Registry/ScraperConfig';
import {
  convertTransactions,
  ERROR_MESSAGE_CLASS,
  extractTransaction,
  getTransactionsColsTypeClasses,
  isNoTransactionInDateRangeError,
  type ScrapedTransaction,
  type TransactionsTr,
} from './BaseBeinleumiGroupHelpers';

// All Beinleumi group banks share the same selectors and timing
const BEINLEUMI_CFG = SCRAPER_CONFIGURATION.banks[CompanyTypes.Beinleumi];
const SEL = BEINLEUMI_CFG.selectors;
const ELEMENT_RENDER_TIMEOUT_MS = BEINLEUMI_CFG.timing.elementRenderMs;

async function extractTransactions(
  page: Page | Frame,
  tableLocator: string,
  transactionStatus: TransactionStatuses,
): Promise<ScrapedTransaction[]> {
  const txns: ScrapedTransaction[] = [];
  const transactionsColsTypes = await getTransactionsColsTypeClasses(page, tableLocator);
  const transactionsRows = await pageEvalAll<TransactionsTr[]>(page, {
    selector: `${tableLocator} tbody tr`,
    defaultResult: [],
    callback: trs =>
      trs.map(tr => ({
        innerTds: Array.from(tr.getElementsByTagName('td')).map(td => td.innerText),
      })),
  });
  for (const txnRow of transactionsRows) {
    extractTransaction({ txns, transactionStatus, txnRow, transactionsColsTypes });
  }
  return txns;
}

async function searchByDates(page: Page | Frame, startDate: Moment): Promise<void> {
  await clickButton(page, SEL.transactionsTab);
  await waitUntilElementFound(page, SEL.datesContainer);
  await fillInput(page, SEL.fromDateInput, startDate.format(BEINLEUMI_CFG.format.date));
  await clickButton(page, `button[class*=${SEL.closeDatePickerClass}]`);
  await clickButton(page, SEL.showButton);
  await waitForNavigation(page);
}

async function getAccountNumber(page: Page | Frame): Promise<string> {
  await waitUntilElementFound(page, SEL.accountsNumber, {
    visible: true,
    timeout: ELEMENT_RENDER_TIMEOUT_MS,
  });
  const selectedSnifAccount = await page.$eval(
    SEL.accountsNumber,
    option => (option as HTMLElement).innerText,
  );
  return selectedSnifAccount.replace('/', '_').trim();
}

interface ScrapeOpts {
  page: Page | Frame;
  tableLocator: string;
  transactionStatus: TransactionStatuses;
  shouldPaginate: boolean;
  options?: ScraperOptions;
}

async function scrapeTransactions(opts: ScrapeOpts): Promise<Transaction[]> {
  const { page, tableLocator, transactionStatus, shouldPaginate, options } = opts;
  const txns: ScrapedTransaction[] = [];
  let hasNextPage = false;
  do {
    txns.push(...(await extractTransactions(page, tableLocator, transactionStatus)));
    if (shouldPaginate) {
      hasNextPage = await elementPresentOnPage(page, SEL.nextPageLink);
      if (hasNextPage) {
        await clickButton(page, SEL.nextPageLink);
        await waitForNavigation(page);
      }
    }
  } while (hasNextPage);
  return convertTransactions(txns, options);
}

async function fetchPendingAndCompleted(
  page: Page | Frame,
  options?: ScraperOptions,
): Promise<Transaction[]> {
  const pendingTxns = await scrapeTransactions({
    page,
    tableLocator: SEL.pendingTransactionsTable,
    transactionStatus: TransactionStatuses.Pending,
    shouldPaginate: false,
    options,
  });
  const completedTxns = await scrapeTransactions({
    page,
    tableLocator: SEL.completedTransactionsTable,
    transactionStatus: TransactionStatuses.Completed,
    shouldPaginate: true,
    options,
  });
  return [...pendingTxns, ...completedTxns];
}

async function getAccountTransactions(
  page: Page | Frame,
  options?: ScraperOptions,
): Promise<Transaction[]> {
  await Promise.race([
    waitUntilElementFound(page, SEL.tableContainer, { visible: false }),
    waitUntilElementFound(page, `.${ERROR_MESSAGE_CLASS}`, { visible: false }),
  ]);
  if (await isNoTransactionInDateRangeError(page)) return [];
  return fetchPendingAndCompleted(page, options);
}

async function getCurrentBalance(page: Page | Frame): Promise<number> {
  await waitUntilElementFound(page, SEL.currentBalance, {
    visible: true,
    timeout: ELEMENT_RENDER_TIMEOUT_MS,
  });
  const balanceStr = await page.$eval(SEL.currentBalance, el => (el as HTMLElement).innerText);
  return parseFloat(balanceStr.replace(/[^0-9.,-]/g, '').replaceAll(',', ''));
}

export async function waitForPostLogin(page: Page): Promise<void> {
  return Promise.race([
    waitUntilElementFound(page, '#card-header', { visible: false }),
    waitUntilElementFound(page, '#account_num', { visible: true }),
    waitUntilElementFound(page, '#matafLogoutLink', { visible: true }),
    waitUntilElementFound(page, '#validationMsg', { visible: true }),
  ]);
}

async function fetchAccountData(
  page: Page | Frame,
  startDate: Moment,
  options?: ScraperOptions,
): Promise<TransactionsAccount> {
  const accountNumber = await getAccountNumber(page);
  const balance = await getCurrentBalance(page);
  await searchByDates(page, startDate);
  const txns = await getAccountTransactions(page, options);
  return { accountNumber, txns, balance };
}

async function selectAccountBothUIs(page: Page, accountId: string): Promise<void> {
  const isAccountSelected = await selectAccountFromDropdown(page, accountId);
  if (!isAccountSelected) {
    await page.selectOption('#account_num_select', accountId);
    await waitUntilElementFound(page, '#account_num_select', { visible: true });
  }
}

async function fetchAccountDataBothUIs(
  page: Page,
  startDate: Moment,
  options?: ScraperOptions,
): Promise<TransactionsAccount> {
  const frame = await getTransactionsFrame(page);
  return fetchAccountData(frame ?? page, startDate, options);
}

async function fetchAccounts(
  page: Page,
  startDate: Moment,
  options?: ScraperOptions,
): Promise<TransactionsAccount[]> {
  const accountsIds = await getAccountIdsBothUIs(page);
  if (accountsIds.length === 0) return [await fetchAccountDataBothUIs(page, startDate, options)];
  const accounts: TransactionsAccount[] = [];
  for (const accountId of accountsIds) {
    await selectAccountBothUIs(page, accountId);
    accounts.push(await fetchAccountDataBothUIs(page, startDate, options));
  }
  return accounts;
}

interface ScraperSpecificCredentials {
  username: string;
  password: string;
}

abstract class BeinleumiGroupBaseScraper extends GenericBankScraper<ScraperSpecificCredentials> {
  async fetchData(): Promise<{ success: boolean; accounts: TransactionsAccount[] }> {
    const startMomentLimit = moment({ year: 1600 });
    const startMoment = moment.max(startMomentLimit, moment(this.options.startDate));
    const transactionsUrl = SCRAPER_CONFIGURATION.banks[this.options.companyId].urls.transactions!;
    await this.navigateTo(transactionsUrl);
    const accounts = await fetchAccounts(this.page, startMoment, this.options);
    return { success: true, accounts };
  }
}

export default BeinleumiGroupBaseScraper;
