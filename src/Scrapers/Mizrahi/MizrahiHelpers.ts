import moment from 'moment';
import { type Page, type Request } from 'playwright';

import { getDebug } from '../../Common/Debug';
import { fetchPostWithinPage } from '../../Common/Fetch';
import { CompanyTypes } from '../../Definitions';
import type { MizrahiRequestData } from '../../Interfaces/Banks/Mizrahi/MizrahiRequestData';
import type { MoreDetails } from '../../Interfaces/Banks/Mizrahi/MoreDetails';
import type { ScrapedTransaction } from '../../Interfaces/Banks/Mizrahi/ScrapedTransaction';
import { SCRAPER_CONFIGURATION } from '../Registry/ScraperConfig';

export type { ConvertOneRowOpts } from '../../Interfaces/Banks/Mizrahi/ConvertOneRowOpts';
export type { ConvertTxnsOpts } from '../../Interfaces/Banks/Mizrahi/ConvertTxnsOpts';
export type { MizrahiRequestData } from '../../Interfaces/Banks/Mizrahi/MizrahiRequestData';
export type { MoreDetails } from '../../Interfaces/Banks/Mizrahi/MoreDetails';
export type { ScrapedTransaction } from '../../Interfaces/Banks/Mizrahi/ScrapedTransaction';
export type { ScrapedTransactionsResult } from '../../Interfaces/Banks/Mizrahi/ScrapedTransactionsResult';

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
 * Calculates the effective start moment, limited to at most 1 year ago.
 *
 * @param optionsStartDate - the user-specified start date
 * @returns the later of the user date and 1 year ago
 */
export function getStartMoment(optionsStartDate: Date): moment.Moment {
  const defaultStartMoment = moment().subtract(1, 'years');
  const startMoment = moment(optionsStartDate);
  return moment.max(defaultStartMoment, startMoment);
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

/**
 * Builds the request parameters for the Mizrahi getMaherBerurimSMF (more details) API.
 *
 * @param item - the scraped transaction to build extra detail parameters for
 * @returns a key-value map for the API POST body
 */
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

/**
 * Parses the detail fields from the Mizrahi more-details API response into a MoreDetails object.
 *
 * @param fields - the array of Label/Value pairs from the API response
 * @returns a MoreDetails object with an entries map and a formatted memo string
 */
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

/**
 * Fetches additional transaction detail data from the Mizrahi API if available.
 *
 * @param page - the Playwright page with an active Mizrahi session
 * @param item - the transaction to fetch details for
 * @param apiHeaders - the XSRF and Content-Type headers for the API request
 * @returns parsed MoreDetails or null if details are unavailable
 */
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

/**
 * Safely fetches additional details for a Mizrahi transaction, returning an empty result on error.
 *
 * @param page - the Playwright page with an active Mizrahi session
 * @param item - the transaction to fetch details for
 * @param apiHeaders - the XSRF and Content-Type headers for the API request
 * @returns the MoreDetails or an empty result if the fetch fails
 */
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

/**
 * Extracts and modifies the API request data to include the desired date range.
 *
 * @param request - the intercepted Playwright request containing the original POST data
 * @param optionsStartDate - the user-specified start date for transactions
 * @returns the modified MizrahiRequestData with corrected date range
 */
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

/**
 * Extracts the XSRF token and Content-Type headers from an intercepted request.
 *
 * @param request - the intercepted Playwright request with Mizrahi session headers
 * @returns a header map with the XSRF token and Content-Type for replay requests
 */
export function createHeadersFromRequest(request: Request): Record<string, string> {
  return {
    mizrahixsrftoken: request.headers().mizrahixsrftoken,
    'Content-Type': request.headers()['content-type'],
  };
}

/**
 * Builds a unique transaction identifier from the Mizrahi transaction data.
 *
 * @param row - the scraped transaction row from the Mizrahi API
 * @returns a unique identifier string/number or undefined if no reference is available
 */
export function getTransactionIdentifier(row: ScrapedTransaction): string | number | undefined {
  if (!row.MC02AsmahtaMekoritEZ) {
    return undefined;
  }
  if (row.TransactionNumber && String(row.TransactionNumber) !== '1') {
    return `${row.MC02AsmahtaMekoritEZ}-${String(row.TransactionNumber)}`;
  }
  return parseInt(row.MC02AsmahtaMekoritEZ, 10);
}
