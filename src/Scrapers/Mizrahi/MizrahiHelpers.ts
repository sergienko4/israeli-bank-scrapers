import moment from 'moment';
import { type Page, type Request } from 'playwright';

import { getDebug } from '../../Common/Debug.js';
import { fetchPostWithinPage } from '../../Common/Fetch.js';
import { CompanyTypes } from '../../Definitions.js';
import { SCRAPER_CONFIGURATION } from '../Registry/ScraperConfig.js';
import type { IMizrahiRequestData } from './Interfaces/MizrahiRequestData.js';
import type { IMoreDetails } from './Interfaces/MoreDetails.js';
import type { IScrapedTransaction } from './Interfaces/ScrapedTransaction.js';

export type { IConvertOneRowOpts } from './Interfaces/ConvertOneRowOpts.js';
export type { IConvertTxnsOpts } from './Interfaces/ConvertTxnsOpts.js';
export type { IMizrahiRequestData } from './Interfaces/MizrahiRequestData.js';
export type { IMoreDetails } from './Interfaces/MoreDetails.js';
export type { IScrapedTransaction } from './Interfaces/ScrapedTransaction.js';
export type { IScrapedTransactionsResult } from './Interfaces/ScrapedTransactionsResult.js';

const LOG = getDebug('mizrahi');

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

/**
 * Compute the effective start moment, capped at one year ago.
 * @param optionsStartDate - The user-requested start date.
 * @returns The later of one-year-ago or the requested date.
 */
export function getStartMoment(optionsStartDate: Date): moment.Moment {
  const defaultStartMoment = moment().subtract(1, 'years');
  const startDateMoment = moment(optionsStartDate);
  return moment.max(defaultStartMoment, startDateMoment);
}

interface IMoreDetailsResponse {
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

/**
 * Build the request parameters for fetching extra transaction details.
 * @param item - The scraped transaction to build parameters for.
 * @returns A key-value map of API request parameters.
 */
function buildExtraDetailsParams(item: IScrapedTransaction): Record<string, string | number> {
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

/**
 * Parse the detail fields from the API response into a structured object.
 * @param fields - Array of label-value pairs from the API.
 * @returns Structured details with entries map and memo string.
 */
function parseDetailsFields(fields: { Label: string; Value: string }[]): IMoreDetails {
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

const EMPTY_DETAILS: IMoreDetails = { entries: {}, memo: undefined };

/**
 * Fetch extra details for a single transaction from the Mizrahi API.
 * @param page - The Playwright page with an active session.
 * @param item - The scraped transaction to fetch details for.
 * @param apiHeaders - Headers captured from the initial request.
 * @returns The extra details, or an empty-details sentinel if unavailable.
 */
async function fetchMoreDetails(
  page: Page,
  item: IScrapedTransaction,
  apiHeaders: Record<string, string>,
): Promise<IMoreDetails> {
  if (item.MC02ShowDetailsEZ !== '1') return EMPTY_DETAILS;
  const params = buildExtraDetailsParams(item);
  const response = await fetchPostWithinPage<IMoreDetailsResponse>(page, MORE_DETAILS_URL, {
    data: params,
    extraHeaders: apiHeaders,
  });
  if (!response) return EMPTY_DETAILS;
  const details = response.body.fields[0][0].Records[0].Fields;
  LOG.debug({ params, details }, 'fetch details');
  if (Array.isArray(details) && details.length > 0) return parseDetailsFields(details);
  return EMPTY_DETAILS;
}

/**
 * Get extra transaction details, falling back to empty details on error.
 * @param page - The Playwright page with an active session.
 * @param item - The scraped transaction to enrich.
 * @param apiHeaders - Headers captured from the initial request.
 * @returns The extra details or an empty-details sentinel.
 */
export async function getExtraTransactionDetails(
  page: Page,
  item: IScrapedTransaction,
  apiHeaders: Record<string, string>,
): Promise<IMoreDetails> {
  try {
    LOG.debug(item, 'getExtraTransactionDetails for item');
    return await fetchMoreDetails(page, item, apiHeaders);
  } catch (error) {
    LOG.debug(error, 'Error fetching extra transaction details');
  }
  return EMPTY_DETAILS;
}

/**
 * Build a Mizrahi request payload from the intercepted request and date range.
 * @param request - The intercepted Playwright request.
 * @param optionsStartDate - The user-requested start date.
 * @returns The modified request data with updated date range.
 */
export function createDataFromRequest(
  request: Request,
  optionsStartDate: Date,
): IMizrahiRequestData {
  const data = JSON.parse(request.postData() ?? '{}') as IMizrahiRequestData;
  data.inFromDate = getStartMoment(optionsStartDate).format(DATE_FORMAT);
  data.inToDate = moment().format(DATE_FORMAT);
  data.table.maxRow = MAX_ROWS_PER_REQUEST;
  return data;
}

/**
 * Extract XSRF token and content-type headers from the intercepted request.
 * @param request - The intercepted Playwright request.
 * @returns Header map with XSRF token and content type.
 */
export function createHeadersFromRequest(request: Request): Record<string, string> {
  return {
    mizrahixsrftoken: request.headers().mizrahixsrftoken,
    'Content-Type': request.headers()['content-type'],
  };
}

/**
 * Derive a unique transaction identifier from a scraped row.
 * @param row - The scraped transaction row.
 * @returns A composite string key, a parsed numeric reference, or empty string if absent.
 */
export function getTransactionIdentifier(row: IScrapedTransaction): string | number {
  if (!row.MC02AsmahtaMekoritEZ) {
    return '';
  }
  if (row.TransactionNumber && String(row.TransactionNumber) !== '1') {
    return `${row.MC02AsmahtaMekoritEZ}-${String(row.TransactionNumber)}`;
  }
  return parseInt(row.MC02AsmahtaMekoritEZ, 10);
}
