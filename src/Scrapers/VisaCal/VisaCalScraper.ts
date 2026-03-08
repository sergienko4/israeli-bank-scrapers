import moment from 'moment';
import type { Frame } from 'playwright';

import { getDebug } from '../../Common/Debug.js';
import {
  clickButton,
  waitUntilElementFound,
  waitUntilIframeFound,
} from '../../Common/ElementsInteractions.js';
import { fetchPost } from '../../Common/Fetch.js';
import { getCurrentUrl, waitForUrl } from '../../Common/Navigation.js';
import { getFromSessionStorage } from '../../Common/Storage.js';
import { filterOldTransactions } from '../../Common/Transactions.js';
import { waitUntil } from '../../Common/Waiting.js';
import { CompanyTypes } from '../../Definitions.js';
import type { TransactionsAccount } from '../../Transactions.js';
import { BaseScraperWithBrowser, type LoginOptions } from '../Base/BaseScraperWithBrowser.js';
import type { ScraperScrapingResult } from '../Base/Interface.js';
import { SCRAPER_CONFIGURATION } from '../Registry/ScraperConfig.js';
import {
  CONNECT_IFRAME_OPTS,
  convertParsedDataToTransactions,
  createLoginFields,
  findCardFrame,
  getPossibleLoginResults,
  isConnectFrame,
} from './VisaCalHelpers.js';
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
  isCardTransactionDetails,
  type LoginResponse,
} from './VisaCalTypes.js';

const VISCAL_CFG = SCRAPER_CONFIGURATION.banks[CompanyTypes.VisaCal];
const API_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
  Origin: VISCAL_CFG.api.calOrigin!,
  Referer: VISCAL_CFG.api.calOrigin!,
  'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7',
  'Sec-Fetch-Site': 'same-site',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Dest': 'empty',
};
const LOGIN_URL = VISCAL_CFG.urls.base;
const TRANSACTIONS_REQUEST_ENDPOINT = VISCAL_CFG.api.calTransactions!;
const FRAMES_REQUEST_ENDPOINT = VISCAL_CFG.api.calFrames!;
const PENDING_TRANSACTIONS_REQUEST_ENDPOINT = VISCAL_CFG.api.calPending!;
const LOGIN_RESPONSE_URL = VISCAL_CFG.api.calLoginResponse!;
const INIT_ENDPOINT = VISCAL_CFG.api.calInit!;

const LOG = getDebug('visa-cal');

interface ScraperSpecificCredentials {
  username: string;
  password: string;
}

class VisaCalScraper extends BaseScraperWithBrowser<ScraperSpecificCredentials> {
  private authorization: string | undefined = undefined;

  private authTokenPromise: Promise<string | undefined> | undefined;

  public openLoginPopup = async (): Promise<Frame> => {
    LOG.debug('open login popup');
    await waitUntilElementFound(this.page, '#ccLoginDesktopBtn', { visible: true });
    await clickButton(this.page, '#ccLoginDesktopBtn');
    const frame = await waitUntilIframeFound(this.page, isConnectFrame, CONNECT_IFRAME_OPTS);
    await waitUntilElementFound(frame, '#regular-login', { timeout: 30000 });
    LOG.debug('navigating to password login tab');
    await clickButton(frame, '#regular-login');
    await waitUntilElementFound(frame, '[formcontrolname="userName"]', { timeout: 45000 });
    return frame;
  };

  public async getCards(): Promise<CardInfo[]> {
    LOG.debug('fetch cards via init API (bypasses sessionStorage race)');
    const authorization = await this.getAuthorizationHeader();
    const hdrs = this.buildApiHeaders(authorization, await this.getXSiteId());
    const initData = await fetchPost<InitResponse>(INIT_ENDPOINT, { tokenGuid: '' }, hdrs);
    return initData.result.cards.map(({ cardUniqueId, last4Digits }) => ({
      cardUniqueId,
      last4Digits,
    }));
  }

  public async getAuthorizationHeader(): Promise<string> {
    if (!this.authorization) {
      LOG.debug('token not captured from POST response — falling back to sessionStorage (60s)');
      const startMs = Date.now();
      const authModule = await waitUntil(
        async () =>
          authModuleOrUndefined(await getFromSessionStorage<AuthModule>(this.page, 'auth-module')),
        'get authorization header with valid token in session storage',
        { timeout: 60_000, interval: 500 },
      );
      LOG.debug('sessionStorage auth-module populated after %dms', Date.now() - startMs);
      this.authorization = `CALAuthScheme ${authModule.auth.calConnectToken}`;
    }
    return this.authorization;
  }

  public async getXSiteId(): Promise<string> {
    return Promise.resolve(VISCAL_CFG.api.calXSiteId!);
  }

  public getLoginOptions(credentials: ScraperSpecificCredentials): LoginOptions {
    this.authTokenPromise = this.interceptLoginToken();
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
    LOG.debug(`fetch transactions starting ${startMoment.format()}`);
    const cards = await this.getCards();
    const ctx = await this.buildApiContext(startDate, startMoment);
    const accounts = await this.fetchAllCardAccounts(cards, ctx);
    LOG.debug(`return ${accounts.length} scraped accounts`);
    return { success: true, accounts };
  }

  private async handlePostLogin(): Promise<void> {
    const currentUrl = await getCurrentUrl(this.page);
    const isAlreadyLoggedIn = currentUrl.includes('cal-online.co.il/#');
    if (!isAlreadyLoggedIn) {
      await this.waitForPostLoginRedirect();
    }
    const token = await this.authTokenPromise;
    if (token) {
      LOG.debug('login token intercepted from POST response');
      this.authorization = `CALAuthScheme ${token}`;
    } else {
      LOG.debug('login token NOT intercepted — will fall back to sessionStorage on first API call');
      this.authorization = '';
    }
    LOG.debug('post-login URL: %s', await getCurrentUrl(this.page));
  }

