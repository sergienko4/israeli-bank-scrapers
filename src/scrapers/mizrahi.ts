import moment from 'moment';
import { type Frame } from 'playwright';
import { SHEKEL_CURRENCY } from '../constants';
import { pageEvalAll, waitUntilElementFound, waitUntilIframeFound } from '../helpers/elements-interactions';
import { fetchPostWithinPage } from '../helpers/fetch';
import { type Transaction, TransactionStatuses, TransactionTypes, type TransactionsAccount } from '../transactions';
import { ScraperErrorTypes } from './errors';
import { getDebug } from '../helpers/debug';
import { getRawTransaction } from '../helpers/transactions';
import { type ScraperOptions, type ScraperScrapingResult } from './interface';
import { CompanyTypes } from '../definitions';
import { BANK_REGISTRY } from './bank-registry';
import { GenericBankScraper } from './generic-bank-scraper';
import {
  type ConvertOneRowOpts,
  type ConvertTxnsOpts,
  type MoreDetails,
  type ScrapedTransaction,
  type ScrapedTransactionsResult,
  accountDropDownItemSelector,
  createDataFromRequest,
  createHeadersFromRequest,
  genericDescriptions,
  getExtraTransactionDetails,
  getStartMoment,
  getTransactionIdentifier,
  OSH_PAGE,
  PENDING_TRANSACTIONS_IFRAME,
  PENDING_TRANSACTIONS_PAGE,
  TRANSACTIONS_PAGE,
  TRANSACTIONS_REQUEST_URLS,
} from './mizrahi-helpers';

const debug = getDebug('mizrahi');
const pendingTrxIdentifierId = '#ctl00_ContentPlaceHolder2_panel1';

interface BuildRowBaseOpts {
  row: ScrapedTransaction;
  txnDate: string;
  moreDetails: MoreDetails;
  pendingIfTodayTransaction: boolean;
}

function buildRowBase(opts: BuildRowBaseOpts): Transaction {
  const { row, txnDate, moreDetails, pendingIfTodayTransaction } = opts;
  return {
    type: TransactionTypes.Normal,
    identifier: getTransactionIdentifier(row),
    date: txnDate,
    processedDate: txnDate,
    originalAmount: row.MC02SchumEZ,
    originalCurrency: SHEKEL_CURRENCY,
    chargedAmount: row.MC02SchumEZ,
    description: row.MC02TnuaTeurEZ,
    memo: moreDetails?.memo,
    status:
      pendingIfTodayTransaction && row.IsTodayTransaction ? TransactionStatuses.Pending : TransactionStatuses.Completed,
  };
}

async function convertOneRow(opts: ConvertOneRowOpts): Promise<Transaction> {
  const { row, getMoreDetails, pendingIfTodayTransaction, options } = opts;
  const moreDetails = await getMoreDetails(row);
  const txnDate = moment(row.MC02PeulaTaaEZ, moment.HTML5_FMT.DATETIME_LOCAL_SECONDS).toISOString();
  const result = buildRowBase({ row, txnDate, moreDetails, pendingIfTodayTransaction });
  if (options?.includeRawTransaction)
    result.rawTransaction = getRawTransaction({ ...row, additionalInformation: moreDetails.entries });
  return result;
}

async function convertTransactions(opts: ConvertTxnsOpts): Promise<Transaction[]> {
  const { txns, getMoreDetails, pendingIfTodayTransaction = false, options } = opts;
  return Promise.all(txns.map(row => convertOneRow({ row, getMoreDetails, pendingIfTodayTransaction, options })));
}

function mapPendingRow([dateStr, description, _incomeAmountStr, amountStr]: string[]): Transaction | null {
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
    selector: 'tr.rgRow, tr.rgAltRow',
    defaultResult: [],
    callback: trs => trs.map(tr => Array.from(tr.querySelectorAll('td'), td => td.textContent || '')),
  });
  return pendingTxn.map(row => mapPendingRow(row)).filter((t): t is Transaction => t !== null);
}

type ScraperSpecificCredentials = { username: string; password: string };

class MizrahiScraper extends GenericBankScraper<ScraperSpecificCredentials> {
  constructor(options: ScraperOptions) {
    super(options, BANK_REGISTRY[CompanyTypes.mizrahi]!);
  }

  private async selectAndFetchAccount(index: number): Promise<TransactionsAccount> {
    if (index > 0) await this.page.$eval('#dropdownBasic, .item', el => (el as HTMLElement).click());
    await this.page.$eval(`${accountDropDownItemSelector}:nth-child(${index + 1})`, el => (el as HTMLElement).click());
    return this.fetchAccount();
  }

