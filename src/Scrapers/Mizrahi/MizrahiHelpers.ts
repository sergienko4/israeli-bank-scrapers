import moment from 'moment';
import { type Page, type Request } from 'playwright';

import { getDebug } from '../../Common/Debug';
import { fetchPostWithinPage } from '../../Common/Fetch';
import { CompanyTypes } from '../../Definitions';
import { type ScraperOptions } from '../Base/Interface';
import { SCRAPER_CONFIGURATION } from '../Registry/ScraperConfig';

const LOG = getDebug('mizrahi');

export interface ScrapedTransaction {
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

export interface ScrapedTransactionsResult {
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

interface MoreDetailsResponse {
  body: {
    fields: [
      [
        {
          Records: [
            {
              Fields: {
                Label: string;
                Value: string;
              }[];
            },
          ];
        },
      ],
    ];
  };
}

export interface MoreDetails {
  entries: Record<string, string>;
  memo: string | undefined;
}

export interface ConvertTxnsOpts {
  txns: ScrapedTransaction[];
  getMoreDetails: (row: ScrapedTransaction) => Promise<MoreDetails>;
  isPendingIfTodayTransaction?: boolean;
  options?: ScraperOptions;
}

export interface ConvertOneRowOpts {
  row: ScrapedTransaction;
  getMoreDetails: (r: ScrapedTransaction) => Promise<MoreDetails>;
  isPendingIfTodayTransaction: boolean;
  options?: ScraperOptions;
}

const MIZRAHI_CFG = SCRAPER_CONFIGURATION.banks[CompanyTypes.Mizrahi];
const BASE_APP_URL = MIZRAHI_CFG.api.base;
export const TRANSACTIONS_REQUEST_URLS = [
  `${BASE_APP_URL}/OnlinePilot/api/SkyOSH/get428Index`,
  `${BASE_APP_URL}/Online/api/SkyOSH/get428Index`,
];
// URL fragment used to identify the pending-transactions iframe by its src URL
export const PENDING_TRANSACTIONS_IFRAME = 'p420.aspx';
const MORE_DETAILS_URL = `${BASE_APP_URL}/Online/api/OSH/getMaherBerurimSMF`;
export const DATE_FORMAT = MIZRAHI_CFG.format.date;
export const MAX_ROWS_PER_REQUEST = MIZRAHI_CFG.format.maxRowsPerRequest;
export const GENERIC_DESCRIPTIONS = ['העברת יומן לבנק זר מסניף זר'];

export function getStartMoment(optionsStartDate: Date): moment.Moment {
  const defaultStartMoment = moment().subtract(1, 'years');
  const startDate = optionsStartDate;
  return moment.max(defaultStartMoment, moment(startDate));
}

function buildExtraDetailsParams(item: ScrapedTransaction): Record<string, string | number> {
  const tarPeula = moment(item.MC02PeulaTaaEZ);
  const tarErech = moment(item.MC02ErehTaaEZ);
  return {
    inKodGorem: item.MC02KodGoremEZ,
    inAsmachta: item.MC02AsmahtaMekoritEZ,
    inSchum: item.MC02SchumEZ,
    inNakvanit: item.MC02KodGoremEZ,
    inSugTnua: item.MC02SugTnuaKaspitEZ,
    inAgid: item.MC02AgidEZ,
    inTarPeulaFormatted: tarPeula.format(DATE_FORMAT),
    inTarErechFormatted: (tarErech.year() > 2000 ? tarErech : tarPeula).format(DATE_FORMAT),
    inKodNose: item.MC02SeifMaralEZ,
    inKodTatNose: item.MC02NoseMaralEZ,
    inTransactionNumber: item.TransactionNumber,
  };
}

function parseDetailsFields(fields: { Label: string; Value: string }[]): MoreDetails {
  const entries: [string, string][] = fields.map(record => [
    record.Label.trim(),
    record.Value.trim(),
  ]);
  return {
    entries: Object.fromEntries(entries) as Record<string, string>,
    memo: entries
      .filter(([label]) => ['שם', 'מהות', 'חשבון'].some(key => label.startsWith(key)))
      .map(([label, value]) => `${label} ${value}`)
      .join(', '),
  };
}

async function fetchMoreDetails(
  page: Page,
  item: ScrapedTransaction,
  apiHeaders: Record<string, string>,
): Promise<MoreDetails | null> {
  if (item.MC02ShowDetailsEZ !== '1') return null;
  const params = buildExtraDetailsParams(item);
  const response = await fetchPostWithinPage<MoreDetailsResponse>(page, MORE_DETAILS_URL, {
    data: params,
    extraHeaders: apiHeaders,
  });
  const details = response?.body.fields[0][0].Records[0].Fields;
  LOG.info({ params, details }, 'fetch details');
  if (Array.isArray(details) && details.length > 0) return parseDetailsFields(details);
  return null;
}

export async function getExtraTransactionDetails(
  page: Page,
  item: ScrapedTransaction,
  apiHeaders: Record<string, string>,
): Promise<MoreDetails> {
  try {
    LOG.info(item, 'getExtraTransactionDetails for item');
    const result = await fetchMoreDetails(page, item, apiHeaders);
    if (result) return result;
  } catch (error) {
    LOG.info(error, 'Error fetching extra transaction details');
  }
  return { entries: {}, memo: undefined };
}

export interface MizrahiRequestData {
  inFromDate: string;
  inToDate: string;
  table: { maxRow: number };
  [key: string]: unknown;
}

export function createDataFromRequest(
  request: Request,
  optionsStartDate: Date,
): MizrahiRequestData {
  const data = JSON.parse(request.postData() ?? '{}') as MizrahiRequestData;
  data.inFromDate = getStartMoment(optionsStartDate).format(DATE_FORMAT);
  data.inToDate = moment().format(DATE_FORMAT);
  data.table.maxRow = MAX_ROWS_PER_REQUEST;
  return data;
}

export function createHeadersFromRequest(request: Request): Record<string, string> {
  return {
    mizrahixsrftoken: request.headers().mizrahixsrftoken,
    'Content-Type': request.headers()['content-type'],
  };
}

export function getTransactionIdentifier(row: ScrapedTransaction): string | number | undefined {
  if (!row.MC02AsmahtaMekoritEZ) {
    return undefined;
  }
  if (row.TransactionNumber && String(row.TransactionNumber) !== '1') {
    return `${row.MC02AsmahtaMekoritEZ}-${row.TransactionNumber}`;
  }
  return parseInt(row.MC02AsmahtaMekoritEZ, 10);
}
