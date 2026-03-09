import moment from 'moment';

import { getDebug } from '../../Common/Debug.js';
import { fetchGraphql, type JsonValue } from '../../Common/Fetch.js';
import { runSerial } from '../../Common/Waiting.js';
import {
  type ITransaction as ScrapingTransaction,
  type ITransactionsAccount,
} from '../../Transactions.js';
import BaseScraper from '../Base/BaseScraper.js';
import { createGenericError, ScraperErrorTypes } from '../Base/Errors.js';
import {
  type IScraperLoginResult,
  type IScraperScrapingResult,
  type ScraperGetLongTermTwoFactorTokenResult,
  type ScraperTwoFactorAuthTriggerResult,
} from '../Base/Interface.js';
import {
  fetchDeviceToken,
  getIdToken,
  getSessionToken,
  idPost,
  sendOtp,
} from './OneZeroIdentity.js';
import { fallbackBalance, mapMovement, sortByTimestamp } from './OneZeroMappers.js';
import { GET_ACCOUNT_BALANCE, GET_CUSTOMER, GET_MOVEMENTS } from './OneZeroQueries.js';
import {
  type ICategory,
  type ICustomer,
  type IMovement,
  type IPortfolio,
  type IQueryPagination,
  type IRecurrence,
  type IScraperSpecificCredentials,
} from './OneZeroTypes.js';

export type { ICategory, IRecurrence };

const LOG = getDebug('one-zero');
const GQL_URL = 'https://mobile.tfd-bank.com/mobile-graph/graphql';
const MOVEMENTS_LIMIT = 50;

/** Pagination input for the movements GraphQL query. */
interface IMovementsPaginationInput {
  [key: string]: JsonValue;
  limit: number;
}

/** GraphQL variables for a movements query. */
interface IMovementsVariables {
  [key: string]: JsonValue;
  portfolioId: string;
  accountId: string;
  language: string;
  pagination: IMovementsPaginationInput;
}

/**
 * Build the GraphQL variables for a movements query.
 * @param portfolioId - The portfolio identifier.
 * @param accountId - The account identifier.
 * @param cursor - The pagination cursor.
 * @returns The variables object for the query.
 */
function buildMovementsVariables(
  portfolioId: string,
  accountId: string,
  cursor?: string,
): IMovementsVariables {
  return {
    portfolioId,
    accountId,
    language: 'HEBREW',
    pagination: { cursor: cursor ?? null, limit: MOVEMENTS_LIMIT },
  };
}

interface IMovementsFetchContext {
  portfolio: IPortfolio;
  accountId: string;
  startDate: Date;
}

interface IMovementsFetchState {
  accumulated: IMovement[];
  cursor: string | null;
}

/**
 * Check if pagination should stop for movements.
 * @param result - The accumulated movements so far.
 * @param hasMore - Whether more pages exist.
 * @param startDate - The start date threshold.
 * @returns True if fetching should stop.
 */
function shouldStop(result: IMovement[], hasMore: boolean, startDate: Date): boolean {
  if (!hasMore) return true;
  if (!result.length) return false;
  return new Date(result[0].movementTimestamp) < startDate;
}

/** OneZero bank scraper — fetches transactions via GraphQL. */
export default class OneZeroScraper extends BaseScraper<IScraperSpecificCredentials> {
  /** Internal OTP context token. */
  private _otpContext?: string;

  /** Bearer access token for API calls. */
  private _accessToken?: string;

  /**
   * Trigger two-factor auth by sending an OTP.
   * @param phoneNumber - Full international phone number.
   * @returns The trigger result.
   */
  public async triggerTwoFactorAuth(
    phoneNumber: string,
  ): Promise<ScraperTwoFactorAuthTriggerResult> {
    if (!phoneNumber.startsWith('+')) {
      return createGenericError('Full international phone number with + prefix required');
    }
    LOG.debug('Fetching device token');
    const deviceToken = await fetchDeviceToken();
    LOG.debug(`Sending OTP to phone number ${phoneNumber}`);
    this._otpContext = await sendOtp(phoneNumber, deviceToken);
    return { success: true };
  }

