import moment, { type Moment } from 'moment';
import { type Page } from 'playwright';

import { clickButton, fillInput, waitUntilElementFound } from '../../Common/ElementsInteractions';
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
import { type ScraperOptions, type ScraperScrapingResult } from '../Base/Interface';
import { type SelectorCandidate } from '../Base/LoginConfig';
import { ScraperWebsiteChangedError } from '../Base/ScraperWebsiteChangedError';
import { SCRAPER_CONFIGURATION } from '../Registry/ScraperConfig';
import { LEUMI_CONFIG } from './LeumiLoginConfig';

const CFG = SCRAPER_CONFIGURATION.banks[CompanyTypes.Leumi];
// SEL kept for fields not yet migrated to resolveDashboardField (accountListItems, accountCombo)
const SEL = Object.fromEntries(
  Object.entries(CFG.selectors).map(([k, cs]) => [k, toFirstCss(cs)]),
) as Record<string, string>;
const TRANSACTIONS_URL = CFG.urls.transactions;

export type LeumiDashKey = keyof typeof CFG.selectors;
// Typed key constants derived from config — no inline string literals in scraper code
const KEYS = Object.fromEntries(Object.keys(CFG.selectors).map(k => [k, k])) as {
  [K in LeumiDashKey]: K;
};

function dashOpts(page: Page, key: LeumiDashKey): DashboardFieldOpts {
  return {
    pageOrFrame: page,
    fieldKey: key,
    bankCandidates: [...(CFG.selectors[key] as SelectorCandidate[])],
    pageUrl: page.url(),
  };
}
const LEUMI_TRXS_PATH =
  '/ChannelWCF/Broker.svc/ProcessRequest?moduleName=UC_SO_27_GetBusinessAccountTrx';
const FILTERED_TRANSACTIONS_URL = `${CFG.api.base}${LEUMI_TRXS_PATH}`;

export interface LeumiRawTransaction {
  DateUTC: string;
  Description?: string;
  ReferenceNumberLong?: number;
  AdditionalData?: string;
  Amount: number;
}

function buildTxnBase(
  rawTransaction: LeumiRawTransaction,
  status: TransactionStatuses,
  date: string,
): Transaction {
  return {
    status,
    type: TransactionTypes.Normal,
    date,
    processedDate: date,
    description: rawTransaction.Description ?? '',
    identifier: rawTransaction.ReferenceNumberLong,
    memo: rawTransaction.AdditionalData ?? '',
    originalCurrency: SHEKEL_CURRENCY,
    chargedAmount: rawTransaction.Amount,
    originalAmount: rawTransaction.Amount,
  };
}

function mapOneTxn(
  rawTransaction: LeumiRawTransaction,
  status: TransactionStatuses,
  options?: ScraperOptions,
): Transaction {
  const date = moment(rawTransaction.DateUTC).milliseconds(0).toISOString();
  const tx = buildTxnBase(rawTransaction, status, date);
  if (options?.includeRawTransaction) tx.rawTransaction = getRawTransaction(rawTransaction);
  return tx;
}

function extractTransactionsFromPage(
  transactions: LeumiRawTransaction[] | null,
  status: TransactionStatuses,
  options?: ScraperOptions,
): Transaction[] {
  if (!transactions || transactions.length === 0) return [];
  return transactions.map(rawTransaction => mapOneTxn(rawTransaction, status, options));
}

function hangProcess(timeout: number): Promise<void> {
  return new Promise<void>(resolve => {
    setTimeout(() => {
      resolve();
    }, timeout);
  });
}

async function clickByXPath(page: Page, xpath: string): Promise<void> {
  await page.waitForSelector(xpath, { timeout: 30000, state: 'visible' });
  const elm = await page.$$(xpath);
  await elm[0].click();
}

function removeSpecialCharacters(str: string): string {
  return str.replace(/[^0-9/-]/g, '');
}

export interface FetchForAccountOpts {
  page: Page;
  startDate: Moment;
  accountId: string;
  options: ScraperOptions;
}

async function resolveAndClick(page: Page, key: LeumiDashKey): Promise<void> {
  const r = await resolveDashboardField(dashOpts(page, key));
  if (!r.isResolved) return;
  await waitUntilElementFound(r.context, r.selector, { visible: true });
  await clickButton(r.context, r.selector);
}

async function applyDateFilter(page: Page, startDate: Moment): Promise<void> {
  await resolveAndClick(page, KEYS.advancedSearchBtn);
  await resolveAndClick(page, KEYS.dateRangeRadio);
  const dateInput = await resolveDashboardField(dashOpts(page, KEYS.dateFromInput));
  if (dateInput.isResolved) {
    await waitUntilElementFound(dateInput.context, dateInput.selector, { visible: true });
    await fillInput(dateInput.context, dateInput.selector, startDate.format(CFG.format.date));
  }
  await resolveAndClick(page, KEYS.filterBtn);
}