  async fetchData(): Promise<ScraperScrapingResult> {
    await this.page.$eval('#dropdownBasic, .item', el => (el as HTMLElement).click());
    const numOfAccounts = (await this.page.$$(accountDropDownItemSelector)).length;
    try {
      const results: TransactionsAccount[] = [];
      for (let i = 0; i < numOfAccounts; i += 1) {
        results.push(await this.selectAndFetchAccount(i));
      }
      return { success: true, accounts: results };
    } catch (e) {
      return { success: false, errorType: ScraperErrorTypes.Generic, errorMessage: (e as Error).message };
    }
  }

  private async getPendingTransactions(): Promise<Transaction[]> {
    await this.page.$eval(`a[href*="${PENDING_TRANSACTIONS_PAGE}"]`, el => (el as HTMLElement).click());
    const frame = await waitUntilIframeFound(this.page, f => f.url().includes(PENDING_TRANSACTIONS_IFRAME));
    const isPending = await waitUntilElementFound(frame, pendingTrxIdentifierId)
      .then(() => true)
      .catch(() => false);
    if (!isPending) {
      return [];
    }

    const pendingTxn = await extractPendingTransactions(frame);
    return pendingTxn;
  }

  private async navigateToTransactions(): Promise<void> {
    await this.page.waitForSelector(`a[href*="${OSH_PAGE}"]`);
    await this.page.$eval(`a[href*="${OSH_PAGE}"]`, el => (el as HTMLElement).click());
    await waitUntilElementFound(this.page, `a[href*="${TRANSACTIONS_PAGE}"]`);
    await this.page.$eval(`a[href*="${TRANSACTIONS_PAGE}"]`, el => (el as HTMLElement).click());
  }

  private async getAccountNumber(): Promise<string> {
    const accountNumberElement = await this.page.$('#dropdownBasic b span');
    const accountNumberHandle = await accountNumberElement?.getProperty('title');
    const accountNumber = (await accountNumberHandle?.jsonValue()) as string;
    if (!accountNumber) throw new Error('Account number not found');
    return accountNumber;
  }

  private async fetchTransactionData(): Promise<readonly [ScrapedTransactionsResult | null, Record<string, string>]> {
    return Promise.any(
      TRANSACTIONS_REQUEST_URLS.map(async url => {
        const request = await this.page.waitForRequest(url);
        const data = createDataFromRequest(request, this.options.startDate);
        const headers = createHeadersFromRequest(request);
        return [
          await fetchPostWithinPage<ScrapedTransactionsResult>(this.page, url, { data, extraHeaders: headers }),
          headers,
        ] as const;
      }),
    );
  }

  private async convertAndMarkTxns(
    response: ScrapedTransactionsResult,
    apiHeaders: Record<string, string>,
  ): Promise<Transaction[]> {
    const relevantRows = response.body.table.rows.filter(row => row.RecTypeSpecified);
    const oshTxn = await convertTransactions({
      txns: relevantRows,
      getMoreDetails: this.options.additionalTransactionInformation
        ? row => getExtraTransactionDetails(this.page, row, apiHeaders)
        : () => Promise.resolve({ entries: {}, memo: undefined }),
      pendingIfTodayTransaction: this.options.optInFeatures?.includes('mizrahi:pendingIfTodayTransaction'),
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
    if (!response || response.header.success === false) {
      throw new Error(
        `Error fetching transaction. Response message: ${response ? response.header.messages[0].text : ''}`,
      );
    }
    const oshTxn = await this.convertAndMarkTxns(response, apiHeaders);
    const startMoment = getStartMoment(this.options.startDate);
    const allTxn = oshTxn
      .filter(txn => moment(txn.date).isSameOrAfter(startMoment))
      .concat(await this.getPendingTransactions());
    return { accountNumber, txns: allTxn, balance: +response.body.fields?.Yitra };
  }

  private shouldMarkAsPending(txn: Transaction): boolean {
    if (this.options.optInFeatures?.includes('mizrahi:pendingIfNoIdentifier') && !txn.identifier) {
      debug(`Marking transaction '${txn.description}' as pending due to no identifier.`);
      return true;
    }

    if (
      this.options.optInFeatures?.includes('mizrahi:pendingIfHasGenericDescription') &&
      genericDescriptions.includes(txn.description)
    ) {
      debug(`Marking transaction '${txn.description}' as pending due to generic description.`);
      return true;
    }

    return false;
  }
}

export default MizrahiScraper;
