import moment from 'moment';
import { type Frame, type Request } from 'playwright';

import { getDebug } from '../Helpers/Debug';
import { clickButton, waitUntilElementFound } from '../Helpers/ElementsInteractions';
import { fetchPost } from '../Helpers/Fetch';
import { getCurrentUrl, waitForNavigation } from '../Helpers/Navigation';
import { getFromSessionStorage } from '../Helpers/Storage';
import { filterOldTransactions } from '../Helpers/Transactions';
import { waitUntil } from '../Helpers/Waiting';
import { type TransactionsAccount } from '../Transactions';
import { BaseScraperWithBrowser, type LoginOptions } from './BaseScraperWithBrowser';
import { type ScraperScrapingResult } from './Interface';
import {
  convertParsedDataToTransactions,
  createLoginFields,
  getLoginFrame,
  getPossibleLoginResults,
  hasChangePasswordForm,
} from './VisaCalHelpers';
import {
  type AuthModule,
  authModuleOrUndefined,
  type CardApiStatus,
  type CardLevelFrame,
  type CardPendingTransactionDetails,
  type CardTransactionDetails,
  type FramesResponse,
  type InitResponse,
  isCardPendingTransactionDetails,
  isCardTransactionDetails,
} from './VisaCalTypes';

const API_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
  Origin: 'https://digital-web.cal-online.co.il',
  Referer: 'https://digital-web.cal-online.co.il',
  'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7',
  'Sec-Fetch-Site': 'same-site',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Dest': 'empty',
};
const LOGIN_URL = 'https://www.cal-online.co.il/';
const TRANSACTIONS_REQUEST_ENDPOINT =
  'https://api.cal-online.co.il/Transactions/api/transactionsDetails/getCardTransactionsDetails';
const FRAMES_REQUEST_ENDPOINT = 'https://api.cal-online.co.il/Frames/api/Frames/GetFrameStatus';
const PENDING_TRANSACTIONS_REQUEST_ENDPOINT =
  'https://api.cal-online.co.il/Transactions/api/approvals/getClearanceRequests';
const SSO_AUTHORIZATION_REQUEST_ENDPOINT =
  'https://connect.cal-online.co.il/col-rest/calconnect/authentication/SSO';

const DEBUG = getDebug('visa-cal');

type ScraperSpecificCredentials = { username: string; password: string };

class VisaCalScraper extends BaseScraperWithBrowser<ScraperSpecificCredentials> {
  private authorization: string | undefined = undefined;

  private authRequestPromise: Promise<Request | undefined> | undefined;

  openLoginPopup = async (): Promise<Frame> => {
    DEBUG('open login popup, wait until login button available');
    await waitUntilElementFound(this.page, '#ccLoginDesktopBtn', { visible: true });
    DEBUG('click on the login button');
    await clickButton(this.page, '#ccLoginDesktopBtn');
    DEBUG('get the frame that holds the login');
    const frame = await getLoginFrame(this.page);
    DEBUG('wait until the password login tab header is available');
    await waitUntilElementFound(frame, '#regular-login');
    DEBUG('navigate to the password login tab');
    await clickButton(frame, '#regular-login');
    DEBUG('wait until the regular-login form is ready');
    await waitUntilElementFound(frame, '[formcontrolname="userName"]');

    return frame;
  };

  async getCards(): Promise<Array<{ cardUniqueId: string; last4Digits: string }>> {
    const initData = await waitUntil(
      () => getFromSessionStorage<InitResponse>(this.page, 'init'),
      'get init data in session storage',
      { timeout: 30000, interval: 1000 },
    );
    if (!initData) {
      throw new Error('could not find "init" data in session storage');
    }
    return initData?.result.cards.map(({ cardUniqueId, last4Digits }) => ({
      cardUniqueId,
      last4Digits,
    }));
  }

  async getAuthorizationHeader(): Promise<string> {
    if (!this.authorization) {
      DEBUG('fetching authorization header');
      const authModule = await waitUntil(
        async () =>
          authModuleOrUndefined(await getFromSessionStorage<AuthModule>(this.page, 'auth-module')),
        'get authorization header with valid token in session storage',
        { timeout: 10_000, interval: 50 },
      );
      return `CALAuthScheme ${authModule.auth.calConnectToken}`;
    }
    return this.authorization;
  }

  async getXSiteId(): Promise<string> {
    return Promise.resolve('09031987-273E-2311-906C-8AF85B17C8D9');
  }

  getLoginOptions(credentials: ScraperSpecificCredentials): LoginOptions {
    this.authRequestPromise = this.page
      .waitForRequest(SSO_AUTHORIZATION_REQUEST_ENDPOINT, { timeout: 10_000 })
      .catch(e => {
        DEBUG('error while waiting for the token request', e);
        return undefined;
      });
    return {
      loginUrl: `${LOGIN_URL}`,
      fields: createLoginFields(credentials),
      submitButtonSelector: 'button[type="submit"]',
      possibleResults: getPossibleLoginResults(),
      checkReadiness: async () => waitUntilElementFound(this.page, '#ccLoginDesktopBtn'),
      preAction: this.openLoginPopup,
      postAction: () => this.handlePostLogin(),
    };
  }

  async fetchData(): Promise<ScraperScrapingResult> {
    const defaultStartMoment = moment().subtract(1, 'years').subtract(6, 'months').add(1, 'day');
    const startDate = this.options.startDate || defaultStartMoment.toDate();
    const startMoment = moment.max(defaultStartMoment, moment(startDate));
    DEBUG(`fetch transactions starting ${startMoment.format()}`);
    const cards = await this.getCards();
    const ctx = await this.buildApiContext(startDate, startMoment);
    const accounts = await this.fetchAllCardAccounts(cards, ctx);
    DEBUG(`return ${accounts.length} scraped accounts`);
    return { success: true, accounts };
  }

