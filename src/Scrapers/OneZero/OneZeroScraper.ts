import moment from 'moment';

import { getDebug } from '../../Common/Debug';
import { fetchGraphql, fetchPost } from '../../Common/Fetch';
import { getRawTransaction } from '../../Common/Transactions';
import {
  type Transaction as ScrapingTransaction,
  type TransactionsAccount,
  TransactionStatuses,
  TransactionTypes,
} from '../../Transactions';
import { BaseScraper } from '../Base/BaseScraper';
import { createGenericError, ScraperErrorTypes } from '../Base/Errors';
import {
  type ScraperGetLongTermTwoFactorTokenResult,
  type ScraperLoginResult,
  type ScraperScrapingResult,
  type ScraperTwoFactorAuthTriggerResult,
} from '../Base/Interface';
import { GET_ACCOUNT_BALANCE, GET_CUSTOMER, GET_MOVEMENTS } from './OneZeroQueries';
import {
  type Category,
  type Customer,
  type Movement,
  type Portfolio,
  type QueryPagination,
  type Recurrence,
  type ScraperSpecificCredentials,
} from './OneZeroTypes';

export type { Category, Recurrence };

const HEBREW_WORDS_REGEX = /[\u0590-\u05FF][\u0590-\u05FF"'\-_ /\\]*[\u0590-\u05FF]/g;

const LOG = getDebug('one-zero');

const IDENTITY_SERVER_URL = 'https://identity.tfd-bank.com/v1/';

const GRAPHQL_API_URL = 'https://mobile.tfd-bank.com/mobile-graph/graphql';

/**
 * Reverses specified character ranges within a string (used to fix RTL Hebrew order).
 *
 * @param plain - the text with LTR markers removed
 * @param ranges - the character ranges to reverse in the string
 * @returns the string with the specified ranges reversed
 */
function reverseHebrewRanges(plain: string, ranges: { start: number; end: number }[]): string {
  const out: string[] = [];
  let index = 0;
  for (const { start, end } of ranges) {
    const prefixSubstring = plain.substring(index, start);
    const prefixChars = Array.from(prefixSubstring);
    out.push(...prefixChars);
    index += start - index;
    const rangeSubstring = plain.substring(start, end);
    const rangeChars = Array.from(rangeSubstring).reverse();
    out.push(...rangeChars);
    index += end - start;
  }
  const remainingSubstring = plain.substring(index);
  const remainingChars = Array.from(remainingSubstring);
  out.push(...remainingChars);
  return out.join('');
}

/**
 * One Zero Hebrew strings are reversed with a LTR unicode control character.
 * Strip it and reverse Hebrew substrings back to natural order.
 *
 * @param text - the raw Hebrew string possibly containing LTR control characters
 * @returns the sanitized string with natural Hebrew word order
 */
function sanitizeHebrew(text: string): string {
  if (!text.includes('\u202d')) return text.trim();
  const plain = text.replace(/\u202d/gi, '').trim();
  const ranges = [...plain.matchAll(HEBREW_WORDS_REGEX)].map(m => ({
    start: m.index,
    end: m.index + m[0].length,
  }));
  return reverseHebrewRanges(plain, ranges);
}

/**
 * Fetches a OneZero device token for initiating OTP authentication.
 *
 * @returns the device token string
 */
async function fetchDeviceToken(): Promise<string> {
  const resp = await fetchPost<{ resultData: { deviceToken: string } }>(
    `${IDENTITY_SERVER_URL}/devices/token`,
    { extClientId: 'mobile', os: 'Android' },
  );
  return resp.resultData.deviceToken;
}

/**
 * Sends an OTP SMS to the phone number and returns the OTP context for verification.
 *
 * @param phoneNumber - the international phone number to send the OTP to
 * @param deviceToken - the device token from fetchDeviceToken
 * @returns the OTP context string needed for verification
 */
async function prepareOtp(phoneNumber: string, deviceToken: string): Promise<string> {
  const resp = await fetchPost<{ resultData: { otpContext: string } }>(
    `${IDENTITY_SERVER_URL}/otp/prepare`,
    { factorValue: phoneNumber, deviceToken, otpChannel: 'SMS_OTP' },
  );
  return resp.resultData.otpContext;
}

/**
 * Exchanges an OTP token, email, and password for a OneZero ID token.
 *
 * @param otpSmsToken - the long-term OTP token from OTP verification
 * @param email - the user's email address
 * @param pass - the user's password
 * @returns the ID token for creating a session
 */
async function getIdToken(otpSmsToken: string, email: string, pass: string): Promise<string> {
  const resp = await fetchPost<{ resultData: { idToken: string } }>(
    `${IDENTITY_SERVER_URL}/getIdToken`,
    { otpSmsToken, email, pass, pinCode: '' },
  );
  return resp.resultData.idToken;
}

/**
 * Exchanges an ID token and password for a session access token.
 *
 * @param idToken - the ID token from getIdToken
 * @param pass - the user's password
 * @returns the session access token for API authentication
 */
async function getSessionToken(idToken: string, pass: string): Promise<string> {
  const resp = await fetchPost<{ resultData: { accessToken: string } }>(
    `${IDENTITY_SERVER_URL}/sessions/token`,
    { idToken, pass },
  );
  return resp.resultData.accessToken;
}

/** Scraper for the OneZero digital bank, using GraphQL API with OTP authentication. */
export default class OneZeroScraper extends BaseScraper<ScraperSpecificCredentials> {
  private _otpContext?: string;

  private _accessToken?: string;

  /**
   * Sends an OTP SMS to the given phone number to initiate two-factor authentication.
   *
   * @param phoneNumber - the international phone number to send the OTP to (must start with '+')
   * @returns a trigger result (success or generic error for invalid number)
   */
  public async triggerTwoFactorAuth(
    phoneNumber: string,
  ): Promise<ScraperTwoFactorAuthTriggerResult> {
    if (!phoneNumber.startsWith('+')) {
      return createGenericError(
        'A full international phone number starting with + and a three digit country code is required',
      );
    }
    LOG.info('Fetching device token');
    const deviceToken = await fetchDeviceToken();
    LOG.info(`Sending OTP to phone number ${phoneNumber}`);
    this._otpContext = await prepareOtp(phoneNumber, deviceToken);
    return { success: true };
  }

  /**
   * Verifies the OTP code and exchanges it for a long-term two-factor token.
   *
   * @param otpCode - the one-time password received via SMS
   * @returns a result containing the long-term OTP token for future logins
   */
  public async getLongTermTwoFactorToken(
    otpCode: string,
  ): Promise<ScraperGetLongTermTwoFactorTokenResult> {
    if (!this._otpContext) {
      return createGenericError('triggerOtp was not called before calling getPermenantOtpToken()');
    }

    LOG.info('Requesting OTP token');
    const otpVerifyResponse = await fetchPost<{ resultData: { otpToken: string } }>(
      `${IDENTITY_SERVER_URL}/otp/verify`,
      {
        otpContext: this._otpContext,
        otpCode,
      },
    );

    const {
      resultData: { otpToken },
    } = otpVerifyResponse;
    return { success: true, longTermTwoFactorAuthToken: otpToken };
  }

  /**
   * Authenticates the user using OTP token or retriever, then creates a session.
   *
   * @param credentials - OneZero credentials with email, password, and OTP token or retriever
   * @returns the login result with a persistent OTP token for future sessions
   */
  public async login(credentials: ScraperSpecificCredentials): Promise<ScraperLoginResult> {
    const otpTokenResult = await this.resolveOtpToken(credentials);
    if (!otpTokenResult.success) return otpTokenResult;
    LOG.info('Requesting id token');
    const idToken = await getIdToken(
      otpTokenResult.longTermTwoFactorAuthToken,
      credentials.email,
      credentials.password,
    );
    LOG.info('Requesting session token');
    this._accessToken = await getSessionToken(idToken, credentials.password);
    return { success: true, persistentOtpToken: otpTokenResult.longTermTwoFactorAuthToken };
  }

  /**
   * Fetches all portfolio movements from the OneZero GraphQL API.
   *
   * @returns a successful scraping result with all account movements
   */
  public async fetchData(): Promise<ScraperScrapingResult> {
    if (!this._accessToken) return createGenericError('login() was not called');
    const defaultStartMoment = moment().subtract(1, 'years').add(1, 'day');
    const optionsStartMoment = moment(this.options.startDate);
    const startMoment = moment.max(defaultStartMoment, optionsStartMoment);
    const startDate = startMoment.toDate();
    const portfolios = await this.fetchPortfolios();
    const portfolioPromises = portfolios.map(portfolio =>
      this.fetchPortfolioMovements(portfolio, startDate),
    );
    return {
      success: true,
      accounts: await Promise.all(portfolioPromises),
    };
  }

  /**
   * Uses the otpCodeRetriever callback to obtain an OTP code and exchange it for a long-term token.
   *
   * @param credentials - credentials with otpCodeRetriever callback and phoneNumber
   * @returns a result with the long-term OTP token
   */
  private async resolveOtpTokenViaRetriever(
    credentials: ScraperSpecificCredentials & {
      otpCodeRetriever: () => Promise<string>;
      phoneNumber: string;
    },
  ): Promise<ScraperGetLongTermTwoFactorTokenResult> {
    LOG.info('Triggering user supplied otpCodeRetriever callback');
    const triggerResult = await this.triggerTwoFactorAuth(credentials.phoneNumber);
    if (!triggerResult.success) return triggerResult;
    const otpCode = await credentials.otpCodeRetriever();
    const otpTokenResult = await this.getLongTermTwoFactorToken(otpCode);
    if (!otpTokenResult.success) return otpTokenResult;
    return { success: true, longTermTwoFactorAuthToken: otpTokenResult.longTermTwoFactorAuthToken };
  }

  /**
   * Resolves the OTP token from either a stored long-term token or the otpCodeRetriever callback.
   *
   * @param credentials - OneZero credentials containing either a long-term token or a retriever
   * @returns a result with the long-term OTP token or an error
   */
  private async resolveOtpToken(
    credentials: ScraperSpecificCredentials,
  ): Promise<ScraperGetLongTermTwoFactorTokenResult> {
    if ('otpLongTermToken' in credentials) {
      if (!credentials.otpLongTermToken) return createGenericError('Invalid otpLongTermToken');
      return { success: true, longTermTwoFactorAuthToken: credentials.otpLongTermToken };
    }
    if (!('otpCodeRetriever' in credentials)) {
      return {
        success: false,
        errorType: ScraperErrorTypes.TwoFactorRetrieverMissing,
        errorMessage: 'otpLongTermToken or otpCodeRetriever is required',
      };
    }
    if (!credentials.phoneNumber)
      return createGenericError(
        'phoneNumber is required when providing a otpCodeRetriever callback',
      );
    return this.resolveOtpTokenViaRetriever(credentials);
  }

  /**
   * Fetches a single page of movements from the GraphQL API.
   *
   * @param portfolioId - the portfolio ID to fetch movements for
   * @param accountId - the account ID within the portfolio
   * @param cursor - pagination cursor (null for first page)
   * @returns movements and pagination info for the current page
   */
  private async fetchMovementsPage(
    portfolioId: string,
    accountId: string,
    cursor: string | null,
  ): Promise<{ movements: Movement[]; pagination: QueryPagination }> {
    const { movements } = await fetchGraphql<{
      movements: { movements: Movement[]; pagination: QueryPagination };
    }>(GRAPHQL_API_URL, GET_MOVEMENTS, {
      variables: { portfolioId, accountId, language: 'HEBREW', pagination: { cursor, limit: 50 } },
      extraHeaders: { authorization: `Bearer ${this._accessToken ?? ''}` },
    });
    return movements;
  }

  /**
   * Fetches movements until reaching the start date, paginating as needed.
   *
   * @param portfolio - the portfolio to fetch movements for
   * @param accountId - the account ID within the portfolio
   * @param startDate - the earliest date to fetch movements from
   * @returns all movements up to the start date and a done flag
   */
  private async fetchMovementsUntilStart(
    portfolio: Portfolio,
    accountId: string,
    startDate: Date,
  ): Promise<{ movements: Movement[]; done: boolean }> {
    return this.accumulateMovements(
      { portfolio, accountId, startDate },
      { accumulated: [], cursor: null },
    );
  }

  /**
   * Recursively accumulates movements across pages until the start date is reached.
   *
   * @param ctx - context with portfolio, account ID, and start date
   * @param ctx.portfolio - the portfolio to fetch movements for
   * @param ctx.accountId - the account ID within the portfolio
   * @param ctx.startDate - the earliest date to include movements from
   * @param state - accumulated movements and current pagination cursor
   * @param state.accumulated - movements collected so far
   * @param state.cursor - the current pagination cursor
   * @returns all accumulated movements and whether all pages were consumed
   */
  private async accumulateMovements(
    ctx: { portfolio: Portfolio; accountId: string; startDate: Date },
    state: { accumulated: Movement[]; cursor: string | null },
  ): Promise<{ movements: Movement[]; done: boolean }> {
    LOG.info(`Fetching transactions for account ${ctx.portfolio.portfolioNum}...`);
    const { movements: newMovements, pagination } = await this.fetchMovementsPage(
      ctx.portfolio.portfolioId,
      ctx.accountId,
      state.cursor,
    );
    const result = [...newMovements, ...state.accumulated];
    if (!pagination.hasMore) return { movements: result, done: true };
    const isReachedStart =
      result.length > 0 && new Date(result[0].movementTimestamp) < ctx.startDate;
    if (isReachedStart) return { movements: result, done: false };
    return this.accumulateMovements(ctx, { accumulated: result, cursor: pagination.cursor });
  }

  /**
   * Fetches all movements for an account from the start date, sorted by date ascending.
   *
   * @param portfolio - the portfolio to fetch movements for
   * @param accountId - the account ID within the portfolio
   * @param startDate - the earliest date to include movements from
   * @returns sorted array of all movements
   */
  private async fetchAllMovements(
    portfolio: Portfolio,
    accountId: string,
    startDate: Date,
  ): Promise<Movement[]> {
    const { movements } = await this.fetchMovementsUntilStart(portfolio, accountId, startDate);
    movements.sort(
      (x, y) => new Date(x.movementTimestamp).valueOf() - new Date(y.movementTimestamp).valueOf(),
    );
    return movements;
  }

  /**
   * Fetches the current account balance, falling back to the last movement's running balance.
   *
   * @param portfolio - the portfolio containing the account
   * @param accountId - the account ID to fetch the balance for
   * @param fallback - fallback balance value if the API call fails
   * @returns the current account balance
   */
  private async fetchBalance(
    portfolio: Portfolio,
    accountId: string,
    fallback: number,
  ): Promise<number> {
    try {
      const { balance: accountBalance }: { balance: { currentAccountBalance: number } } =
        await fetchGraphql(GRAPHQL_API_URL, GET_ACCOUNT_BALANCE, {
          variables: { portfolioId: portfolio.portfolioId, accountId },
          extraHeaders: { authorization: `Bearer ${this._accessToken ?? ''}` },
        });
      return accountBalance.currentAccountBalance;
    } catch {
      LOG.info('balance query failed — falling back to runningBalance of last movement');
      return fallback;
    }
  }

  /**
   * Converts a OneZero movement to a normalized Transaction object.
   *
   * @param movement - the raw movement from the GraphQL API
   * @returns a normalized ScrapingTransaction
   */
  private mapMovement(movement: Movement): ScrapingTransaction {
    const hasInstallments = movement.transaction?.enrichment?.recurrences?.some(x => x.isRecurrent);
    const modifier = movement.creditDebit === 'DEBIT' ? -1 : 1;
    const result: ScrapingTransaction = {
      identifier: movement.movementId,
      date: movement.valueDate,
      chargedAmount: +movement.movementAmount * modifier,
      chargedCurrency: movement.movementCurrency,
      originalAmount: +movement.movementAmount * modifier,
      originalCurrency: movement.movementCurrency,
      description: sanitizeHebrew(movement.description),
      processedDate: movement.movementTimestamp,
      status: TransactionStatuses.Completed,
      type: hasInstallments ? TransactionTypes.Installments : TransactionTypes.Normal,
    };
    if (this.options.includeRawTransaction) result.rawTransaction = getRawTransaction(movement);
    return result;
  }

  /**
   * Fetches all movements for a portfolio and returns the account with balance and transactions.
   *
   * @param portfolio - the portfolio to fetch movements for
   * @param startDate - the earliest date to include movements from
   * @returns a TransactionsAccount with account number, balance, and transactions
   */
  private async fetchPortfolioMovements(
    portfolio: Portfolio,
    startDate: Date,
  ): Promise<TransactionsAccount> {
    const account = portfolio.accounts[0];
    const movements = await this.fetchAllMovements(portfolio, account.accountId, startDate);
    const fallbackBalance = !movements.length
      ? 0
      : parseFloat(movements[movements.length - 1].runningBalance);
    const balance = await this.fetchBalance(portfolio, account.accountId, fallbackBalance);
    const matchingMovements = movements.filter(
      movement => new Date(movement.movementTimestamp) >= startDate,
    );
    return {
      accountNumber: portfolio.portfolioNum,
      balance,
      txns: matchingMovements.map(m => this.mapMovement(m)),
    };
  }

  /**
   * Fetches all portfolios for the authenticated OneZero user.
   *
   * @returns an array of portfolios for the user
   */
  private async fetchPortfolios(): Promise<Portfolio[]> {
    LOG.info('Fetching account list');
    const result = await fetchGraphql<{ customer: Customer[] }>(GRAPHQL_API_URL, GET_CUSTOMER, {
      extraHeaders: { authorization: `Bearer ${this._accessToken ?? ''}` },
    });
    return result.customer.flatMap(customer => customer.portfolios ?? []);
  }
}
