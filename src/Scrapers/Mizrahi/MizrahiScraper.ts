import moment from 'moment';
import type { Page } from 'playwright-core';

import { waitUntilIframeFound } from '../../Common/ElementsInteractions.js';
import { fetchPostWithinPage } from '../../Common/Fetch.js';
import { runSerial } from '../../Common/Waiting.js';
import { CompanyTypes } from '../../Definitions.js';
import {
  type ITransaction,
  type ITransactionsAccount,
  TransactionStatuses,
} from '../../Transactions.js';
import { ScraperErrorTypes } from '../Base/Errors.js';
import GenericBankScraper from '../Base/GenericBankScraper.js';
import type { IScraperScrapingResult, ScraperOptions } from '../Base/Interface.js';
import ScraperError from '../Base/ScraperError.js';
import { SCRAPER_CONFIGURATION } from '../Registry/Config/ScraperConfig.js';
import { WELL_KNOWN_DASHBOARD_SELECTORS } from '../Registry/WellKnownSelectors.js';
import { MIZRAHI_CONFIG } from './Config/MizrahiLoginConfig.js';
import { convertTransactions, extractPendingTxns } from './MizrahiConverters.js';
import {
  createDataFromRequest,
  createHeadersFromRequest,
  GENERIC_DESCRIPTIONS,
  getExtraTransactionDetails,
  getStartMoment,
  type IMoreDetails,
  type IScrapedTransaction,
  type IScrapedTransactionsResult,
  PENDING_TRANSACTIONS_IFRAME,
  TRANSACTIONS_REQUEST_URLS,
} from './MizrahiHelpers.js';

const MIZRAHI_SEL = SCRAPER_CONFIGURATION.banks[CompanyTypes.Mizrahi].selectors;

/** CSS selector for account dropdown items (no visible text alternative). */
const ACCOUNT_ITEM_CSS = MIZRAHI_SEL.accountDropdownItem[0].value;

/** CSS selector for the account number span (reads title attribute). */
const ACCOUNT_NUMBER_CSS = MIZRAHI_SEL.accountNumberSpan[0].value;

/** CSS selector for pending frame identifier (iframe content). */
const PENDING_FRAME_CSS = MIZRAHI_SEL.pendingFrameIdentifier[0].value;

/** Hebrew text for the checking account (OSH) navigation link. */
const OSH_LINK_TEXT = 'עובר ושב';

/** Account selector text values from WELL_KNOWN. */
const ACCOUNT_TEXTS = WELL_KNOWN_DASHBOARD_SELECTORS.accountSelector.map(c => c.value);

/** Pending transactions text values from WELL_KNOWN. */
const PENDING_TEXTS = WELL_KNOWN_DASHBOARD_SELECTORS.pendingTransactions.map(c => c.value);

/** Transactions link text values from WELL_KNOWN. */
const TXN_LINK_TEXTS = WELL_KNOWN_DASHBOARD_SELECTORS.transactionsLink.map(c => c.value);

/**
 * Try to click the first visible text match on the page.
 * @param page - The Playwright page to search.
 * @param texts - Hebrew text candidates to try.
 * @returns True if a click occurred.
 */
async function clickFirstVisibleText(page: Page, texts: string[]): Promise<boolean> {
  const attempts = texts.map(async text => {
    const loc = page.getByText(text).first();
    const isVisible = await loc.isVisible().catch(() => false);
    if (!isVisible) throw new ScraperError('not visible');
    await loc.click();
    return true;
  });
  return Promise.any(attempts).catch(() => false);
}

/** Mizrahi-specific login credentials. */
interface IScraperSpecificCredentials {
  username: string;
  password: string;
}

/** Mizrahi bank scraper implementation. */
class MizrahiScraper extends GenericBankScraper<IScraperSpecificCredentials> {
  /**
   * Create a new MizrahiScraper instance.
   * @param options - Scraper configuration options.
   */
  constructor(options: ScraperOptions) {
    super(options, MIZRAHI_CONFIG);
  }

  /**
   * Fetch all account data from Mizrahi.
   * @returns Scraping result with accounts or error.
   */
  public async fetchData(): Promise<IScraperScrapingResult> {
    await clickFirstVisibleText(this.page, ACCOUNT_TEXTS);
    const items = await this.page.locator(ACCOUNT_ITEM_CSS).all();
    return this.fetchAllAccounts(items.length);
  }

