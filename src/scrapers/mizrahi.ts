import moment from 'moment';
import { type Frame, type Page, type Request } from 'playwright';
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

const debug = getDebug('mizrahi');

interface ScrapedTransaction {
  RecTypeSpecified: boolean;
  MC02PeulaTaaEZ: string;
  MC02SchumEZ: number;
  MC02AsmahtaMekoritEZ: string;
  MC02TnuaTeurEZ: string;
  IsTodayTransaction: boolean;
  MC02ErehTaaEZ: string;
  MC02ShowDetailsEZ?: string;
  MC02KodGoremEZ: string;
  MC02SugTnuaKaspitEZ: string;
  MC02AgidEZ: string;
  MC02SeifMaralEZ: string;
  MC02NoseMaralEZ: string;
  TransactionNumber: string | number;
}

interface ScrapedTransactionsResult {
  header: {
    success: boolean;
    messages: { text: string }[];
  };
  body: {
    fields: {
      Yitra: string;
    };
    table: {
      rows: ScrapedTransaction[];
    };
  };
}

type MoreDetailsResponse = {
  body: {
    fields: [
      [
        {
          Records: [
            {
              Fields: Array<{
                Label: string;
                Value: string;
              }>;
            },
          ];
        },
      ],
    ];
  };
};

type MoreDetails = {
  entries: Record<string, string>;
  memo: string | undefined;
};

const BASE_APP_URL = 'https://mto.mizrahi-tefahot.co.il';
const OSH_PAGE = '/osh/legacy/legacy-Osh-Main';
const TRANSACTIONS_PAGE = '/osh/legacy/root-main-osh-p428New';
const TRANSACTIONS_REQUEST_URLS = [
  `${BASE_APP_URL}/OnlinePilot/api/SkyOSH/get428Index`,
  `${BASE_APP_URL}/Online/api/SkyOSH/get428Index`,
];
const PENDING_TRANSACTIONS_PAGE = '/osh/legacy/legacy-Osh-p420';
const PENDING_TRANSACTIONS_IFRAME = 'p420.aspx';
const MORE_DETAILS_URL = `${BASE_APP_URL}/Online/api/OSH/getMaherBerurimSMF`;
const DATE_FORMAT = 'DD/MM/YYYY';
const MAX_ROWS_PER_REQUEST = 10000000000;

const accountDropDownItemSelector = '#AccountPicker .item';
const pendingTrxIdentifierId = '#ctl00_ContentPlaceHolder2_panel1';
const genericDescriptions = ['העברת יומן לבנק זר מסניף זר'];

function getStartMoment(optionsStartDate: Date): moment.Moment {
  const defaultStartMoment = moment().subtract(1, 'years');
  const startDate = optionsStartDate || defaultStartMoment.toDate();
  return moment.max(defaultStartMoment, moment(startDate));
}

function buildExtraDetailsParams(item: ScrapedTransaction): Record<string, string | number> {
  const tarPeula = moment(item.MC02PeulaTaaEZ);
  const tarErech = moment(item.MC02ErehTaaEZ);
  return {
    inKodGorem: item.MC02KodGoremEZ, inAsmachta: item.MC02AsmahtaMekoritEZ, inSchum: item.MC02SchumEZ,
    inNakvanit: item.MC02KodGoremEZ, inSugTnua: item.MC02SugTnuaKaspitEZ, inAgid: item.MC02AgidEZ,
    inTarPeulaFormatted: tarPeula.format(DATE_FORMAT),
    inTarErechFormatted: (tarErech.year() > 2000 ? tarErech : tarPeula).format(DATE_FORMAT),
    inKodNose: item.MC02SeifMaralEZ, inKodTatNose: item.MC02NoseMaralEZ, inTransactionNumber: item.TransactionNumber,
  };
}

function parseDetailsFields(fields: Array<{ Label: string; Value: string }>): MoreDetails {
  const entries: [string, string][] = fields.map(record => [record.Label.trim(), record.Value.trim()]);
  return {
    entries: Object.fromEntries(entries) as Record<string, string>,
    memo: entries.filter(([label]) => ['שם', 'מהות', 'חשבון'].some(key => label.startsWith(key))).map(([label, value]) => `${label} ${value}`).join(', '),
  };
}

async function fetchMoreDetails(page: Page, item: ScrapedTransaction, apiHeaders: Record<string, string>): Promise<MoreDetails | null> {
  if (item.MC02ShowDetailsEZ !== '1') return null;
  const params = buildExtraDetailsParams(item);
  const response = await fetchPostWithinPage<MoreDetailsResponse>(page, MORE_DETAILS_URL, { data: params, extraHeaders: apiHeaders });
  const details = response?.body.fields?.[0]?.[0]?.Records?.[0].Fields;
  debug('fetch details for', params, 'details:', details);
  if (Array.isArray(details) && details.length > 0) return parseDetailsFields(details);
  return null;
}

async function getExtraTransactionDetails(page: Page, item: ScrapedTransaction, apiHeaders: Record<string, string>): Promise<MoreDetails> {
  try {
    debug('getExtraTransactionDetails for item:', item);
    const result = await fetchMoreDetails(page, item, apiHeaders);
    if (result) return result;
  } catch (error) {
    debug('Error fetching extra transaction details:', error);
  }
  return { entries: {}, memo: undefined };
}