  /**
   * Verify OTP code and return a long-term token.
   * @param otpCode - The OTP code from the user.
   * @returns The long-term token result.
   */
  public async getLongTermTwoFactorToken(
    otpCode: string,
  ): Promise<ScraperGetLongTermTwoFactorTokenResult> {
    if (!this._otpContext) {
      return createGenericError('triggerOtp was not called');
    }
    LOG.debug('Requesting OTP token');
    const resp = await idPost<{ resultData: { otpToken: string } }>('otp/verify', {
      otpContext: this._otpContext,
      otpCode,
    });
    return {
      success: true,
      longTermTwoFactorAuthToken: resp.resultData.otpToken,
    };
  }

  /**
   * Login using email, password, and OTP.
   * @param credentials - The user credentials.
   * @returns The login result.
   */
  public async login(credentials: IScraperSpecificCredentials): Promise<IScraperLoginResult> {
    const otp = await this.resolveOtpToken(credentials);
    if (!otp.success) return otp;
    const token = otp.longTermTwoFactorAuthToken;
    LOG.debug('Requesting id token');
    const idTk = await getIdToken(token, credentials.email, credentials.password);
    LOG.debug('Requesting session token');
    this._accessToken = await getSessionToken(idTk, credentials.password);
    return { success: true, persistentOtpToken: token };
  }

  /**
   * Fetch transaction data for all portfolios.
   * @returns The scraping result with accounts.
   */
  public async fetchData(): Promise<IScraperScrapingResult> {
    if (!this._accessToken) {
      return createGenericError('login() was not called');
    }
    const defStart = moment().subtract(1, 'years').add(1, 'day');
    const optStart = moment(this.options.startDate);
    const startDate = moment.max(defStart, optStart).toDate();
    const portfolios = await this.fetchPortfolios();
    const actions = portfolios.map(
      (p): (() => Promise<ITransactionsAccount>) =>
        () =>
          this.fetchPortfolioMovements(p, startDate),
    );
    return { success: true, accounts: await runSerial(actions) };
  }

  /**
   * Build authorization headers for GraphQL requests.
   * @returns The authorization headers object.
   */
  private authHeaders(): Record<string, string> {
    return { authorization: `Bearer ${this._accessToken ?? ''}` };
  }

  /**
   * Resolve OTP token via user-supplied retriever.
   * @param creds - Credentials with retriever and phone.
   * @returns The long-term token result.
   */
  private async resolveOtpTokenViaRetriever(
    creds: IScraperSpecificCredentials & {
      otpCodeRetriever: () => Promise<string>;
      phoneNumber: string;
    },
  ): Promise<ScraperGetLongTermTwoFactorTokenResult> {
    LOG.debug('Triggering otpCodeRetriever callback');
    const trigger = await this.triggerTwoFactorAuth(creds.phoneNumber);
    if (!trigger.success) return trigger;
    const otpCode = await creds.otpCodeRetriever();
    return this.getLongTermTwoFactorToken(otpCode);
  }

  /**
   * Try resolving OTP from a stored long-term token.
   * @param creds - The user credentials.
   * @returns The token result if found, or false.
   */
  private static resolveStoredToken(
    creds: IScraperSpecificCredentials,
  ): ScraperGetLongTermTwoFactorTokenResult | false {
    if (!('otpLongTermToken' in creds)) return false;
    if (!creds.otpLongTermToken) {
      return createGenericError('Invalid otpLongTermToken');
    }
    return {
      success: true,
      longTermTwoFactorAuthToken: creds.otpLongTermToken,
    };
  }

  /**
   * Resolve OTP token from credentials.
   * @param creds - The user credentials.
   * @returns The long-term token result.
   */
  private async resolveOtpToken(
    creds: IScraperSpecificCredentials,
  ): Promise<ScraperGetLongTermTwoFactorTokenResult> {
    const stored = OneZeroScraper.resolveStoredToken(creds);
    if (stored !== false) return stored;
    if (!('otpCodeRetriever' in creds)) {
      return {
        success: false,
        errorType: ScraperErrorTypes.TwoFactorRetrieverMissing,
        errorMessage: 'otpLongTermToken or otpCodeRetriever required',
      };
    }
    if (!creds.phoneNumber) {
      return createGenericError('phoneNumber required with retriever');
    }
    return this.resolveOtpTokenViaRetriever(creds);
  }