  /**
   * Fetch data for all accounts by iterating the dropdown.
   * @param count - Number of accounts in the dropdown.
   * @returns Scraping result with accounts or error.
   */
  private async fetchAllAccounts(count: number): Promise<IScraperScrapingResult> {
    try {
      const indices = Array.from({ length: count }, (_, idx) => idx);
      const actions = indices.map(
        idx => (): Promise<ITransactionsAccount> => this.selectAndFetchAccount(idx),
      );
      const accounts = await runSerial(actions);
      return { success: true, accounts };
    } catch (caught) {
      return {
        success: false,
        errorType: ScraperErrorTypes.Generic,
        errorMessage: (caught as Error).message,
      };
    }
  }

  /**
   * Select an account by dropdown index and fetch data.
   * @param index - The dropdown index.
   * @returns The account transactions data.
   */
  private async selectAndFetchAccount(index: number): Promise<ITransactionsAccount> {
    if (index > 0) await clickFirstVisibleText(this.page, ACCOUNT_TEXTS);
    await this.page.locator(ACCOUNT_ITEM_CSS).nth(index).click();
    return this.fetchAccount();
  }

  /**
   * Fetch pending transactions from the iframe.
   * @returns Array of pending ITransactions.
   */
  private async getPendingTransactions(): Promise<ITransaction[]> {
    await clickFirstVisibleText(this.page, PENDING_TEXTS);
    const frame = await waitUntilIframeFound(this.page, f =>
      f.url().includes(PENDING_TRANSACTIONS_IFRAME),
    );
    const hasPending = await frame
      .locator(PENDING_FRAME_CSS)
      .first()
      .waitFor({ state: 'attached', timeout: 10000 })
      .then(() => true)
      .catch(() => false);
    if (!hasPending) return [];
    return extractPendingTxns(frame);
  }

  /**
   * Navigate to the transactions view.
   * @returns True when navigation is complete.
   */
  private async navigateToTransactions(): Promise<boolean> {
    await this.page.getByText(OSH_LINK_TEXT).first().waitFor({ state: 'visible' });
    await this.page.getByText(OSH_LINK_TEXT).first().click();
    await clickFirstVisibleText(this.page, TXN_LINK_TEXTS);
    return true;
  }

  /**
   * Get the account number from the page.
   * @returns The account number string.
   */
  private async getAccountNumber(): Promise<string> {
    const loc = this.page.locator(ACCOUNT_NUMBER_CSS).first();
    const title = await loc.getAttribute('title');
    if (!title) throw new ScraperError('Account number not found');
    return title;
  }

  /**
   * Race multiple transaction request URLs.
   * @param url - The URL to try.
   * @returns A tuple of [response, headers].
   */
  private async fetchOneTxnUrl(
    url: string,
  ): Promise<readonly [IScrapedTransactionsResult | { isEmpty: true }, Record<string, string>]> {
    const request = await this.page.waitForRequest(url);
    const data = createDataFromRequest(request, this.options.startDate);
    const headers = createHeadersFromRequest(request);
    const response = await fetchPostWithinPage<IScrapedTransactionsResult>(this.page, url, {
      data,
      extraHeaders: headers,
    });
    if (!response) return [{ isEmpty: true as const }, headers] as const;
    return [response, headers] as const;
  }

  /**
   * Fetch raw transaction data from the bank API.
   * @returns A tuple of [response, headers].
   */
  private async fetchTransactionData(): Promise<
    readonly [IScrapedTransactionsResult | { isEmpty: true }, Record<string, string>]
  > {
    const urls = TRANSACTIONS_REQUEST_URLS;
    const promises = urls.map(url => this.fetchOneTxnUrl(url));
    return Promise.any(promises);
  }

  /**
   * Build a function that fetches extra details.
   * @param apiHeaders - The API headers for the request.
   * @returns A function that gets more details for a row.
   */
  private buildMoreDetailsGetter(
    apiHeaders: Record<string, string>,
  ): (row: IScrapedTransaction) => Promise<IMoreDetails> {
    if (!this.options.shouldAddTransactionInformation) {
      return (): Promise<IMoreDetails> => Promise.resolve({ entries: {}, memo: undefined });
    }
    return (row: IScrapedTransaction): Promise<IMoreDetails> =>
      getExtraTransactionDetails(this.page, row, apiHeaders);
  }

