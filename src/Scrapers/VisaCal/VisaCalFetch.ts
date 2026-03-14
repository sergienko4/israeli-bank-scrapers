import moment from 'moment';
import { type Page } from 'playwright-core';

import { getDebug } from '../../Common/Debug.js';
import { fetchPostWithinPage, type JsonValue } from '../../Common/Fetch.js';
import { CompanyTypes } from '../../Definitions.js';
import ScraperError from '../Base/ScraperError.js';
import { SCRAPER_CONFIGURATION } from '../Registry/Config/ScraperConfig.js';
import { API_HEADERS } from './Config/VisaCalFetchConfig.js';
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

const ORIGIN_HEADERS: Record<string, string> = {
  Origin: VISCAL_CFG.api.calOrigin ?? '',
  Referer: VISCAL_CFG.api.calOrigin ?? '',
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
    ...ORIGIN_HEADERS,
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

/** Options for a single month fetch call. */
export interface IMonthFetchOpts {
  page: Page;
  card: ICardInfo;
  month: moment.Moment;
  hdrs: Record<string, string>;
}

/**
 * Fetch transaction data for a single month via the browser session.
 * @param opts - The month fetch options.
 * @returns The month's transaction details.
 */
export async function fetchMonthData(opts: IMonthFetchOpts): Promise<ICardTransactionDetails> {
  const { page, card, month, hdrs } = opts;
  const body: Record<string, JsonValue> = {
    cardUniqueId: card.cardUniqueId,
    month: month.format('M'),
    year: month.format('YYYY'),
  };
  const raw = await fetchPostWithinPage<ICardTransactionDetails | ICardApiStatus>(
    page,
    TXN_ENDPOINT,
    { data: body, extraHeaders: hdrs },
  );
  if (raw === null) throw new ScraperError('fetchMonthData: null response');
  const monthData = raw;
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
 * Fetch pending transaction data for a card via the browser session.
 * @param page - The Playwright page for browser-context fetch.
 * @param card - The card to fetch pending for.
 * @param hdrs - API request headers.
 * @returns Pending transaction details or status.
 */
export async function fetchPendingData(
  page: Page,
  card: ICardInfo,
  hdrs: Record<string, string>,
): Promise<ICardPendingTransactionDetails | ICardApiStatus> {
  LOG.debug(`fetch pending transactions for card ${card.cardUniqueId}`);
  const body: Record<string, JsonValue> = { cardUniqueIDArray: [card.cardUniqueId] };
  const raw = await fetchPostWithinPage<ICardPendingTransactionDetails | ICardApiStatus>(
    page,
    PENDING_ENDPOINT,
    { data: body, extraHeaders: hdrs },
  );
  if (raw === null) throw new ScraperError('fetchPendingData: null response');
  const isValid = raw.statusCode === 1 || raw.statusCode === 96;
  if (!isValid) return handlePendingFailure(raw, card);
  if (!isCardPendingTransactionDetails(raw)) {
    LOG.debug('pendingData is not ICardPendingTransactionDetails');
  }
  return raw;
}

/** Options for fetching all months of card data. */
export interface ICardDataMonthsOpts {
  page: Page;
  card: ICardInfo;
  allMonths: moment.Moment[];
  hdrs: Record<string, string>;
}

/**
 * Fetch transaction data for all months sequentially via the browser session.
 * @param opts - The card data months options.
 * @returns Array of monthly transaction details.
 */
export async function fetchCardDataMonths(
  opts: ICardDataMonthsOpts,
): Promise<ICardTransactionDetails[]> {
  const { page, card, allMonths, hdrs } = opts;
  const initial = Promise.resolve<ICardTransactionDetails[]>([]);
  return allMonths.reduce(
    (memo, month) =>
      memo.then(async acc => [...acc, await fetchMonthData({ page, card, month, hdrs })]),
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
 * Fetch card list from the init API via the browser session.
 * @param page - The Playwright page for browser-context fetch.
 * @param hdrs - API request headers.
 * @returns Array of card info objects.
 */
export async function fetchCards(page: Page, hdrs: Record<string, string>): Promise<ICardInfo[]> {
  LOG.debug('fetch cards via init API');
  const raw = await fetchPostWithinPage<IInitResponse>(page, INIT_ENDPOINT, {
    data: { tokenGuid: '' },
    extraHeaders: hdrs,
  });
  if (raw === null) throw new ScraperError('fetchCards: null init response');
  const initData = raw;
  const cards = initData.result.cards;
  return cards.map(({ cardUniqueId, last4Digits }) => ({ cardUniqueId, last4Digits }));
}

/**
 * Fetch card frames (misgarot) from the API via the browser session.
 * @param page - The Playwright page for browser-context fetch.
 * @param hdrs - API request headers.
 * @param cards - Array of card info.
 * @returns The frames response data.
 */
export async function fetchFrames(
  page: Page,
  hdrs: Record<string, string>,
  cards: ICardInfo[],
): Promise<IFramesResponse> {
  LOG.debug('fetch frames (misgarot) of cards');
  const cardIds = cards.map(({ cardUniqueId }) => ({ cardUniqueId }));
  const body: Record<string, JsonValue> = {
    cardsForFrameData: cardIds as JsonValue[],
  };
  const raw = await fetchPostWithinPage<IFramesResponse>(page, FRAMES_ENDPOINT, {
    data: body,
    extraHeaders: hdrs,
  });
  if (raw === null) throw new ScraperError('fetchFrames: null response');
  return raw;
}