interface MizrahiRequestData {
  inFromDate: string;
  inToDate: string;
  table: { maxRow: number };
  [key: string]: unknown;
}

function createDataFromRequest(request: Request, optionsStartDate: Date): MizrahiRequestData {
  const data = JSON.parse(request.postData() || '{}') as MizrahiRequestData;

  data.inFromDate = getStartMoment(optionsStartDate).format(DATE_FORMAT);
  data.inToDate = moment().format(DATE_FORMAT);
  data.table.maxRow = MAX_ROWS_PER_REQUEST;

  return data;
}

function createHeadersFromRequest(request: Request): Record<string, string> {
  return {
    mizrahixsrftoken: request.headers().mizrahixsrftoken,
    'Content-Type': request.headers()['content-type'],
  };
}

function getTransactionIdentifier(row: ScrapedTransaction): string | number | undefined {
  if (!row.MC02AsmahtaMekoritEZ) {
    return undefined;
  }
  if (row.TransactionNumber && String(row.TransactionNumber) !== '1') {
    return `${row.MC02AsmahtaMekoritEZ}-${row.TransactionNumber}`;
  }
  return parseInt(row.MC02AsmahtaMekoritEZ, 10);
}

interface ConvertTxnsOpts {
  txns: ScrapedTransaction[];
  getMoreDetails: (row: ScrapedTransaction) => Promise<MoreDetails>;
  pendingIfTodayTransaction?: boolean;
  options?: ScraperOptions;
}

interface ConvertOneRowOpts {
  row: ScrapedTransaction;
  getMoreDetails: (r: ScrapedTransaction) => Promise<MoreDetails>;
  pendingIfTodayTransaction: boolean;
  options?: ScraperOptions;
}

async function convertOneRow(opts: ConvertOneRowOpts): Promise<Transaction> {
  const { row, getMoreDetails, pendingIfTodayTransaction, options } = opts;
  const moreDetails = await getMoreDetails(row);
  const txnDate = moment(row.MC02PeulaTaaEZ, moment.HTML5_FMT.DATETIME_LOCAL_SECONDS).toISOString();
  const result: Transaction = {
    type: TransactionTypes.Normal,
    identifier: getTransactionIdentifier(row),
    date: txnDate,
    processedDate: txnDate,
    originalAmount: row.MC02SchumEZ,
    originalCurrency: SHEKEL_CURRENCY,
    chargedAmount: row.MC02SchumEZ,
    description: row.MC02TnuaTeurEZ,
    memo: moreDetails?.memo,
    status: pendingIfTodayTransaction && row.IsTodayTransaction ? TransactionStatuses.Pending : TransactionStatuses.Completed,
  };
  if (options?.includeRawTransaction) result.rawTransaction = getRawTransaction({ ...row, additionalInformation: moreDetails.entries });
  return result;
}

async function convertTransactions(opts: ConvertTxnsOpts): Promise<Transaction[]> {
  const { txns, getMoreDetails, pendingIfTodayTransaction = false, options } = opts;
  return Promise.all(txns.map(row => convertOneRow({ row, getMoreDetails, pendingIfTodayTransaction, options })));
}

function mapPendingRow([dateStr, description, _incomeAmountStr, amountStr]: string[]): Transaction | null {
  const date = moment(dateStr, 'DD/MM/YY').toISOString();
  if (!date) return null;
  return { type: TransactionTypes.Normal, date, processedDate: date, originalAmount: parseFloat(amountStr.replaceAll(',', '')), originalCurrency: SHEKEL_CURRENCY, chargedAmount: parseFloat(amountStr.replaceAll(',', '')), description, status: TransactionStatuses.Pending };
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
        return [await fetchPostWithinPage<ScrapedTransactionsResult>(this.page, url, { data, extraHeaders: headers }), headers] as const;
      }),
    );
  }

  private async fetchAccount(): Promise<TransactionsAccount & { balance: number }> {
    await this.navigateToTransactions();
    const accountNumber = await this.getAccountNumber();
    const [response, apiHeaders] = await this.fetchTransactionData();
    if (!response || response.header.success === false) {
      throw new Error(`Error fetching transaction. Response message: ${response ? response.header.messages[0].text : ''}`);
    }
    const relevantRows = response.body.table.rows.filter(row => row.RecTypeSpecified);
    const oshTxn = await convertTransactions({
      txns: relevantRows,
      getMoreDetails: this.options.additionalTransactionInformation ? row => getExtraTransactionDetails(this.page, row, apiHeaders) : () => Promise.resolve({ entries: {}, memo: undefined }),
      pendingIfTodayTransaction: this.options.optInFeatures?.includes('mizrahi:pendingIfTodayTransaction'),
      options: this.options,
    });
    oshTxn.filter(txn => this.shouldMarkAsPending(txn)).forEach(txn => { txn.status = TransactionStatuses.Pending; });
    const startMoment = getStartMoment(this.options.startDate);
    const allTxn = oshTxn.filter(txn => moment(txn.date).isSameOrAfter(startMoment)).concat(await this.getPendingTransactions());
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
