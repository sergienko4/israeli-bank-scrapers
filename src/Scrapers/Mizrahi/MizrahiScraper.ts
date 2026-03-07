import moment from 'moment';
import type { Frame, Page } from 'playwright';

import { getDebug } from '../../Common/Debug';
import {
  clickButton,
  pageEvalAll,
  waitUntilElementFound,
  waitUntilIframeFound,
} from '../../Common/ElementsInteractions';
import { fetchPostWithinPage, type PostBody } from '../../Common/Fetch';
import {
  type IDashboardFieldOpts,
  resolveDashboardField,
  toFirstCss,
} from '../../Common/SelectorResolver';
import { getRawTransaction } from '../../Common/Transactions';
import { SHEKEL_CURRENCY } from '../../Constants';
import { CompanyTypes } from '../../Definitions';
import type { FoundResult } from '../../Interfaces/Common/FoundResult';
import {
  type ITransaction,
  type ITransactionsAccount,
  TransactionStatuses,
  TransactionTypes,
} from '../../Transactions';
import { ScraperErrorTypes, ScraperWebsiteChangedError } from '../Base/Errors';
import { GenericBankScraper } from '../Base/GenericBankScraper';
import type { IScraperScrapingResult, ScraperOptions } from '../Base/Interface';
import { type SelectorCandidate } from '../Base/LoginConfig';
import { SCRAPER_CONFIGURATION } from '../Registry/ScraperConfig';
import {
  createDataFromRequest,
  createHeadersFromRequest,
  GENERIC_DESCRIPTIONS,
  getExtraTransactionDetails,
  getStartMoment,
  getTransactionIdentifier,
  type IBuildTransactionRowOpts,
  type IConvertTransactionRowOpts,
  type IConvertTransactionsOpts,
  type IScrapedTransaction,
  type IScrapedTransactionsResult,
  type IScraperSpecificCredentials,
  type ITransactionMoreDetails,
  PENDING_TRANSACTIONS_IFRAME,
  TRANSACTIONS_REQUEST_URLS,
} from './MizrahiHelpers';
import { MIZRAHI_CONFIG } from './MizrahiLoginConfig';

const LOG = getDebug('mizrahi');
const CFG = SCRAPER_CONFIGURATION.banks[CompanyTypes.Mizrahi];
// SEL kept for data-extraction fields (pendingTransactionRows, accountNumberSpan, pendingFrameIdentifier)
const SELECTOR_ENTRIES = Object.entries(CFG.selectors).map(([k, cs]) => [k, toFirstCss(cs)]);
const SEL = Object.fromEntries(SELECTOR_ENTRIES) as Record<string, string>;

export type MizrahiDashKey = keyof typeof CFG.selectors;
// Typed key constants derived from config — no inline string literals in scraper code
const KEYS_ENTRIES = Object.keys(CFG.selectors).map(k => [k, k]);
const KEYS = Object.fromEntries(KEYS_ENTRIES) as {
  [K in MizrahiDashKey]: K;
};

/**
 * Builds a IDashboardFieldOpts for a Mizrahi selector key.
 *
 * @param page - the Playwright page to resolve the selector in
 * @param key - the Mizrahi dashboard selector key
 * @returns a IDashboardFieldOpts ready for resolveDashboardField()
 */
function dashOpts(page: Page, key: MizrahiDashKey): IDashboardFieldOpts {
  return {
    pageOrFrame: page,
    fieldKey: key,
    bankCandidates: [...(CFG.selectors[key] as SelectorCandidate[])],
    pageUrl: page.url(),
  };
}

/**
 * Builds the core ITransaction fields for a Mizrahi scraped row.
 *
 * @param opts - options with the raw row, date, extra details, and pending flag
 * @returns a ITransaction object without rawTransaction
 */
function buildRowBase(opts: IBuildTransactionRowOpts): ITransaction {
  const { row, txnDate, moreDetails, isPendingIfTodayTransaction } = opts;
  return {
    type: TransactionTypes.Normal,
    identifier: getTransactionIdentifier(row),
    date: txnDate,
    processedDate: txnDate,
    originalAmount: row.MC02SchumEZ,
    originalCurrency: SHEKEL_CURRENCY,
    chargedAmount: row.MC02SchumEZ,
    description: row.MC02TnuaTeurEZ,
    memo: moreDetails.memo,
    status:
      isPendingIfTodayTransaction && row.IsTodayTransaction
        ? TransactionStatuses.Pending
        : TransactionStatuses.Completed,
  };
}

