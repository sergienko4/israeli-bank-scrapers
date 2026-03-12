import moment from 'moment';

import { getDebug } from '../../Common/Debug.js';
import { getCurrentUrl } from '../../Common/Navigation.js';
import { getFromSessionStorage } from '../../Common/Storage.js';
import { filterOldTransactions } from '../../Common/Transactions.js';
import { waitUntil } from '../../Common/Waiting.js';
import type { ITransactionsAccount } from '../../Transactions.js';
import type { ILoginOptions } from '../Base/BaseScraperWithBrowser.js';
import GenericBankScraper from '../Base/GenericBankScraper.js';
import type { IScraperScrapingResult, ScraperOptions } from '../Base/Interface.js';
import { VISACAL_LOGIN_CONFIG } from './Config/VisaCalLoginConfig.js';
import {
  buildApiHeaders,
  buildMonthRange,
  fetchCardDataMonths,
  fetchCards,
  fetchFrames,
  fetchPendingData,
  LOGIN_RESPONSE_URL,
  X_SITE_ID,
} from './VisaCalFetch.js';
import { convertParsedDataToTransactions, findCardFrame } from './VisaCalHelpers.js';
import {
  authModuleOrUndefined,
  type IApiContext,
  type IAuthModule,
  type ICardInfo,
  type ILoginResponse,
  isCardPendingTransactionDetails,
} from './VisaCalTypes.js';

const LOG = getDebug('visa-cal');

/** Credentials specific to VisaCal login. */
interface IScraperSpecificCredentials {
  username: string;
  password: string;
}

/** Scraper for VisaCal (CAL Online) credit card portal. */
class VisaCalScraper extends GenericBankScraper<IScraperSpecificCredentials> {
  private _authorization = '';

  private _authTokenPromise: Promise<string> | undefined;

  /**
   * Create a VisaCal scraper instance.
   * @param options - Scraper configuration options.
   */
  constructor(options: ScraperOptions) {
    super(options, VISACAL_LOGIN_CONFIG);
  }

  /**
   * Override login options to intercept auth token.
   * @param credentials - VisaCal username and password.
   * @returns Login options with auth token interception.
   */
  public override getLoginOptions(credentials: IScraperSpecificCredentials): ILoginOptions {
    this._authTokenPromise = this.interceptLoginToken();
    const opts = super.getLoginOptions(credentials);
    const originalPost = opts.postAction;
    return {
      ...opts,
      /**
       * Post-login: capture auth token.
       * @returns True after capturing.
       */
      postAction: async (): Promise<boolean> => {
        if (originalPost) await originalPost();
        await this.captureAuthToken();
        return true;
      },
    };
  }

  /**
   * Fetch all transaction data from VisaCal API.
   * @returns Scraping result with transaction accounts.
   */
  public async fetchData(): Promise<IScraperScrapingResult> {
    const startMoment = this.computeStartMoment();
    LOG.debug(`fetch transactions starting ${startMoment.format()}`);
    const hdrs = await this.buildHeaders();
    const cards = await fetchCards(hdrs);
    const frames = await fetchFrames(hdrs, cards);
    const ctx: IApiContext = { startDate: this.options.startDate, startMoment, hdrs, frames };
    const accounts = await this.fetchAllCardAccounts(cards, ctx);
    LOG.debug(`return ${String(accounts.length)} scraped accounts`);
    return { success: true, accounts };
  }

  /**
   * Get the authorization header, falling back to sessionStorage.
   * @returns The CALAuthScheme authorization string.
   */
  public async getAuthorizationHeader(): Promise<string> {
    if (this._authorization) return this._authorization;
    LOG.debug('token not captured — falling back to sessionStorage');
    const authModule = await this.waitForAuthModule();
    const token = authModule.auth.calConnectToken ?? '';
    this._authorization = `CALAuthScheme ${token}`;
    return this._authorization;
  }

  /**
   * Get the X-Site-Id header value from config.
   * @returns The X-Site-Id string.
   */
  public static getXSiteId(): string {
    return X_SITE_ID;
  }

  /**
   * Compute the effective start moment for scraping.
   * @returns The start moment capped at 18 months ago.
   */
  private computeStartMoment(): moment.Moment {
    const defaultStart = moment().subtract(1, 'years').subtract(6, 'months').add(1, 'day');
    const optStart = moment(this.options.startDate);
    return moment.max(defaultStart, optStart);
  }

