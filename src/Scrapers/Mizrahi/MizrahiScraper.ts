import moment from 'moment';
import type { Frame, Page } from 'playwright';

import { getDebug } from '../../Common/Debug';
import {
  clickButton,
  pageEvalAll,
  waitUntilElementFound,
  waitUntilIframeFound,
} from '../../Common/ElementsInteractions';
import { fetchPostWithinPage } from '../../Common/Fetch';
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
import { ScraperErrorTypes } from '../Base/Errors';
import { GenericBankScraper } from '../Base/GenericBankScraper';
import type { ScraperOptions, ScraperScrapingResult } from '../Base/Interface';
import { type SelectorCandidate } from '../Base/LoginConfig';
import { SCRAPER_CONFIGURATION } from '../Registry/ScraperConfig';
import {
  type ConvertOneRowOpts,
  type ConvertTxnsOpts,
  createDataFromRequest,
  createHeadersFromRequest,
  GENERIC_DESCRIPTIONS,
  getExtraTransactionDetails,
  getStartMoment,
  getTransactionIdentifier,
  type MoreDetails,
  PENDING_TRANSACTIONS_IFRAME,
  type ScrapedTransaction,
  type ScrapedTransactionsResult,
  TRANSACTIONS_REQUEST_URLS,
} from './MizrahiHelpers';
import { MIZRAHI_CONFIG } from './MizrahiLoginConfig';

const LOG = getDebug('mizrahi');
const CFG = SCRAPER_CONFIGURATION.banks[CompanyTypes.Mizrahi];
// SEL kept for data-extraction fields (pendingTransactionRows, accountNumberSpan, pendingFrameIdentifier)
const SEL = Object.fromEntries(
  Object.entries(CFG.selectors).map(([k, cs]) => [k, toFirstCss(cs)]),
) as Record<string, string>;

type MizrahiDashKey = keyof typeof CFG.selectors;
// Typed key constants derived from config — no inline string literals in scraper code
const KEYS = Object.fromEntries(Object.keys(CFG.selectors).map(k => [k, k])) as {
  [K in MizrahiDashKey]: K;
};

function dashOpts(page: Page, key: MizrahiDashKey): DashboardFieldOpts {
  return {
    pageOrFrame: page,
    fieldKey: key,
    bankCandidates: [...(CFG.selectors[key] as SelectorCandidate[])],
    pageUrl: page.url(),
  };
}

interface BuildRowBaseOpts {
  row: ScrapedTransaction;
  txnDate: string;
  moreDetails: MoreDetails;
  isPendingIfTodayTransaction: boolean;
}