/**
 * Converts a single Mizrahi scraped row to a normalized ITransaction.
 *
 * @param opts - options with the raw row, more-details getter, pending flag, and scraper options
 * @returns a complete ITransaction object
 */
async function convertOneRow(opts: IConvertTransactionRowOpts): Promise<ITransaction> {
  const { row, getMoreDetails, isPendingIfTodayTransaction, options } = opts;
  const moreDetails = await getMoreDetails(row);
  const txnDate = moment(row.MC02PeulaTaaEZ, moment.HTML5_FMT.DATETIME_LOCAL_SECONDS).toISOString();
  const result = buildRowBase({ row, txnDate, moreDetails, isPendingIfTodayTransaction });
  if (options?.includeRawTransaction)
    result.rawTransaction = getRawTransaction({
      ...row,
      additionalInformation: moreDetails.entries,
    });
  return result;
}

/**
 * Converts an array of Mizrahi scraped rows to normalized ITransaction objects in parallel.
 *
 * @param opts - conversion options with raw transactions, more-details getter, and flags
 * @returns an array of normalized ITransaction objects
 */
async function convertTransactions(opts: IConvertTransactionsOpts): Promise<ITransaction[]> {
  const { txns, getMoreDetails, isPendingIfTodayTransaction = false, options } = opts;
  const convertPromises = txns.map(row =>
    convertOneRow({ row, getMoreDetails, isPendingIfTodayTransaction, options }),
  );
  return Promise.all(convertPromises);
}

/**
 * Maps a pending row array to a ITransaction or null if the date is invalid.
 *
 * @param dateStr - the row array containing transaction fields
 * @param dateStr."0" - the date string (DD/MM/YY format) at index 0
 * @param dateStr."1" - the transaction description at index 1
 * @param dateStr."2" - an unused column at index 2
 * @param dateStr."3" - the amount string (may include commas) at index 3
 * @returns FoundResult wrapping the pending ITransaction, or isFound=false if the date is invalid
 */
function mapPendingRow([dateStr, description, , amountStr]: string[]): FoundResult<ITransaction> {
  const date = moment(dateStr, 'DD/MM/YY').toISOString();
  if (!date) return { isFound: false };
  const cleanedAmountStr = amountStr.replaceAll(',', '');
  const parsedAmount = parseFloat(cleanedAmountStr);
  return {
    isFound: true,
    value: {
      type: TransactionTypes.Normal,
      date,
      processedDate: date,
      originalAmount: parsedAmount,
      originalCurrency: SHEKEL_CURRENCY,
      chargedAmount: parsedAmount,
      description,
      status: TransactionStatuses.Pending,
    },
  };
}

/**
 * Extracts pending transactions from the Mizrahi pending transactions iframe.
 *
 * @param page - the iframe frame containing the pending transactions table
 * @returns an array of pending ITransaction objects
 */
async function extractPendingTransactions(page: Frame): Promise<ITransaction[]> {
  const pendingTxn = await pageEvalAll(page, {
    selector: SEL.pendingTransactionRows,
    defaultResult: [],
    /**
     * Maps each pending transaction row to an array of cell text values.
     *
     * @param trs - the list of tr elements in the pending transactions table
     * @returns an array of cell text arrays for each row
     */
    callback: trs => trs.map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent || '')),
  });
  const pendingResults = pendingTxn.map(row => mapPendingRow(row));
  return pendingResults
    .filter((r): r is { isFound: true; value: ITransaction } => r.isFound)
    .map(r => r.value);
}

/**
 * Asserts that the Mizrahi API response is successful; throws if not.
 *
 * @param response - the API response to validate
 */
function validateTransactionResponse(
  response: IScrapedTransactionsResult,
): asserts response is IScrapedTransactionsResult {
  if (!response.header.success) {
    const msg = response.header.messages[0]?.text ?? '';
    throw new ScraperWebsiteChangedError(
      'Mizrahi',
      `Error fetching transaction. Response message: ${msg}`,
    );
  }
}

/** IScraper implementation for Mizrahi-Tefahot Bank. */
class MizrahiScraper extends GenericBankScraper<IScraperSpecificCredentials> {
  /**
   * Creates a MizrahiScraper with the Mizrahi login configuration.
   *
   * @param options - scraper options including companyId and timeouts
   */
  constructor(options: ScraperOptions) {
    super(options, MIZRAHI_CONFIG);
  }

