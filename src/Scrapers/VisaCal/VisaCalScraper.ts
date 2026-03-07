import moment from 'moment';
import type { Frame } from 'playwright';

import { getDebug } from '../../Common/Debug';
import {
  clickButton,
  waitUntilElementFound,
  waitUntilIframeFound,
} from '../../Common/ElementsInteractions';
import { fetchPost } from '../../Common/Fetch';
import { getCurrentUrl, waitForUrl } from '../../Common/Navigation';
import { getFromSessionStorage } from '../../Common/Storage';
import { filterOldTransactions } from '../../Common/Transactions';
import { waitUntilWithReload } from '../../Common/Waiting';
import { CompanyTypes } from '../../Definitions';
import type { FoundResult } from '../../Interfaces/Common/FoundResult';
import type { IDoneResult } from '../../Interfaces/Common/StepResult';
import type { ITransactionsAccount } from '../../Transactions';
import { BaseScraperWithBrowser, type ILoginOptions } from '../Base/BaseScraperWithBrowser';
import type { IScraperScrapingResult } from '../Base/Interface';
import { ScraperAuthenticationError } from '../Base/ScraperAuthenticationError';
import { SCRAPER_CONFIGURATION } from '../Registry/ScraperConfig';
import {
  CONNECT_IFRAME_OPTS,
  convertParsedDataToTransactions,
  createLoginFields,
  findCardFrame,
  getPossibleLoginResults,
  isConnectFrame,
  parsePendingData,
  validateMonthDataResponse,
} from './VisaCalHelpers';
import {
  type IApiContext,
  type IAuthModule,
  type ICardApiStatus,
  type ICardInfo,
  type ICardPendingTransactionDetails,
  type ICardTransactionDetails,
  type IFramesResponse,
  type IInitResponse,
  type ILoginResponse,
  isAuthModule,
} from './VisaCalTypes';

const VISCAL_CFG = SCRAPER_CONFIGURATION.banks[CompanyTypes.VisaCal];
const CAL_ORIGIN = VISCAL_CFG.api.calOrigin ?? '';
const API_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
  Origin: CAL_ORIGIN,
  Referer: CAL_ORIGIN,
  'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7',
  'Sec-Fetch-Site': 'same-site',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Dest': 'empty',
};
const LOGIN_URL = VISCAL_CFG.urls.base;
const TRANSACTIONS_REQUEST_ENDPOINT = VISCAL_CFG.api.calTransactions ?? '';
const FRAMES_REQUEST_ENDPOINT = VISCAL_CFG.api.calFrames ?? '';
const PENDING_TRANSACTIONS_REQUEST_ENDPOINT = VISCAL_CFG.api.calPending ?? '';
const LOGIN_RESPONSE_URL = VISCAL_CFG.api.calLoginResponse ?? '';
const INIT_ENDPOINT = VISCAL_CFG.api.calInit ?? '';

const LOG = getDebug('visa-cal');

const X_SITE_ID = VISCAL_CFG.api.calXSiteId ?? '';

/**
 * Builds the API request headers with authorization and site ID for VisaCal API calls.
 *
 * @param authorization - the CALAuthScheme authorization token
 * @param xSiteId - the X-Site-Id header value from config
 * @returns a complete headers map for VisaCal API requests
 */
function buildApiHeaders(authorization: string, xSiteId: string): Record<string, string> {
  return {
    authorization,
    'X-Site-Id': xSiteId,
    'Content-Type': 'application/json',
    ...API_HEADERS,
  };
}

/**
 * Fetches transaction data for a single card and billing month.
 *
 * @param card - the card info for the request
 * @param month - the billing month to fetch
 * @param hdrs - the API headers with authorization
 * @returns the validated ICardTransactionDetails for the month
 */
async function fetchMonthData(
  card: ICardInfo,
  month: moment.Moment,
  hdrs: Record<string, string>,
): Promise<ICardTransactionDetails> {
  const monthData = await fetchPost<ICardTransactionDetails | ICardApiStatus>(
    TRANSACTIONS_REQUEST_ENDPOINT,
    { cardUniqueId: card.cardUniqueId, month: month.format('M'), year: month.format('YYYY') },
    hdrs,
  );
  validateMonthDataResponse(monthData, card);
  return monthData;
}

/**
 * Fetches transaction data for a card across multiple billing months.
 *
 * @param card - the card info for the requests
 * @param allMonths - the list of billing months to fetch
 * @param hdrs - the API headers with authorization
 * @returns an array of ICardTransactionDetails for each month
 */
async function fetchCardDataMonths(
  card: ICardInfo,
  allMonths: moment.Moment[],
  hdrs: Record<string, string>,
): Promise<ICardTransactionDetails[]> {
  const initialMonthsData = Promise.resolve([] as ICardTransactionDetails[]);
  return allMonths.reduce(async (prevPromise, month) => {
    const acc = await prevPromise;
    acc.push(await fetchMonthData(card, month, hdrs));
    return acc;
  }, initialMonthsData);
}