  /**
   * Wait for the auth module to appear in sessionStorage.
   * @returns The resolved auth module.
   */
  private async waitForAuthModule(): Promise<IAuthModule> {
    const startMs = Date.now();
    const authModule = await waitUntil(
      async () => {
        const raw = await getFromSessionStorage<IAuthModule>(this.page, 'auth-module');
        return authModuleOrUndefined(raw);
      },
      'get authorization header with valid token',
      { timeout: 60_000, interval: 500 },
    );
    const elapsed = String(Date.now() - startMs);
    LOG.debug('sessionStorage populated after %sms', elapsed);
    return authModule;
  }

  /**
   * Build API headers with current authorization.
   * @returns The API headers.
   */
  private async buildHeaders(): Promise<Record<string, string>> {
    const authorization = await this.getAuthorizationHeader();
    return buildApiHeaders(authorization, X_SITE_ID);
  }

  /**
   * Capture auth token from intercepted login response.
   * @returns True after capturing.
   */
  private async captureAuthToken(): Promise<boolean> {
    const token = await this._authTokenPromise;
    if (token) {
      LOG.debug('login token intercepted from POST response');
      this._authorization = `CALAuthScheme ${token}`;
    } else {
      LOG.debug('login token NOT intercepted — fallback later');
    }
    const currentUrl = await getCurrentUrl(this.page);
    LOG.debug('post-login URL: %s', currentUrl);
    return true;
  }

  /**
   * Intercept the login POST response to extract the auth token.
   * @returns The token string, or empty on timeout.
   */
  private interceptLoginToken(): Promise<string> {
    return this.page
      .waitForResponse(
        resp => resp.url().includes(LOGIN_RESPONSE_URL) && resp.request().method() === 'POST',
        { timeout: 15_000 },
      )
      .then(async resp => ((await resp.json()) as ILoginResponse).token)
      .catch((caught: unknown) => {
        LOG.debug({ err: caught }, 'interceptLoginToken: no POST response within 15s');
        return '';
      });
  }

  /**
   * Build transactions for a single card.
   * @param card - The card to build transactions for.
   * @param ctx - The API context with headers and dates.
   * @returns Parsed and converted transactions.
   */
  private async buildCardTransactions(
    card: ICardInfo,
    ctx: IApiContext,
  ): Promise<ReturnType<typeof convertParsedDataToTransactions>> {
    const futureMonths = this.options.futureMonthsToScrape ?? 1;
    const allMonths = buildMonthRange(ctx.startMoment, futureMonths);
    LOG.debug(`fetch completed transactions for card ${card.cardUniqueId}`);
    const monthsData = await fetchCardDataMonths(card, allMonths, ctx.hdrs);
    const pendingResult = await fetchPendingData(card, ctx.hdrs);
    const pending = isCardPendingTransactionDetails(pendingResult) ? pendingResult : undefined;
    return convertParsedDataToTransactions(monthsData, pending, this.options);
  }

  /**
   * Filter transactions by date if enabled.
   * @param transactions - Parsed transactions to filter.
   * @param startDate - The start date cutoff.
   * @returns Filtered transactions.
   */
  private filterCardTxns(
    transactions: ReturnType<typeof convertParsedDataToTransactions>,
    startDate: Date,
  ): ReturnType<typeof convertParsedDataToTransactions> {
    const isFilter = this.options.outputData?.isFilterByDateEnabled ?? true;
    if (!isFilter) return transactions;
    const shouldCombine = this.options.shouldCombineInstallments ?? false;
    const startMoment = moment(startDate);
    return filterOldTransactions(transactions, startMoment, shouldCombine);
  }

  /**
   * Fetch account data for a single card.
   * @param card - The card to fetch account for.
   * @param ctx - The API context.
   * @returns A transactions account for the card.
   */
  private async fetchOneCardAccount(
    card: ICardInfo,
    ctx: IApiContext,
  ): Promise<ITransactionsAccount> {
    const frame = findCardFrame(ctx.frames, card.cardUniqueId);
    const txnsRaw = await this.buildCardTransactions(card, ctx);
    const txns = this.filterCardTxns(txnsRaw, ctx.startDate);
    const balance = frame?.nextTotalDebit != null ? -frame.nextTotalDebit : undefined;
    return { txns, balance, accountNumber: card.last4Digits } as ITransactionsAccount;
  }

  /**
   * Fetch account data for all cards in parallel.
   * @param cards - The cards to fetch accounts for.
   * @param ctx - The API context.
   * @returns Array of transaction accounts.
   */
  private async fetchAllCardAccounts(
    cards: ICardInfo[],
    ctx: IApiContext,
  ): Promise<ITransactionsAccount[]> {
    const promises = cards.map(card => this.fetchOneCardAccount(card, ctx));
    return Promise.all(promises);
  }
}

export default VisaCalScraper;
