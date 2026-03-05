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
import type { TransactionsAccount } from '../../Transactions';
import { BaseScraperWithBrowser, type LoginOptions } from '../Base/BaseScraperWithBrowser';
import type { ScraperScrapingResult } from '../Base/Interface';
import { ScraperAuthenticationError } from '../Base/ScraperAuthenticationError';
import { SCRAPER_CONFIGURATION } from '../Registry/ScraperConfig';
import {
  CONNECT_IFRAME_OPTS,
  convertParsedDataToTransactions,
  createLoginFields,
  findCardFrame,
  getPossibleLoginResults,
  isConnectFrame,
  validateMonthDataResponse,
} from './VisaCalHelpers';
import {
  type ApiContext,
  type AuthModule,
  authModuleOrUndefined,
  type CardApiStatus,
  type CardInfo,
  type CardPendingTransactionDetails,
  type CardTransactionDetails,
  type FramesResponse,
  type InitResponse,
  isCardPendingTransactionDetails,
  type LoginResponse,
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

function buildApiHeaders(authorization: string, xSiteId: string): Record<string, string> {
  return {
    authorization,
    'X-Site-Id': xSiteId,
    'Content-Type': 'application/json',
    ...API_HEADERS,
  };
}

async function fetchMonthData(
  card: CardInfo,
  month: moment.Moment,
  hdrs: Record<string, string>,
): Promise<CardTransactionDetails> {
  const monthData = await fetchPost<CardTransactionDetails | CardApiStatus>(
    TRANSACTIONS_REQUEST_ENDPOINT,
    { cardUniqueId: card.cardUniqueId, month: month.format('M'), year: month.format('YYYY') },
    hdrs,
  );
  validateMonthDataResponse(monthData, card);
  return monthData;
}

async function fetchCardDataMonths(
  card: CardInfo,
  allMonths: moment.Moment[],
  hdrs: Record<string, string>,
): Promise<CardTransactionDetails[]> {
  return allMonths.reduce(
    async (prevPromise, month) => {
      const acc = await prevPromise;
      acc.push(await fetchMonthData(card, month, hdrs));
      return acc;
    },
    Promise.resolve([] as CardTransactionDetails[]),
  );
}

async function fetchCardData(
  card: CardInfo,
  opts: { startMoment: moment.Moment; futureMonthsToScrape: number; hdrs: Record<string, string> },
): Promise<CardTransactionDetails[]> {
  const { startMoment, futureMonthsToScrape, hdrs } = opts;
  const finalMonthToFetchMoment = moment().add(futureMonthsToScrape, 'month');
  const months = finalMonthToFetchMoment.diff(startMoment, 'months');
  const allMonths = Array.from({ length: months + 1 }, (_, i) =>
    finalMonthToFetchMoment.clone().subtract(i, 'months'),
  );
  LOG.info(`fetch completed transactions for card ${card.cardUniqueId}`);
  return fetchCardDataMonths(card, allMonths, hdrs);
}

async function fetchPendingData(
  card: CardInfo,
  hdrs: Record<string, string>,
): Promise<CardPendingTransactionDetails | null> {
  LOG.info(`fetch pending transactions for card ${card.cardUniqueId}`);
  let pendingData: CardPendingTransactionDetails | CardApiStatus | null = await fetchPost<
    CardPendingTransactionDetails | CardApiStatus
  >(PENDING_TRANSACTIONS_REQUEST_ENDPOINT, { cardUniqueIDArray: [card.cardUniqueId] }, hdrs);
  if (pendingData.statusCode !== 1 && pendingData.statusCode !== 96) {
    LOG.info(
      `failed to fetch pending transactions for card ${card.last4Digits}. Message: ${pendingData.title || ''}`,
    );
    pendingData = null;
  } else if (!isCardPendingTransactionDetails(pendingData)) {
    LOG.info('pendingData is not of type CardTransactionDetails');
    pendingData = null;
  }
  return pendingData;
}

export interface ScraperSpecificCredentials {
  username: string;
  password: string;
}

class VisaCalScraper extends BaseScraperWithBrowser<ScraperSpecificCredentials> {
  private _authorization: string | undefined = undefined;

  private _authTokenPromise: Promise<string | undefined> | undefined;

  public openLoginPopup = async (): Promise<Frame> => {
    LOG.info('open login popup');
    await waitUntilElementFound(this.page, '#ccLoginDesktopBtn', { visible: true });
    await clickButton(this.page, '#ccLoginDesktopBtn');
    const frame = await waitUntilIframeFound(this.page, isConnectFrame, CONNECT_IFRAME_OPTS);
    await waitUntilElementFound(frame, '#regular-login', { timeout: 30000 });
    LOG.info('navigating to password login tab');
    await clickButton(frame, '#regular-login');
    await waitUntilElementFound(frame, '[formcontrolname="userName"]', { timeout: 45000 });
    return frame;
  };

  public async getCards(): Promise<CardInfo[]> {
    LOG.info('fetch cards via init API (bypasses sessionStorage race)');
    const authorization = await this.getAuthorizationHeader();
    const hdrs = buildApiHeaders(authorization, X_SITE_ID);
    const initData = await fetchPost<InitResponse>(INIT_ENDPOINT, { tokenGuid: '' }, hdrs);
    return initData.result.cards.map(({ cardUniqueId, last4Digits }) => ({
      cardUniqueId,
      last4Digits,
    }));
  }

  public async getAuthorizationHeader(): Promise<string> {
    if (!this._authorization) {
      LOG.info(
        'token not captured from POST response — falling back to sessionStorage with reload retry',
      );
      this._authorization = await this.resolveAuthToken();
    }
    return this._authorization;
  }

  public getLoginOptions(credentials: ScraperSpecificCredentials): LoginOptions {
    this._authTokenPromise = this.interceptLoginToken();
    return {
      loginUrl: LOGIN_URL,
      fields: createLoginFields(credentials),
      submitButtonSelector: 'button[type="submit"]',
      possibleResults: getPossibleLoginResults(),
      checkReadiness: async () => waitUntilElementFound(this.page, '#ccLoginDesktopBtn'),
      preAction: this.openLoginPopup,
      postAction: () => this.handlePostLogin(),
    };
  }

  public async fetchData(): Promise<ScraperScrapingResult> {
    const defaultStartMoment = moment().subtract(1, 'years').subtract(6, 'months').add(1, 'day');
    const startDate = this.options.startDate;
    const startMoment = moment.max(defaultStartMoment, moment(startDate));
    LOG.info(`fetch transactions starting ${startMoment.format()}`);
    const cards = await this.getCards();
    const ctx = await this.buildApiContext(startDate, startMoment);
    const accounts = await this.fetchAllCardAccounts(cards, ctx);
    LOG.info('return %d scraped accounts', accounts.length);
    return { success: true, accounts };
  }

  private async resolveAuthToken(): Promise<string> {
    const startMs = Date.now();
    const retry = await waitUntilWithReload<AuthModule | undefined>(
      this.page,
      async () =>
        authModuleOrUndefined(await getFromSessionStorage<AuthModule>(this.page, 'auth-module')),
      { description: 'VisaCal auth-module', pollTimeout: 20_000, reloadAttempts: 2, interval: 500 },
    );
    if (!retry.found || !retry.value)
      throw new ScraperAuthenticationError(
        'VisaCal',
        'auth token unavailable after reload retries',
      );
    LOG.info('sessionStorage auth-module populated after %dms', Date.now() - startMs);
    return `CALAuthScheme ${retry.value.auth.calConnectToken ?? ''}`;
  }

  private async handlePostLogin(): Promise<void> {
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
  }

  private async waitForPostLoginRedirect(): Promise<void> {
    try {
      // Old flow: redirect to digital-web; new flow: stay on cal-online.co.il/#
      const isPostLogin = /digital-web\.cal-online\.co\.il|cal-online\.co\.il\/#|dashboard/;
      await waitForUrl(this.page, isPostLogin, { timeout: 30000 });
      const url = await getCurrentUrl(this.page);
      if (url.includes('site-tutorial')) await clickButton(this.page, 'button.btn-close');
    } catch {
      LOG.info('post-login redirect timeout — checking if already on dashboard');
    }
  }

  private interceptLoginToken(): Promise<string | undefined> {
    const isLogin = (r: { url(): string; request(): { method(): string } }): boolean =>
      r.url().includes(LOGIN_RESPONSE_URL) && r.request().method() === 'POST';
    return this.page
      .waitForResponse(isLogin, { timeout: 15_000 })
      .then(async response => ((await response.json()) as LoginResponse).token)
      .catch((e: unknown) => {
        LOG.info({ err: e }, 'interceptLoginToken: no POST response within 15s');
        return undefined;
      });
  }

  private filterCardTxns(
    transactions: ReturnType<typeof convertParsedDataToTransactions>,
    startDate: Date,
  ): ReturnType<typeof convertParsedDataToTransactions> {
    if (!(this.options.outputData?.isFilterByDateEnabled ?? true)) return transactions;
    return filterOldTransactions(
      transactions,
      moment(startDate),
      this.options.shouldCombineInstallments ?? false,
    );
  }

  private async buildCardTransactions(
    card: CardInfo,
    ctx: ApiContext,
  ): Promise<ReturnType<typeof convertParsedDataToTransactions>> {
    const futureMonthsToScrape = this.options.futureMonthsToScrape ?? 1;
    const pendingData = await fetchPendingData(card, ctx.hdrs);
    const allMonthsData = await fetchCardData(card, {
      startMoment: ctx.startMoment,
      futureMonthsToScrape,
      hdrs: ctx.hdrs,
    });
    return convertParsedDataToTransactions(allMonthsData, pendingData, this.options);
  }

  private async fetchOneCardAccount(card: CardInfo, ctx: ApiContext): Promise<TransactionsAccount> {
    const frame = findCardFrame(ctx.frames, card.cardUniqueId);
    const transactions = await this.buildCardTransactions(card, ctx);
    const txns = this.filterCardTxns(transactions, ctx.startDate);
    return {
      txns,
      balance: frame?.nextTotalDebit != null ? -frame.nextTotalDebit : undefined,
      accountNumber: card.last4Digits,
    } as TransactionsAccount;
  }

  private async fetchAllCardAccounts(
    cards: CardInfo[],
    ctx: ApiContext,
  ): Promise<TransactionsAccount[]> {
    return Promise.all(cards.map(card => this.fetchOneCardAccount(card, ctx)));
  }

  private async fetchFrames(hdrs: Record<string, string>): Promise<FramesResponse> {
    LOG.info('fetch frames (misgarot) of cards');
    const cards = await this.getCards();
    return fetchPost<FramesResponse>(
      FRAMES_REQUEST_ENDPOINT,
      { cardsForFrameData: cards.map(({ cardUniqueId }) => ({ cardUniqueId })) },
      hdrs,
    );
  }

  private async buildApiContext(startDate: Date, startMoment: moment.Moment): Promise<ApiContext> {
    const authorization = await this.getAuthorizationHeader();
    const hdrs = buildApiHeaders(authorization, X_SITE_ID);
    const frames = await this.fetchFrames(hdrs);
    return { startDate, startMoment, hdrs, frames };
  }
}

export default VisaCalScraper;
