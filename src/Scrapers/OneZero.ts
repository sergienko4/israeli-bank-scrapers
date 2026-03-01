import moment from 'moment/moment';
import { getDebug } from '../Helpers/Debug';
import { fetchGraphql, fetchPost } from '../Helpers/Fetch';
import { getRawTransaction } from '../Helpers/Transactions';
import {
  type Transaction as ScrapingTransaction,
  TransactionStatuses,
  TransactionTypes,
  type TransactionsAccount,
} from '../Transactions';
import { BaseScraper } from './BaseScraper';
import { ScraperErrorTypes, createGenericError } from './Errors';
import {
  type ScraperGetLongTermTwoFactorTokenResult,
  type ScraperLoginResult,
  type ScraperScrapingResult,
  type ScraperTwoFactorAuthTriggerResult,
} from './Interface';
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

const DEBUG = getDebug('one-zero');

const IDENTITY_SERVER_URL = 'https://identity.tfd-bank.com/v1/';

const GRAPHQL_API_URL = 'https://mobile.tfd-bank.com/mobile-graph/graphql';

function reverseHebrewRanges(plain: string, ranges: { start: number; end: number }[]): string {
  const out: string[] = [];
  let index = 0;
  for (const { start, end } of ranges) {
    out.push(...plain.substring(index, start));
    index += start - index;
    out.push(...[...plain.substring(start, end)].reverse());
    index += end - start;
  }
  out.push(...plain.substring(index));
  return out.join('');
}