  /**
   * Convert and apply pending marks to transactions.
   * @param response - The API response.
   * @param apiHeaders - The API headers.
   * @returns The converted and marked transactions.
   */
  private async convertAndMarkTxns(
    response: IScrapedTransactionsResult,
    apiHeaders: Record<string, string>,
  ): Promise<ITransaction[]> {
    const rows = response.body.table.rows.filter(r => r.RecTypeSpecified);
    const isPendingToday = this.options.optInFeatures?.includes(
      'mizrahi:isPendingIfTodayTransaction',
    );
    const oshTxn = await convertTransactions({
      txns: rows,
      getMoreDetails: this.buildMoreDetailsGetter(apiHeaders),
      isPendingIfTodayTransaction: isPendingToday,
      options: this.options,
    });
    this.applyPendingStatus(oshTxn);
    return oshTxn;
  }

  /**
   * Mark transactions that should be pending.
   * @param txns - The transactions to check and mark.
   */
  private applyPendingStatus(txns: ITransaction[]): void {
    txns
      .filter(t => this.shouldMarkAsPending(t))
      .forEach(t => {
        t.status = TransactionStatuses.Pending;
      });
  }

  /**
   * Fetch all data for a single account.
   * @returns The account with transactions and balance.
   */
  private async fetchAccount(): Promise<ITransactionsAccount & { balance: number }> {
    await this.navigateToTransactions();
    const accountNumber = await this.getAccountNumber();
    const [response, apiHeaders] = await this.fetchTransactionData();
    MizrahiScraper.validateResponse(response);
    const oshTxn = await this.convertAndMarkTxns(response, apiHeaders);
    const allTxn = await this.filterAndMergeTxns(oshTxn);
    return { accountNumber, txns: allTxn, balance: +response.body.fields.Yitra };
  }

  /**
   * Validate that the transaction response indicates success.
   * @param response - The API response to validate.
   */
  private static validateResponse(
    response: IScrapedTransactionsResult | { isEmpty: true },
  ): asserts response is IScrapedTransactionsResult {
    if ('isEmpty' in response) throw new ScraperError('Empty transaction response');
    if (!response.header.success) {
      const msg = response.header.messages[0]?.text ?? '';
      throw new ScraperError(`Error fetching transaction. Response message: ${msg}`);
    }
  }

  /**
   * Filter old transactions and merge with pending.
   * @param oshTxn - The completed transactions.
   * @returns The merged and filtered transactions.
   */
  private async filterAndMergeTxns(oshTxn: ITransaction[]): Promise<ITransaction[]> {
    const startMoment = getStartMoment(this.options.startDate);
    const filtered = oshTxn.filter(t => moment(t.date).isSameOrAfter(startMoment));
    const pending = await this.getPendingTransactions();
    return filtered.concat(pending);
  }

  /**
   * Check if no identifier warrants pending status.
   * @param txn - The transaction to check.
   * @returns True if it should be marked pending.
   */
  private isPendingByNoIdentifier(txn: ITransaction): boolean {
    const isOptIn = this.options.optInFeatures?.includes('mizrahi:pendingIfNoIdentifier');
    if (!isOptIn || txn.identifier) return false;
    this.bankLog.debug(`Marking '${txn.description}' as pending: no identifier.`);
    return true;
  }

  /**
   * Check if a generic description warrants pending status.
   * @param txn - The transaction to check.
   * @returns True if it should be marked pending.
   */
  private isPendingByGenericDesc(txn: ITransaction): boolean {
    const isOptIn = this.options.optInFeatures?.includes('mizrahi:pendingIfHasGenericDescription');
    if (!isOptIn || !GENERIC_DESCRIPTIONS.includes(txn.description)) return false;
    this.bankLog.debug(`Marking '${txn.description}' as pending: generic description.`);
    return true;
  }

  /**
   * Check if a transaction should be marked as pending.
   * @param txn - The transaction to check.
   * @returns True if it should be marked as pending.
   */
  private shouldMarkAsPending(txn: ITransaction): boolean {
    return this.isPendingByNoIdentifier(txn) || this.isPendingByGenericDesc(txn);
  }
}

export default MizrahiScraper;