  /**
   * Fetch a single page of movements from the GraphQL API.
   * @param portfolioId - The portfolio identifier.
   * @param accountId - The account identifier.
   * @param cursor - The pagination cursor or null.
   * @returns The movements and pagination info.
   */
  private async fetchMovementsPage(
    portfolioId: string,
    accountId: string,
    cursor: string | null,
  ): Promise<{ movements: IMovement[]; pagination: IQueryPagination }> {
    const variables = buildMovementsVariables(portfolioId, accountId, cursor ?? undefined);
    const resp = await fetchGraphql<{
      movements: { movements: IMovement[]; pagination: IQueryPagination };
    }>(GQL_URL, GET_MOVEMENTS, {
      variables,
      extraHeaders: this.authHeaders(),
    });
    return resp.movements;
  }

  /**
   * Fetch movements recursively until startDate is reached.
   * @param ctx - Portfolio, account, and date context.
   * @param state - Accumulated movements and cursor.
   * @returns The accumulated movements and done flag.
   */
  private async fetchMovementsRec(
    ctx: IMovementsFetchContext,
    state: IMovementsFetchState,
  ): Promise<{ movements: IMovement[]; done: boolean }> {
    const { portfolio, accountId, startDate } = ctx;
    LOG.debug(`Fetching txns for ${portfolio.portfolioNum}...`);
    const pg = await this.fetchMovementsPage(portfolio.portfolioId, accountId, state.cursor);
    const merged = [...pg.movements, ...state.accumulated];
    if (shouldStop(merged, pg.pagination.hasMore, startDate)) {
      return { movements: merged, done: !pg.pagination.hasMore };
    }
    const next = { accumulated: merged, cursor: pg.pagination.cursor };
    return this.fetchMovementsRec(ctx, next);
  }

  /**
   * Fetch all movements for a portfolio from the start date.
   * @param portfolio - The portfolio to fetch for.
   * @param accountId - The account identifier.
   * @param startDate - The start date threshold.
   * @returns The sorted movements array.
   */
  private async fetchAllMovements(
    portfolio: IPortfolio,
    accountId: string,
    startDate: Date,
  ): Promise<IMovement[]> {
    const ctx = { portfolio, accountId, startDate };
    const init = { accumulated: [] as IMovement[], cursor: null };
    const { movements } = await this.fetchMovementsRec(ctx, init);
    return sortByTimestamp(movements);
  }

  /**
   * Fetch current account balance with fallback.
   * @param portfolio - The portfolio to query.
   * @param accountId - The account identifier.
   * @param fb - The fallback balance value.
   * @returns The account balance.
   */
  private async fetchBalance(
    portfolio: IPortfolio,
    accountId: string,
    fb: number,
  ): Promise<number> {
    try {
      const vars = { portfolioId: portfolio.portfolioId, accountId };
      const resp: { balance: { currentAccountBalance: number } } = await fetchGraphql(
        GQL_URL,
        GET_ACCOUNT_BALANCE,
        { variables: vars, extraHeaders: this.authHeaders() },
      );
      return resp.balance.currentAccountBalance;
    } catch {
      LOG.debug('balance query failed — using fallback');
      return fb;
    }
  }

  /**
   * Fetch movements and balance for a single portfolio.
   * @param portfolio - The portfolio to process.
   * @param startDate - The start date threshold.
   * @returns The transactions account result.
   */
  private async fetchPortfolioMovements(
    portfolio: IPortfolio,
    startDate: Date,
  ): Promise<ITransactionsAccount> {
    const acct = portfolio.accounts[0];
    const mvs = await this.fetchAllMovements(portfolio, acct.accountId, startDate);
    const fb = fallbackBalance(mvs);
    const bal = await this.fetchBalance(portfolio, acct.accountId, fb);
    const matching = mvs.filter(m => new Date(m.movementTimestamp) >= startDate);
    const txns: ScrapingTransaction[] = matching.map(m => mapMovement(m, this.options));
    return { accountNumber: portfolio.portfolioNum, balance: bal, txns };
  }

  /**
   * Fetch the list of portfolios from the GraphQL API.
   * @returns The array of portfolios.
   */
  private async fetchPortfolios(): Promise<IPortfolio[]> {
    LOG.debug('Fetching account list');
    const resp = await fetchGraphql<{ customer: ICustomer[] }>(GQL_URL, GET_CUSTOMER, {
      extraHeaders: this.authHeaders(),
    });
    return resp.customer.flatMap(c => c.portfolios ?? []);
  }
}