/**
 * Fetches all relevant billing months of transaction data for a card.
 *
 * @param card - the card info for the requests
 * @param opts - fetch options
 * @param opts.startMoment - the earliest billing month to include
 * @param opts.futureMonthsToScrape - the number of future billing months to include
 * @param opts.hdrs - the API headers with authorization
 * @returns an array of ICardTransactionDetails for all relevant months
 */
async function fetchCardData(
  card: ICardInfo,
  opts: { startMoment: moment.Moment; futureMonthsToScrape: number; hdrs: Record<string, string> },
): Promise<ICardTransactionDetails[]> {
  const { startMoment, futureMonthsToScrape, hdrs } = opts;
  const finalMonthToFetchMoment = moment().add(futureMonthsToScrape, 'month');
  const months = finalMonthToFetchMoment.diff(startMoment, 'months');
  const allMonths = Array.from({ length: months + 1 }, (_, i) =>
    finalMonthToFetchMoment.clone().subtract(i, 'months'),
  );
  LOG.info(`fetch completed transactions for card ${card.cardUniqueId}`);
  return fetchCardDataMonths(card, allMonths, hdrs);
}

/**
 * Fetches pending transaction data for a card.
 *
 * @param card - the card info for the request
 * @param hdrs - the API headers with authorization
 * @returns FoundResult with pending transaction details, or isFound=false if unavailable
 */
async function fetchPendingData(
  card: ICardInfo,
  hdrs: Record<string, string>,
): Promise<FoundResult<ICardPendingTransactionDetails>> {
  LOG.info(`fetch pending transactions for card ${card.cardUniqueId}`);
  const rawData = await fetchPost<ICardPendingTransactionDetails | ICardApiStatus>(
    PENDING_TRANSACTIONS_REQUEST_ENDPOINT,
    { cardUniqueIDArray: [card.cardUniqueId] },
    hdrs,
  );
  return parsePendingData(rawData, card);
}

export interface IScraperSpecificCredentials {
  username: string;
  password: string;
}

/** IScraper implementation for VisaCal (Visa Cal) credit cards. */
class VisaCalScraper extends BaseScraperWithBrowser<IScraperSpecificCredentials> {
  private _authorization: string | undefined = undefined;

  private _authTokenPromise: Promise<string> | undefined;

  /**
   * Opens the VisaCal login popup and navigates to the password login tab.
   *
   * @returns a FoundResult wrapping the login iframe ready for credential input
   */
  public openLoginPopup = async (): Promise<FoundResult<Frame>> => {
    LOG.info('open login popup');
    await waitUntilElementFound(this.page, '#ccLoginDesktopBtn', { visible: true });
    await clickButton(this.page, '#ccLoginDesktopBtn');
    const frame = await waitUntilIframeFound(this.page, isConnectFrame, CONNECT_IFRAME_OPTS);
    await waitUntilElementFound(frame, '#regular-login', { timeout: 30000 });
    LOG.info('navigating to password login tab');
    await clickButton(frame, '#regular-login');
    await waitUntilElementFound(frame, '[formcontrolname="userName"]', { timeout: 45000 });
    return { isFound: true, value: frame };
  };

  /**
   * Fetches all cards associated with the logged-in VisaCal account.
   *
   * @returns an array of ICardInfo objects with card ID and last 4 digits
   */
  public async getCards(): Promise<ICardInfo[]> {
    LOG.info('fetch cards via init API (bypasses sessionStorage race)');
    const authorization = await this.getAuthorizationHeader();
    const hdrs = buildApiHeaders(authorization, X_SITE_ID);
    const initData = await fetchPost<IInitResponse>(INIT_ENDPOINT, { tokenGuid: '' }, hdrs);
    if (initData.statusCode !== 1)
      throw new ScraperAuthenticationError('VisaCal', initData.statusDescription ?? 'init failed');
    const { cards: rawCards } = initData.result;
    return rawCards.map(({ cardUniqueId, last4Digits }) => ({ cardUniqueId, last4Digits }));
  }

  /**
   * Returns the CALAuthScheme authorization token, resolving from sessionStorage if not captured.
   *
   * @returns the full authorization header value for VisaCal API requests
   */
  public async getAuthorizationHeader(): Promise<string> {
    if (!this._authorization) {
      LOG.info(
        'token not captured from POST response — falling back to sessionStorage with reload retry',
      );
      this._authorization = await this.resolveAuthToken();
    }
    return this._authorization;
  }

