import moment from 'moment';

import { getDebug } from '../../Common/Debug.js';
import { fetchPost } from '../../Common/Fetch.js';
import { CompanyTypes } from '../../Definitions.js';
import ScraperError from '../Base/ScraperError.js';
import { SCRAPER_CONFIGURATION } from '../Registry/ScraperConfig.js';
import {
  type ICardApiStatus,
  type ICardInfo,
  type ICardPendingTransactionDetails,
  type ICardTransactionDetails,
  type IFramesResponse,
  type IInitResponse,
  isCardPendingTransactionDetails,
  isCardTransactionDetails,
} from './VisaCalTypes.js';

const LOG = getDebug('visa-cal');
const VISCAL_CFG = SCRAPER_CONFIGURATION.banks[CompanyTypes.VisaCal];

const API_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
    'AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/142.0.0.0 Safari/537.36',
  Origin: VISCAL_CFG.api.calOrigin ?? '',
  Referer: VISCAL_CFG.api.calOrigin ?? '',
  'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7',
  'Sec-Fetch-Site': 'same-site',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Dest': 'empty',
};

/** Endpoint URLs from config. */
export const TXN_ENDPOINT = VISCAL_CFG.api.calTransactions ?? '';
export const FRAMES_ENDPOINT = VISCAL_CFG.api.calFrames ?? '';
export const PENDING_ENDPOINT = VISCAL_CFG.api.calPending ?? '';
export const LOGIN_RESPONSE_URL = VISCAL_CFG.api.calLoginResponse ?? '';
export const INIT_ENDPOINT = VISCAL_CFG.api.calInit ?? '';
export const X_SITE_ID = VISCAL_CFG.api.calXSiteId ?? '';

/**
 * Build API request headers with auth and site ID.
 * @param authorization - The authorization header value.
 * @param xSiteId - The X-Site-Id header value.
 * @returns Headers object for API requests.
 */
export function buildApiHeaders(authorization: string, xSiteId: string): Record<string, string> {
  return {
    authorization,
    'X-Site-Id': xSiteId,
    'Content-Type': 'application/json',
    ...API_HEADERS,
  };
}

/**
 * Validate month fetch result and throw on failure.
 * @param monthData - The API response.
 * @param card - The card that was fetched.
 */
function validateMonthData(
  monthData: ICardTransactionDetails | ICardApiStatus,
  card: ICardInfo,
): asserts monthData is ICardTransactionDetails | (ICardApiStatus & { statusCode: 1 }) {
  if (monthData.statusCode === 1) return;
  const title = monthData.title;
  throw new ScraperError(
    `failed to fetch transactions for card ${card.last4Digits}. Message: ${title}`,
  );
}

/**
 * Fetch transaction data for a single month.
 * @param card - The card to fetch for.
 * @param month - The month to fetch.
 * @param hdrs - API request headers.
 * @returns The month's transaction details.
 */
export async function fetchMonthData(
  card: ICardInfo,
  month: moment.Moment,
  hdrs: Record<string, string>,
): Promise<ICardTransactionDetails> {
  const monthData = await fetchPost<ICardTransactionDetails | ICardApiStatus>(
    TXN_ENDPOINT,
    {
      cardUniqueId: card.cardUniqueId,
      month: month.format('M'),
      year: month.format('YYYY'),
    },
    hdrs,
  );
  validateMonthData(monthData, card);
  if (!isCardTransactionDetails(monthData)) {
    throw new ScraperError('monthData is not of type ICardTransactionDetails');
  }
  return monthData;
}

/**
 * Log and return pending data on non-critical failure.
 * @param pendingData - The API response.
 * @param card - The card that was fetched.
 * @returns The original response.
 */
function handlePendingFailure(
  pendingData: ICardPendingTransactionDetails | ICardApiStatus,
  card: ICardInfo,
): ICardPendingTransactionDetails | ICardApiStatus {
  LOG.debug(`failed pending for card ${card.last4Digits}. Message: ${pendingData.title}`);
  return pendingData;
}

/**
 * Fetch pending transaction data for a card.
 * @param card - The card to fetch pending for.
 * @param hdrs - API request headers.
 * @returns Pending transaction details or status.
 */
export async function fetchPendingData(
  card: ICardInfo,
  hdrs: Record<string, string>,
): Promise<ICardPendingTransactionDetails | ICardApiStatus> {
  LOG.debug(`fetch pending transactions for card ${card.cardUniqueId}`);
  const data = await fetchPost<ICardPendingTransactionDetails | ICardApiStatus>(
    PENDING_ENDPOINT,
    { cardUniqueIDArray: [card.cardUniqueId] },
    hdrs,
  );
  const isValid = data.statusCode === 1 || data.statusCode === 96;
  if (!isValid) return handlePendingFailure(data, card);
  if (!isCardPendingTransactionDetails(data)) {
    LOG.debug('pendingData is not ICardPendingTransactionDetails');
  }
  return data;
}

/**
 * Fetch transaction data for all months sequentially.
 * @param card - The card to fetch for.
 * @param allMonths - Array of months to fetch.
 * @param hdrs - API request headers.
 * @returns Array of monthly transaction details.
 */
export async function fetchCardDataMonths(
  card: ICardInfo,
  allMonths: moment.Moment[],
  hdrs: Record<string, string>,
): Promise<ICardTransactionDetails[]> {
  const initial = Promise.resolve<ICardTransactionDetails[]>([]);
  return allMonths.reduce(
    (memo, month) => memo.then(async acc => [...acc, await fetchMonthData(card, month, hdrs)]),
    initial,
  );
}

/**
 * Build the array of month moments to fetch.
 * @param startMoment - The start date.
 * @param futureMonths - Number of future months.
 * @returns Array of month moments.
 */
export function buildMonthRange(startMoment: moment.Moment, futureMonths: number): moment.Moment[] {
  const finalMonth = moment().add(futureMonths, 'month');
  const count = finalMonth.diff(startMoment, 'months');
  return Array.from({ length: count + 1 }, (_, idx) => finalMonth.clone().subtract(idx, 'months'));
}

/**
 * Fetch card list from the init API.
 * @param hdrs - API request headers.
 * @returns Array of card info objects.
 */
export async function fetchCards(hdrs: Record<string, string>): Promise<ICardInfo[]> {
  LOG.debug('fetch cards via init API');
  const initData = await fetchPost<IInitResponse>(INIT_ENDPOINT, { tokenGuid: '' }, hdrs);
  return initData.result.cards.map(({ cardUniqueId, last4Digits }) => ({
    cardUniqueId,
    last4Digits,
  }));
}

/**
 * Fetch card frames (misgarot) from the API.
 * @param hdrs - API request headers.
 * @param cards - Array of card info.
 * @returns The frames response data.
 */
export async function fetchFrames(
  hdrs: Record<string, string>,
  cards: ICardInfo[],
): Promise<IFramesResponse> {
  LOG.debug('fetch frames (misgarot) of cards');
  const cardIds = cards.map(({ cardUniqueId }) => ({ cardUniqueId }));
  return fetchPost<IFramesResponse>(FRAMES_ENDPOINT, { cardsForFrameData: cardIds }, hdrs);
}