function buildRowBase(opts: BuildRowBaseOpts): Transaction {
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

async function convertOneRow(opts: ConvertOneRowOpts): Promise<Transaction> {
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

async function convertTransactions(opts: ConvertTxnsOpts): Promise<Transaction[]> {
  const { txns, getMoreDetails, isPendingIfTodayTransaction = false, options } = opts;
  return Promise.all(
    txns.map(row => convertOneRow({ row, getMoreDetails, isPendingIfTodayTransaction, options })),
  );
}

function mapPendingRow([dateStr, description, , amountStr]: string[]): Transaction | null {
  const date = moment(dateStr, 'DD/MM/YY').toISOString();
  if (!date) return null;
  return {
    type: TransactionTypes.Normal,
    date,
    processedDate: date,
    originalAmount: parseFloat(amountStr.replaceAll(',', '')),
    originalCurrency: SHEKEL_CURRENCY,
    chargedAmount: parseFloat(amountStr.replaceAll(',', '')),
    description,
    status: TransactionStatuses.Pending,
  };
}

async function extractPendingTransactions(page: Frame): Promise<Transaction[]> {
  const pendingTxn = await pageEvalAll(page, {
    selector: SEL.pendingTransactionRows,
    defaultResult: [],
    callback: trs =>
      trs.map(tr => Array.from(tr.querySelectorAll('td'), td => td.textContent || '')),
  });
  return pendingTxn.map(row => mapPendingRow(row)).filter((t): t is Transaction => t !== null);
}

interface ScraperSpecificCredentials {
  username: string;
  password: string;
}

function validateTransactionResponse(
  response: ScrapedTransactionsResult | null,
): asserts response is ScrapedTransactionsResult {
  if (!response?.header.success) {
    throw new Error(
      `Error fetching transaction. Response message: ${response ? response.header.messages[0].text : ''}`,
    );
  }
}

class MizrahiScraper extends GenericBankScraper<ScraperSpecificCredentials> {
  constructor(options: ScraperOptions) {
    super(options, MIZRAHI_CONFIG);
  }

  public async fetchData(): Promise<ScraperScrapingResult> {
    const numOfAccounts = await this.getNumAccounts();
    try {
      const accounts = await Array.from({ length: numOfAccounts }, (_, i) => i).reduce(
        async (acc, i) => [...(await acc), await this.selectAndFetchAccount(i)],
        Promise.resolve<TransactionsAccount[]>([]),
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

  private async getNumAccounts(): Promise<number> {
    const dd = await resolveDashboardField(dashOpts(this.page, KEYS.accountDropdown));
    if (dd.isResolved) await clickButton(dd.context, dd.selector);
    const ddItem = await resolveDashboardField(dashOpts(this.page, KEYS.accountDropdownItem));
    return ddItem.isResolved ? (await this.page.$$(ddItem.selector)).length : 0;
  }

  private async selectAndFetchAccount(index: number): Promise<TransactionsAccount> {
    if (index > 0) {
      const dd = await resolveDashboardField(dashOpts(this.page, KEYS.accountDropdown));
      if (dd.isResolved) await clickButton(dd.context, dd.selector);
    }
    const ddItem = await resolveDashboardField(dashOpts(this.page, KEYS.accountDropdownItem));
    if (ddItem.isResolved)
      await clickButton(ddItem.context, `${ddItem.selector}:nth-child(${index + 1})`);
    return this.fetchAccount();
  }

  private async getPendingTransactions(): Promise<Transaction[]> {
    const link = await resolveDashboardField(dashOpts(this.page, KEYS.pendingTransactionsLink));
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

  private async navigateToTransactions(): Promise<void> {
    const osh = await resolveDashboardField(dashOpts(this.page, KEYS.oshLink));
    if (osh.isResolved) {
      await waitUntilElementFound(osh.context, osh.selector);
      await clickButton(osh.context, osh.selector);
    }
    const txn = await resolveDashboardField(dashOpts(this.page, KEYS.transactionsLink));
    if (txn.isResolved) {
      await waitUntilElementFound(txn.context, txn.selector);
      await clickButton(txn.context, txn.selector);
    }
  }

  private async getAccountNumber(): Promise<string> {
    const accountNumberElement = await this.page.$(SEL.accountNumberSpan);
    const accountNumberHandle = await accountNumberElement?.getProperty('title');
    const accountNumber = (await accountNumberHandle?.jsonValue()) as string;
    if (!accountNumber) throw new Error('Account number not found');
    return accountNumber;
  }

  private async fetchTransactionData(): Promise<
    readonly [ScrapedTransactionsResult | null, Record<string, string>]
  > {
    return Promise.any(
      TRANSACTIONS_REQUEST_URLS.map(async url => {
        const request = await this.page.waitForRequest(url);
        const data = createDataFromRequest(request, this.options.startDate);
        const headers = createHeadersFromRequest(request);
        return [
          await fetchPostWithinPage<ScrapedTransactionsResult>(this.page, url, {
            data,
            extraHeaders: headers,
          }),
          headers,
        ] as const;
      }),
    );
  }

  private buildMoreDetailsGetter(
    apiHeaders: Record<string, string>,
  ): (row: ScrapedTransaction) => Promise<MoreDetails> {
    return this.options.shouldAddTransactionInformation
      ? (row: ScrapedTransaction): Promise<MoreDetails> =>
          getExtraTransactionDetails(this.page, row, apiHeaders)
      : (): Promise<MoreDetails> => Promise.resolve({ entries: {}, memo: undefined });
  }

  private async convertAndMarkTxns(
    response: ScrapedTransactionsResult,
    apiHeaders: Record<string, string>,
  ): Promise<Transaction[]> {
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

  private async fetchAccount(): Promise<TransactionsAccount & { balance: number }> {
    await this.navigateToTransactions();
    const accountNumber = await this.getAccountNumber();
    const [response, apiHeaders] = await this.fetchTransactionData();
    validateTransactionResponse(response);
    const oshTxn = await this.convertAndMarkTxns(response, apiHeaders);
    const allTxn = await this.filterAndMergeTxns(oshTxn);
    return { accountNumber, txns: allTxn, balance: +response.body.fields.Yitra };
  }

  private async filterAndMergeTxns(oshTxn: Transaction[]): Promise<Transaction[]> {
    const startMoment = getStartMoment(this.options.startDate);
    return oshTxn
      .filter(txn => moment(txn.date).isSameOrAfter(startMoment))
      .concat(await this.getPendingTransactions());
  }

  private shouldMarkAsPending(txn: Transaction): boolean {
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