  /**
   * Builds login options for VisaCal, including the login popup pre-action.
   *
   * @param credentials - VisaCal username and password
   * @returns ILoginOptions with the popup pre-action and post-login handler
   */
  public getLoginOptions(credentials: IScraperSpecificCredentials): ILoginOptions {
    this._authTokenPromise = this.interceptLoginToken();
    return {
      loginUrl: LOGIN_URL,
      fields: createLoginFields(credentials),
      submitButtonSelector: 'button[type="submit"]',
      possibleResults: getPossibleLoginResults(),
      /**
       * Waits for the VisaCal login button to be present before starting the login flow.
       *
       * @returns a promise that resolves when the button is found
       */
      checkReadiness: async () => waitUntilElementFound(this.page, '#ccLoginDesktopBtn'),
      preAction: this.openLoginPopup,
      /**
       * Handles post-login state capture and redirect.
       *
       * @returns a promise that resolves when post-login is complete
       */
      postAction: () => this.handlePostLogin(),
    };
  }

  /**
   * Fetches transaction data for all cards in the VisaCal account.
   *
   * @returns a successful scraping result with all card account transactions
   */
  public async fetchData(): Promise<IScraperScrapingResult> {
    const defaultStartMoment = moment().subtract(1, 'years').subtract(6, 'months').add(1, 'day');
    const startDate = this.options.startDate;
    const startDateMoment = moment(startDate);
    const startMoment = moment.max(defaultStartMoment, startDateMoment);
    LOG.info(`fetch transactions starting ${startMoment.format()}`);
    const cards = await this.getCards();
    const ctx = await this.buildApiContext(startDate, startMoment);
    const accounts = await this.fetchAllCardAccounts(cards, ctx);
    LOG.info('return %d scraped accounts', accounts.length);
    return { success: true, accounts };
  }

  /**
   * Polls sessionStorage for the VisaCal auth module. Returns false (falsy) when not found yet,
   * which causes waitUntilWithReload to keep polling. Returns IAuthModule when ready.
   *
   * @returns the IAuthModule when populated, or false when not yet available
   */
  private async pollAuthModule(): Promise<IAuthModule | false> {
    const stored = await getFromSessionStorage<IAuthModule>(this.page, 'auth-module');
    if (!stored.hasValue) return false;
    return isAuthModule(stored.value) ? stored.value : false;
  }

  /**
   * Resolves the auth token from sessionStorage, retrying with page reload if needed.
   *
   * @returns the CALAuthScheme token string
   */
  private async resolveAuthToken(): Promise<string> {
    const startMs = Date.now();
    const retry = await waitUntilWithReload(this.page, () => this.pollAuthModule(), {
      description: 'VisaCal auth-module',
      pollTimeout: 20_000,
      reloadAttempts: 2,
      interval: 500,
    });
    if (!retry.found)
      throw new ScraperAuthenticationError(
        'VisaCal',
        'auth token unavailable after reload retries',
      );
    LOG.info('sessionStorage auth-module populated after %dms', Date.now() - startMs);
    return `CALAuthScheme ${(retry.value as IAuthModule).auth.calConnectToken ?? ''}`;
  }

  /**
   * Handles post-login state: captures the auth token and waits for the dashboard URL.
   *
   * @returns a done result after post-login state is captured
   */
  private async handlePostLogin(): Promise<IDoneResult> {
    const currentUrl = await getCurrentUrl(this.page);
    const isAlreadyLoggedIn = currentUrl.includes('cal-online.co.il/#');
    if (!isAlreadyLoggedIn) {
      await this.waitForPostLoginRedirect();
    }
    const token = await this._authTokenPromise;
    if (token) {
      LOG.info('login token intercepted from POST response');
      this._authorization = `CALAuthScheme ${token}`;
    } else {
      LOG.info('login token NOT intercepted — will fall back to sessionStorage on first API call');
      this._authorization = '';
    }
    LOG.info('post-login URL: %s', await getCurrentUrl(this.page));
    return { done: true };
  }

  /**
   * Waits for the page to redirect to a post-login URL, with a timeout fallback.
   *
   * @returns a done result after the redirect completes or times out
   */
  private async waitForPostLoginRedirect(): Promise<IDoneResult> {
    try {
      // Old flow: redirect to digital-web; new flow: stay on cal-online.co.il/#
      const isPostLogin = /digital-web\.cal-online\.co\.il|cal-online\.co\.il\/#|dashboard/;
      await waitForUrl(this.page, isPostLogin, { timeout: 30000 });
      const url = await getCurrentUrl(this.page);
      if (url.includes('site-tutorial')) await clickButton(this.page, 'button.btn-close');
    } catch {
      LOG.info('post-login redirect timeout — checking if already on dashboard');
    }
    return { done: true };
  }