  /**
   * Fetches transaction data for all Mizrahi accounts.
   *
   * @returns a scraping result with all account transactions or an error
   */
  public async fetchData(): Promise<IScraperScrapingResult> {
    const numOfAccounts = await this.getNumAccounts();
    try {
      const accountIndices = Array.from({ length: numOfAccounts }, (_, i) => i);
      const initialAccounts = Promise.resolve<ITransactionsAccount[]>([]);
      const accounts = await accountIndices.reduce(
        async (acc, i) => [...(await acc), await this.selectAndFetchAccount(i)],
        initialAccounts,
      );
      return { success: true, accounts };
    } catch (e) {
      return {
        success: false,
        errorType: ScraperErrorTypes.Generic,
        errorMessage: (e as Error).message,
      };
    }
  }

  /**
   * Reads the number of available accounts from the account dropdown.
   *
   * @returns the count of accounts in the dropdown
   */
  private async getNumAccounts(): Promise<number> {
    const ddOpts = dashOpts(this.page, KEYS.accountDropdown);
    const dd = await resolveDashboardField(ddOpts);
    if (dd.isResolved) await clickButton(dd.context, dd.selector);
    const ddItemOpts = dashOpts(this.page, KEYS.accountDropdownItem);
    const ddItem = await resolveDashboardField(ddItemOpts);
    return ddItem.isResolved ? (await this.page.$$(ddItem.selector)).length : 0;
  }

  /**
   * Selects an account by index from the dropdown and fetches its transactions.
   *
   * @param index - the zero-based account index to select
   * @returns a ITransactionsAccount with the account data and transactions
   */
  private async selectAndFetchAccount(index: number): Promise<ITransactionsAccount> {
    if (index > 0) {
      const ddOpts = dashOpts(this.page, KEYS.accountDropdown);
      const dd = await resolveDashboardField(ddOpts);
      if (dd.isResolved) await clickButton(dd.context, dd.selector);
    }
    const ddItemOpts = dashOpts(this.page, KEYS.accountDropdownItem);
    const ddItem = await resolveDashboardField(ddItemOpts);
    if (ddItem.isResolved)
      await clickButton(ddItem.context, `${ddItem.selector}:nth-child(${String(index + 1)})`);
    return this.fetchAccount();
  }

  /**
   * Clicks the pending transactions link and extracts pending transactions from the iframe.
   *
   * @returns an array of pending transactions
   */
  private async getPendingTransactions(): Promise<ITransaction[]> {
    const pendingLinkOpts = dashOpts(this.page, KEYS.pendingTransactionsLink);
    const link = await resolveDashboardField(pendingLinkOpts);
    if (link.isResolved) await clickButton(link.context, link.selector);
    const frame = await waitUntilIframeFound(this.page, f =>
      f.url().includes(PENDING_TRANSACTIONS_IFRAME),
    );
    const isPending = await waitUntilElementFound(frame, SEL.pendingFrameIdentifier)
      .then(() => true)
      .catch(() => false);
    if (!isPending) {
      return [];
    }

    const pendingTxn = await extractPendingTransactions(frame);
    return pendingTxn;
  }

  /**
   * Clicks the account checking (OSH) and transactions navigation links to reach the transactions view.
   */
  private async navigateToTransactions(): Promise<void> {
    const oshOpts = dashOpts(this.page, KEYS.oshLink);
    const osh = await resolveDashboardField(oshOpts);
    if (osh.isResolved) {
      await waitUntilElementFound(osh.context, osh.selector);
      await clickButton(osh.context, osh.selector);
    }
    const txnOpts = dashOpts(this.page, KEYS.transactionsLink);
    const txn = await resolveDashboardField(txnOpts);
    if (txn.isResolved) {
      await waitUntilElementFound(txn.context, txn.selector);
      await clickButton(txn.context, txn.selector);
    }
  }

  /**
   * Reads the account number from the account number span on the dashboard.
   *
   * @returns the account number string
   */
  private async getAccountNumber(): Promise<string> {
    const accountNumberElement = await this.page.$(SEL.accountNumberSpan);
    const accountNumberHandle = await accountNumberElement?.getProperty('title');
    const accountNumber = (await accountNumberHandle?.jsonValue()) as string;
    if (!accountNumber)
      throw new ScraperWebsiteChangedError('Mizrahi', 'IAccount number not found');
    return accountNumber;
  }