  private async handlePostLogin(): Promise<void> {
    try {
      await waitForNavigation(this.page);
      const currentUrl = await getCurrentUrl(this.page);
      if (currentUrl.endsWith('site-tutorial')) await clickButton(this.page, 'button.btn-close');
      const request = await this.authRequestPromise;
      this.authorization = String(request?.headers().authorization || '').trim();
    } catch (e) {
      const currentUrl = await getCurrentUrl(this.page);
      if (currentUrl.endsWith('dashboard')) return;
      if (await hasChangePasswordForm(this.page)) return;
      throw e;
    }
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
    card: { cardUniqueId: string; last4Digits: string },
    month: moment.Moment,
    hdrs: Record<string, string>,
  ): Promise<CardTransactionDetails> {
    const monthData = await fetchPost<CardTransactionDetails | CardApiStatus>(
      TRANSACTIONS_REQUEST_ENDPOINT,
      { cardUniqueId: card.cardUniqueId, month: month.format('M'), year: month.format('YYYY') },
      hdrs,
    );
    if (monthData?.statusCode !== 1)
      throw new Error(
        `failed to fetch transactions for card ${card.last4Digits}. Message: ${monthData?.title || ''}`,
      );
    if (!isCardTransactionDetails(monthData))
      throw new Error('monthData is not of type CardTransactionDetails');
    return monthData;
  }

  private async fetchPendingData(
    card: { cardUniqueId: string; last4Digits: string },
    hdrs: Record<string, string>,
  ): Promise<CardPendingTransactionDetails | null> {
    DEBUG(`fetch pending transactions for card ${card.cardUniqueId}`);
    let pendingData: CardPendingTransactionDetails | CardApiStatus | null = await fetchPost<
      CardPendingTransactionDetails | CardApiStatus
    >(PENDING_TRANSACTIONS_REQUEST_ENDPOINT, { cardUniqueIDArray: [card.cardUniqueId] }, hdrs);
    if (pendingData?.statusCode !== 1 && pendingData?.statusCode !== 96) {
      DEBUG(
        `failed to fetch pending transactions for card ${card.last4Digits}. Message: ${pendingData?.title || ''}`,
      );
      pendingData = null;
    } else if (!isCardPendingTransactionDetails(pendingData)) {
      DEBUG('pendingData is not of type CardTransactionDetails');
      pendingData = null;
    }
    return pendingData;
  }

  private async fetchCardDataMonths(
    card: { cardUniqueId: string; last4Digits: string },
    allMonths: moment.Moment[],
    hdrs: Record<string, string>,
  ): Promise<CardTransactionDetails[]> {
    const allMonthsData: CardTransactionDetails[] = [];
    for (const month of allMonths) allMonthsData.push(await this.fetchMonthData(card, month, hdrs));
    return allMonthsData;
  }

  private async fetchCardData(
    card: { cardUniqueId: string; last4Digits: string },
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
    DEBUG(`fetch completed transactions for card ${card.cardUniqueId}`);
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
      this.options.shouldCombineInstallments || false,
    );
  }

  private findCardFrame(frames: FramesResponse, cardUniqueId: string): CardLevelFrame | undefined {
    return frames.result?.bankIssuedCards?.cardLevelFrames?.find(
      f => f.cardUniqueId === cardUniqueId,
    );
  }

  private async buildCardTransactions(
    card: { cardUniqueId: string; last4Digits: string },
    ctx: { startDate: Date; startMoment: moment.Moment; hdrs: Record<string, string> },
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

  private async fetchOneCardAccount(
    card: { cardUniqueId: string; last4Digits: string },
    ctx: {
      startDate: Date;
      startMoment: moment.Moment;
      hdrs: Record<string, string>;
      frames: FramesResponse;
    },
  ): Promise<TransactionsAccount> {
    const frame = this.findCardFrame(ctx.frames, card.cardUniqueId);
    const transactions = await this.buildCardTransactions(card, ctx);
    const txns = this.filterCardTxns(transactions, ctx.startDate);
    return {
      txns,
      balance: frame?.nextTotalDebit != null ? -frame.nextTotalDebit : undefined,
      accountNumber: card.last4Digits,
    } as TransactionsAccount;
  }

  private async fetchAllCardAccounts(
    cards: Array<{ cardUniqueId: string; last4Digits: string }>,
    ctx: {
      startDate: Date;
      startMoment: moment.Moment;
      hdrs: Record<string, string>;
      frames: FramesResponse;
    },
  ): Promise<TransactionsAccount[]> {
    return Promise.all(cards.map(card => this.fetchOneCardAccount(card, ctx)));
  }

  private async fetchFrames(hdrs: Record<string, string>): Promise<FramesResponse> {
    DEBUG('fetch frames (misgarot) of cards');
    const cards = await this.getCards();
    return fetchPost<FramesResponse>(
      FRAMES_REQUEST_ENDPOINT,
      { cardsForFrameData: cards.map(({ cardUniqueId }) => ({ cardUniqueId })) },
      hdrs,
    );
  }

  private async buildApiContext(
    startDate: Date,
    startMoment: moment.Moment,
  ): Promise<{
    startDate: Date;
    startMoment: moment.Moment;
    hdrs: Record<string, string>;
    frames: FramesResponse;
  }> {
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