  /**
   * Intercepts the login POST response to capture the auth token directly.
   *
   * @returns a promise resolving with the token string or undefined if not captured
   */
  private interceptLoginToken(): Promise<string> {
    /**
     * Checks whether a network response is the login token POST response.
     *
     * @param r - the network response to check
     * @param r.url - method returning the response URL
     * @param r.request - method returning the associated request
     * @returns true if this is the login token POST response
     */
    const isLogin = (r: { url(): string; request(): { method(): string } }): boolean =>
      r.url().includes(LOGIN_RESPONSE_URL) && r.request().method() === 'POST';
    return this.page
      .waitForResponse(isLogin, { timeout: 15_000 })
      .then(async response => ((await response.json()) as ILoginResponse).token)
      .catch((e: unknown) => {
        LOG.info({ err: e }, 'interceptLoginToken: no POST response within 15s');
        return '';
      });
  }

  /**
   * Applies date filtering to the card's transactions based on scraper options.
   *
   * @param transactions - the converted transactions to filter
   * @param startDate - the earliest date to include
   * @returns the filtered list of transactions
   */
  private filterCardTxns(
    transactions: ReturnType<typeof convertParsedDataToTransactions>,
    startDate: Date,
  ): ReturnType<typeof convertParsedDataToTransactions> {
    if (!(this.options.outputData?.isFilterByDateEnabled ?? true)) return transactions;
    const startMoment = moment(startDate);
    return filterOldTransactions(
      transactions,
      startMoment,
      this.options.shouldCombineInstallments ?? false,
    );
  }

  /**
   * Fetches and converts all transactions for a single card.
   *
   * @param card - the card to fetch transactions for
   * @param ctx - the API context with headers and date range
   * @returns converted ITransaction objects for the card
   */
  private async buildCardTransactions(
    card: ICardInfo,
    ctx: IApiContext,
  ): Promise<ReturnType<typeof convertParsedDataToTransactions>> {
    const futureMonthsToScrape = this.options.futureMonthsToScrape ?? 1;
    const { startMoment, hdrs } = ctx;
    const pendingResult = await fetchPendingData(card, hdrs);
    const pendingData = pendingResult.isFound ? pendingResult.value : undefined;
    const allMonthsData = await fetchCardData(card, { startMoment, futureMonthsToScrape, hdrs });
    return convertParsedDataToTransactions(allMonthsData, pendingData, this.options);
  }

  /**
   * Fetches and builds a ITransactionsAccount for a single card.
   *
   * @param card - the card info
   * @param ctx - the API context with headers, date range, and frame data
   * @returns a ITransactionsAccount with balance and transactions
   */
  private async fetchOneCardAccount(
    card: ICardInfo,
    ctx: IApiContext,
  ): Promise<ITransactionsAccount> {
    const frameResult = findCardFrame(ctx.frames, card.cardUniqueId);
    const transactions = await this.buildCardTransactions(card, ctx);
    const txns = this.filterCardTxns(transactions, ctx.startDate);
    const debit = frameResult.isFound ? frameResult.value.nextTotalDebit : undefined;
    const balance = debit != null ? -debit : undefined;
    return { txns, balance, accountNumber: card.last4Digits } as ITransactionsAccount;
  }

  /**
   * Fetches ITransactionsAccount data for all cards in parallel.
   *
   * @param cards - the list of cards to fetch
   * @param ctx - the API context with headers, date range, and frame data
   * @returns an array of ITransactionsAccount objects
   */
  private async fetchAllCardAccounts(
    cards: ICardInfo[],
    ctx: IApiContext,
  ): Promise<ITransactionsAccount[]> {
    const cardPromises = cards.map(card => this.fetchOneCardAccount(card, ctx));
    return Promise.all(cardPromises);
  }

  /**
   * Fetches the frames (misgarot) data with next billing amounts per card.
   *
   * @param hdrs - the API headers with authorization
   * @returns the frames response with card billing data
   */
  private async fetchFrames(hdrs: Record<string, string>): Promise<IFramesResponse> {
    LOG.info('fetch frames (misgarot) of cards');
    const cards = await this.getCards();
    return fetchPost<IFramesResponse>(
      FRAMES_REQUEST_ENDPOINT,
      { cardsForFrameData: cards.map(({ cardUniqueId }) => ({ cardUniqueId })) },
      hdrs,
    );
  }

  /**
   * Builds the complete API context with authorization, headers, and frame data.
   *
   * @param startDate - the earliest date for transaction fetching
   * @param startMoment - the start moment for transaction filtering
   * @returns a fully initialized IApiContext for all card data requests
   */
  private async buildApiContext(startDate: Date, startMoment: moment.Moment): Promise<IApiContext> {
    const authorization = await this.getAuthorizationHeader();
    const hdrs = buildApiHeaders(authorization, X_SITE_ID);
    const frames = await this.fetchFrames(hdrs);
    return { startDate, startMoment, hdrs, frames };
  }
}

export default VisaCalScraper;