  /**
   * Intercepts the Mizrahi transactions API request and re-fetches with the desired date range.
   *
   * @returns the fetched transaction result and the API headers for replay
   */
  private async fetchTransactionData(): Promise<
    readonly [IScrapedTransactionsResult, Record<string, string>]
  > {
    const requestPromises = TRANSACTIONS_REQUEST_URLS.map(async url => {
      const request = await this.page.waitForRequest(url);
      const data = createDataFromRequest(request, this.options.startDate);
      const headers = createHeadersFromRequest(request);
      const raw = await fetchPostWithinPage<IScrapedTransactionsResult>(this.page, url, {
        data: data as unknown as PostBody,
        extraHeaders: headers,
      });
      if (!raw.isFound) throw new ScraperWebsiteChangedError('Mizrahi', 'empty API response');
      return [raw.value, headers] as const;
    });
    return Promise.any(requestPromises);
  }

  /**
   * Builds a function that fetches extra transaction details based on the shouldAddTransactionInformation option.
   *
   * @param apiHeaders - the XSRF and Content-Type headers for API requests
   * @returns a function that returns ITransactionMoreDetails for a given transaction row
   */
  private buildMoreDetailsGetter(
    apiHeaders: Record<string, string>,
  ): (row: IScrapedTransaction) => Promise<ITransactionMoreDetails> {
    return this.options.shouldAddTransactionInformation
      ? (row: IScrapedTransaction): Promise<ITransactionMoreDetails> =>
          getExtraTransactionDetails(this.page, row, apiHeaders)
      : (): Promise<ITransactionMoreDetails> => Promise.resolve({ entries: {}, memo: undefined });
  }

  /**
   * Converts the transaction response rows and marks specific ones as pending.
   *
   * @param response - the validated Mizrahi transaction API response
   * @param apiHeaders - the XSRF and Content-Type headers for extra detail requests
   * @returns converted transactions with pending status applied where applicable
   */
  private async convertAndMarkTxns(
    response: IScrapedTransactionsResult,
    apiHeaders: Record<string, string>,
  ): Promise<ITransaction[]> {
    const relevantRows = response.body.table.rows.filter(row => row.RecTypeSpecified);
    const oshTxn = await convertTransactions({
      txns: relevantRows,
      getMoreDetails: this.buildMoreDetailsGetter(apiHeaders),
      isPendingIfTodayTransaction: this.options.optInFeatures?.includes(
        'mizrahi:isPendingIfTodayTransaction',
      ),
      options: this.options,
    });
    oshTxn
      .filter(txn => this.shouldMarkAsPending(txn))
      .forEach(txn => {
        txn.status = TransactionStatuses.Pending;
      });
    return oshTxn;
  }

  /**
   * Fetches account number, transactions, and balance for the currently selected account.
   *
   * @returns the account data with account number, transactions, and balance
   */
  private async fetchAccount(): Promise<ITransactionsAccount & { balance: number }> {
    await this.navigateToTransactions();
    const accountNumber = await this.getAccountNumber();
    const [response, apiHeaders] = await this.fetchTransactionData();
    validateTransactionResponse(response);
    const oshTxn = await this.convertAndMarkTxns(response, apiHeaders);
    const allTxn = await this.filterAndMergeTxns(oshTxn);
    return { accountNumber, txns: allTxn, balance: +response.body.fields.Yitra };
  }

  /**
   * Filters completed transactions by start date and appends pending transactions.
   *
   * @param oshTxn - the completed and pending-flagged transactions to filter
   * @returns the filtered completed transactions merged with separate pending transactions
   */
  private async filterAndMergeTxns(oshTxn: ITransaction[]): Promise<ITransaction[]> {
    const startMoment = getStartMoment(this.options.startDate);
    return oshTxn
      .filter(txn => moment(txn.date).isSameOrAfter(startMoment))
      .concat(await this.getPendingTransactions());
  }

  /**
   * Determines whether a transaction should be marked as pending based on opt-in features.
   *
   * @param txn - the transaction to evaluate
   * @returns true if the transaction should be marked as pending
   */
  private shouldMarkAsPending(txn: ITransaction): boolean {
    if (this.options.optInFeatures?.includes('mizrahi:pendingIfNoIdentifier') && !txn.identifier) {
      LOG.info(`Marking transaction '${txn.description}' as pending due to no identifier.`);
      return true;
    }

    if (
      this.options.optInFeatures?.includes('mizrahi:pendingIfHasGenericDescription') &&
      GENERIC_DESCRIPTIONS.includes(txn.description)
    ) {
      LOG.info(`Marking transaction '${txn.description}' as pending due to generic description.`);
      return true;
    }

    return false;
  }
}

export default MizrahiScraper;