  private async waitForPostLoginRedirect(): Promise<void> {
    try {
      // Old flow: redirect to digital-web; new flow: stay on cal-online.co.il/#
      const isPostLogin = /digital-web\.cal-online\.co\.il|cal-online\.co\.il\/#|dashboard/;
      await waitForUrl(this.page, isPostLogin, { timeout: 30000 });
      const url = await getCurrentUrl(this.page);
      if (url.includes('site-tutorial')) await clickButton(this.page, 'button.btn-close');
    } catch {
      LOG.debug('post-login redirect timeout — checking if already on dashboard');
    }
  }

  private interceptLoginToken(): Promise<string | undefined> {
    const isLogin = (r: { url(): string; request(): { method(): string } }): boolean =>
      r.url().includes(LOGIN_RESPONSE_URL) && r.request().method() === 'POST';
    return this.page
      .waitForResponse(isLogin, { timeout: 15_000 })
      .then(async response => ((await response.json()) as LoginResponse).token)
      .catch((e: unknown) => {
        LOG.debug({ err: e }, 'interceptLoginToken: no POST response within 15s');
        return undefined;
      });
  }

  private buildApiHeaders(authorization: string, xSiteId: string): Record<string, string> {
    return {
      authorization,
      'X-Site-Id': xSiteId,
      'Content-Type': 'application/json',
      ...API_HEADERS,
    };
  }

  private async fetchMonthData(
    card: CardInfo,
    month: moment.Moment,
    hdrs: Record<string, string>,
  ): Promise<CardTransactionDetails> {
    const monthData = await fetchPost<CardTransactionDetails | CardApiStatus>(
      TRANSACTIONS_REQUEST_ENDPOINT,
      { cardUniqueId: card.cardUniqueId, month: month.format('M'), year: month.format('YYYY') },
      hdrs,
    );
    if (monthData.statusCode !== 1)
      throw new Error(
        `failed to fetch transactions for card ${card.last4Digits}. Message: ${monthData.title || ''}`,
      );
    if (!isCardTransactionDetails(monthData))
      throw new Error('monthData is not of type CardTransactionDetails');
    return monthData;
  }

  private async fetchPendingData(
    card: CardInfo,
    hdrs: Record<string, string>,
  ): Promise<CardPendingTransactionDetails | null> {
    LOG.debug(`fetch pending transactions for card ${card.cardUniqueId}`);
    let pendingData: CardPendingTransactionDetails | CardApiStatus | null = await fetchPost<
      CardPendingTransactionDetails | CardApiStatus
    >(PENDING_TRANSACTIONS_REQUEST_ENDPOINT, { cardUniqueIDArray: [card.cardUniqueId] }, hdrs);
    if (pendingData.statusCode !== 1 && pendingData.statusCode !== 96) {
      LOG.debug(
        `failed to fetch pending transactions for card ${card.last4Digits}. Message: ${pendingData.title || ''}`,
      );
      pendingData = null;
    } else if (!isCardPendingTransactionDetails(pendingData)) {
      LOG.debug('pendingData is not of type CardTransactionDetails');
      pendingData = null;
    }
    return pendingData;
  }

  private async fetchCardDataMonths(
    card: CardInfo,
    allMonths: moment.Moment[],
    hdrs: Record<string, string>,
  ): Promise<CardTransactionDetails[]> {
    const allMonthsData: CardTransactionDetails[] = [];
    for (const month of allMonths) allMonthsData.push(await this.fetchMonthData(card, month, hdrs));
    return allMonthsData;
  }

  private async fetchCardData(
    card: CardInfo,
    opts: {
      startMoment: moment.Moment;
      futureMonthsToScrape: number;
      hdrs: Record<string, string>;
    },
  ): Promise<CardTransactionDetails[]> {
    const { startMoment, futureMonthsToScrape, hdrs } = opts;
    const finalMonthToFetchMoment = moment().add(futureMonthsToScrape, 'month');
    const months = finalMonthToFetchMoment.diff(startMoment, 'months');
    const allMonths = Array.from({ length: months + 1 }, (_, i) =>
      finalMonthToFetchMoment.clone().subtract(i, 'months'),
    );
    LOG.debug(`fetch completed transactions for card ${card.cardUniqueId}`);
    return this.fetchCardDataMonths(card, allMonths, hdrs);
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
    const pendingData = await this.fetchPendingData(card, ctx.hdrs);
    const allMonthsData = await this.fetchCardData(card, {
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
    LOG.debug('fetch frames (misgarot) of cards');
    const cards = await this.getCards();
    return fetchPost<FramesResponse>(
      FRAMES_REQUEST_ENDPOINT,
      { cardsForFrameData: cards.map(({ cardUniqueId }) => ({ cardUniqueId })) },
      hdrs,
    );
  }

  private async buildApiContext(startDate: Date, startMoment: moment.Moment): Promise<ApiContext> {
    const [xSiteId, authorization] = await Promise.all([
      this.getXSiteId(),
      this.getAuthorizationHeader(),
    ]);
    const hdrs = this.buildApiHeaders(authorization, xSiteId);
    const frames = await this.fetchFrames(hdrs);
    return { startDate, startMoment, hdrs, frames };
  }
}

export default VisaCalScraper;