/**
 * One Zero Hebrew strings are reversed with a LTR unicode control character.
 * Strip it and reverse Hebrew substrings back to natural order.
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

export default class OneZeroScraper extends BaseScraper<ScraperSpecificCredentials> {
  private otpContext?: string;

  private accessToken?: string;

  async triggerTwoFactorAuth(phoneNumber: string): Promise<ScraperTwoFactorAuthTriggerResult> {
    if (!phoneNumber.startsWith('+')) {
      return createGenericError(
        'A full international phone number starting with + and a three digit country code is required',
      );
    }
    DEBUG('Fetching device token');
    const deviceToken = await this.fetchDeviceToken();
    DEBUG(`Sending OTP to phone number ${phoneNumber}`);
    this.otpContext = await this.prepareOtp(phoneNumber, deviceToken);
    return { success: true };
  }

  public async getLongTermTwoFactorToken(
    otpCode: string,
  ): Promise<ScraperGetLongTermTwoFactorTokenResult> {
    if (!this.otpContext) {
      return createGenericError('triggerOtp was not called before calling getPermenantOtpToken()');
    }

    DEBUG('Requesting OTP token');
    const otpVerifyResponse = await fetchPost<{ resultData: { otpToken: string } }>(
      `${IDENTITY_SERVER_URL}/otp/verify`,
      {
        otpContext: this.otpContext,
        otpCode,
      },
    );

    const {
      resultData: { otpToken },
    } = otpVerifyResponse;
    return { success: true, longTermTwoFactorAuthToken: otpToken };
  }

  async login(credentials: ScraperSpecificCredentials): Promise<ScraperLoginResult> {
    const otpTokenResult = await this.resolveOtpToken(credentials);
    if (!otpTokenResult.success) return otpTokenResult;
    DEBUG('Requesting id token');
    const idToken = await this.getIdToken(
      otpTokenResult.longTermTwoFactorAuthToken,
      credentials.email,
      credentials.password,
    );
    DEBUG('Requesting session token');
    this.accessToken = await this.getSessionToken(idToken, credentials.password);
    return { success: true, persistentOtpToken: otpTokenResult.longTermTwoFactorAuthToken };
  }

  async fetchData(): Promise<ScraperScrapingResult> {
    if (!this.accessToken) return createGenericError('login() was not called');
    const defaultStartMoment = moment().subtract(1, 'years').add(1, 'day');
    const startMoment = moment.max(
      defaultStartMoment,
      moment(this.options.startDate || defaultStartMoment.toDate()),
    );
    const portfolios = await this.fetchPortfolios();
    return {
      success: true,
      accounts: await Promise.all(
        portfolios.map(portfolio => this.fetchPortfolioMovements(portfolio, startMoment.toDate())),
      ),
    };
  }

  private async fetchDeviceToken(): Promise<string> {
    const resp = await fetchPost<{ resultData: { deviceToken: string } }>(
      `${IDENTITY_SERVER_URL}/devices/token`,
      {
        extClientId: 'mobile',
        os: 'Android',
      },
    );
    return resp.resultData.deviceToken;
  }

  private async prepareOtp(phoneNumber: string, deviceToken: string): Promise<string> {
    const resp = await fetchPost<{ resultData: { otpContext: string } }>(
      `${IDENTITY_SERVER_URL}/otp/prepare`,
      {
        factorValue: phoneNumber,
        deviceToken,
        otpChannel: 'SMS_OTP',
      },
    );
    return resp.resultData.otpContext;
  }

  private async resolveOtpTokenViaRetriever(
    credentials: ScraperSpecificCredentials & {
      otpCodeRetriever: () => Promise<string>;
      phoneNumber: string;
    },
  ): Promise<ScraperGetLongTermTwoFactorTokenResult> {
    DEBUG('Triggering user supplied otpCodeRetriever callback');
    const triggerResult = await this.triggerTwoFactorAuth(credentials.phoneNumber);
    if (!triggerResult.success) return triggerResult;
    const otpCode = await credentials.otpCodeRetriever();
    const otpTokenResult = await this.getLongTermTwoFactorToken(otpCode);
    if (!otpTokenResult.success) return otpTokenResult;
    return { success: true, longTermTwoFactorAuthToken: otpTokenResult.longTermTwoFactorAuthToken };
  }

  private async resolveOtpToken(
    credentials: ScraperSpecificCredentials,
  ): Promise<ScraperGetLongTermTwoFactorTokenResult> {
    if ('otpLongTermToken' in credentials) {
      if (!credentials.otpLongTermToken) return createGenericError('Invalid otpLongTermToken');
      return { success: true, longTermTwoFactorAuthToken: credentials.otpLongTermToken };
    }
    if (!credentials.otpCodeRetriever)
      return {
        success: false,
        errorType: ScraperErrorTypes.TwoFactorRetrieverMissing,
        errorMessage: 'otpCodeRetriever is required when otpPermanentToken is not provided',
      };
    if (!credentials.phoneNumber)
      return createGenericError(
        'phoneNumber is required when providing a otpCodeRetriever callback',
      );
    return this.resolveOtpTokenViaRetriever(credentials);
  }

  private async getIdToken(otpSmsToken: string, email: string, pass: string): Promise<string> {
    const resp = await fetchPost<{ resultData: { idToken: string } }>(
      `${IDENTITY_SERVER_URL}/getIdToken`,
      {
        otpSmsToken,
        email,
        pass,
        pinCode: '',
      },
    );
    return resp.resultData.idToken;
  }

  private async getSessionToken(idToken: string, pass: string): Promise<string> {
    const resp = await fetchPost<{ resultData: { accessToken: string } }>(
      `${IDENTITY_SERVER_URL}/sessions/token`,
      {
        idToken,
        pass,
      },
    );
    return resp.resultData.accessToken;
  }

  private async fetchMovementsPage(
    portfolioId: string,
    accountId: string,
    cursor: string | null,
  ): Promise<{ movements: Movement[]; pagination: QueryPagination }> {
    const { movements } = await fetchGraphql<{
      movements: { movements: Movement[]; pagination: QueryPagination };
    }>(GRAPHQL_API_URL, GET_MOVEMENTS, {
      variables: { portfolioId, accountId, language: 'HEBREW', pagination: { cursor, limit: 50 } },
      extraHeaders: { authorization: `Bearer ${this.accessToken}` },
    });
    return movements;
  }

  private async fetchMovementsUntilStart(
    portfolio: Portfolio,
    accountId: string,
    startDate: Date,
  ): Promise<{ movements: Movement[]; done: boolean }> {
    const result: Movement[] = [];
    let cursor: string | null = null;
    while (!result.length || new Date(result[0].movementTimestamp) >= startDate) {
      DEBUG(`Fetching transactions for account ${portfolio.portfolioNum}...`);
      const { movements: newMovements, pagination } = await this.fetchMovementsPage(
        portfolio.portfolioId,
        accountId,
        cursor,
      );
      result.unshift(...newMovements);
      cursor = pagination.cursor;
      if (!pagination.hasMore) return { movements: result, done: true };
    }
    return { movements: result, done: false };
  }

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

  private async fetchBalance(
    portfolio: Portfolio,
    accountId: string,
    fallback: number,
  ): Promise<number> {
    try {
      const { balance: accountBalance }: { balance: { currentAccountBalance: number } } =
        await fetchGraphql(GRAPHQL_API_URL, GET_ACCOUNT_BALANCE, {
          variables: { portfolioId: portfolio.portfolioId, accountId },
          extraHeaders: { authorization: `Bearer ${this.accessToken}` },
        });
      return accountBalance.currentAccountBalance;
    } catch {
      DEBUG('balance query failed — falling back to runningBalance of last movement');
      return fallback;
    }
  }

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
    if (this.options?.includeRawTransaction) result.rawTransaction = getRawTransaction(movement);
    return result;
  }

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

  private async fetchPortfolios(): Promise<Portfolio[]> {
    DEBUG('Fetching account list');
    const result = await fetchGraphql<{ customer: Customer[] }>(GRAPHQL_API_URL, GET_CUSTOMER, {
      extraHeaders: { authorization: `Bearer ${this.accessToken}` },
    });
    return result.customer.flatMap(customer => customer.portfolios || []);
  }
}