export interface LeumiAccountResponse {
  BalanceDisplay?: string;
  TodayTransactionsItems: LeumiRawTransaction[] | null;
  HistoryTransactionsItems: LeumiRawTransaction[] | null;
}

function parseAccountResponse(responseJson: { jsonResp: string }): LeumiAccountResponse {
  return JSON.parse(responseJson.jsonResp) as LeumiAccountResponse;
}

function buildTxnsFromResponse(
  response: LeumiAccountResponse,
  options: ScraperOptions,
): Transaction[] {
  const pending = extractTransactionsFromPage(
    response.TodayTransactionsItems,
    TransactionStatuses.Pending,
    options,
  );
  const completed = extractTransactionsFromPage(
    response.HistoryTransactionsItems,
    TransactionStatuses.Completed,
    options,
  );
  return [...pending, ...completed];
}

async function interceptFilteredResponse(page: Page): Promise<LeumiAccountResponse> {
  const finalResponse = await page.waitForResponse(
    response =>
      response.url() === FILTERED_TRANSACTIONS_URL && response.request().method() === 'POST',
  );
  return parseAccountResponse((await finalResponse.json()) as { jsonResp: string });
}

function sanitizeAccountId(accountId: string): string {
  return accountId.replace('/', '_').replace(/[^\d-_]/g, '');
}

async function fetchTransactionsForAccount(
  opts: FetchForAccountOpts,
): Promise<TransactionsAccount> {
  const { page, startDate, accountId, options } = opts;
  await hangProcess(4000);
  await applyDateFilter(page, startDate);
  const response = await interceptFilteredResponse(page);
  const accountNumber = sanitizeAccountId(accountId);
  const balance = response.BalanceDisplay ? parseFloat(response.BalanceDisplay) : undefined;
  return { accountNumber, balance, txns: buildTxnsFromResponse(response, options) };
}

async function extractAccountIds(page: Page): Promise<string[]> {
  const ids = await page.evaluate(
    sel => Array.from(document.querySelectorAll(sel), e => e.textContent),
    SEL.accountListItems,
  );
  if (!ids.length)
    throw new ScraperWebsiteChangedError('Leumi', 'Failed to extract or parse the account number');
  return ids;
}

async function switchToAccount(
  page: Page,
  accountId: string,
  totalAccounts: number,
): Promise<void> {
  if (totalAccounts <= 1) return;
  await clickByXPath(page, SEL.accountCombo);
  await clickByXPath(page, `xpath=//span[contains(text(), '${accountId}')]`);
}

export interface FetchByIdOpts {
  page: Page;
  rawAccountId: string;
  totalAccounts: number;
  startDate: Moment;
  options: ScraperOptions;
}

async function fetchAccountById(opts: FetchByIdOpts): Promise<TransactionsAccount> {
  const { rawAccountId, totalAccounts, page, startDate, options } = opts;
  await switchToAccount(page, rawAccountId, totalAccounts);
  const accountId = removeSpecialCharacters(rawAccountId);
  return fetchTransactionsForAccount({ page, startDate, accountId, options });
}

async function fetchTransactions(
  page: Page,
  startDate: Moment,
  options: ScraperOptions,
): Promise<TransactionsAccount[]> {
  await hangProcess(4000);
  const accountsIds = await extractAccountIds(page);
  const totalAccounts = accountsIds.length;
  return accountsIds.reduce(
    async (acc, rawAccountId) => [
      ...(await acc),
      await fetchAccountById({ page, rawAccountId, totalAccounts, startDate, options }),
    ],
    Promise.resolve<TransactionsAccount[]>([]),
  );
}

export interface ScraperSpecificCredentials {
  username: string;
  password: string;
}

class LeumiScraper extends GenericBankScraper<ScraperSpecificCredentials> {
  constructor(options: ScraperOptions) {
    super(options, LEUMI_CONFIG);
  }

  public async fetchData(): Promise<ScraperScrapingResult> {
    const minimumStartMoment = moment().subtract(3, 'years').add(1, 'day');
    const startMoment = moment.max(minimumStartMoment, moment(this.options.startDate));

    await this.navigateTo(TRANSACTIONS_URL);

    const accounts = await fetchTransactions(this.page, startMoment, this.options);

    return {
      success: true,
      accounts,
    };
  }
}

export default LeumiScraper;
