import moment from 'moment';

import { getDebug } from '../../Common/Debug';
import { fetchPostWithinPage } from '../../Common/Fetch';
import waitForPageStability from '../../Common/PageStability';
import { humanDelay } from '../../Common/Waiting';
import { CompanyTypes, ScraperProgressTypes } from '../../Definitions';
import { type Transaction } from '../../Transactions';
import { BaseScraperWithBrowser } from '../Base/BaseScraperWithBrowser';
import { ScraperErrorTypes, WafBlockError } from '../Base/Errors';
import { type ScraperOptions, type ScraperScrapingResult } from '../Base/Interface';
import { SCRAPER_CONFIGURATION } from '../Registry/ScraperConfig';
import { fetchAllTransactions } from './BaseIsracardAmexEnrich';
import { type ScrapedLoginValidation } from './BaseIsracardAmexTypes';

// Shared by both Amex and Isracard — identical values in both config entries
const {
  countryCode: COUNTRY_CODE,
  idType: ID_TYPE,
  checkLevel: CHECK_LEVEL,
} = SCRAPER_CONFIGURATION.banks[CompanyTypes.Amex].auth;
const { loginDelayMinMs: LOGIN_DELAY_MIN, loginDelayMaxMs: LOGIN_DELAY_MAX } =
  SCRAPER_CONFIGURATION.banks[CompanyTypes.Amex].timing;

const LOG = getDebug('base-isracard-amex');

/**
 * Builds the login POST body for the performLogonI endpoint.
 *
 * @param credentials - user card credentials
 * @param credentials.id - the user's national ID number
 * @param credentials.password - the user's bank password
 * @param credentials.card6Digits - the last 6 digits of the card number
 * @param userName - the userName returned by the ValidateIdData API
 * @returns a key-value map for the login POST request body
 */
function buildLoginRequest(
  credentials: { id: string; password: string; card6Digits: string },
  userName: string,
): Record<string, string> {
  return {
    KodMishtamesh: userName,
    MisparZihuy: credentials.id,
    Sisma: credentials.password,
    cardSuffix: credentials.card6Digits,
    countryCode: COUNTRY_CODE,
    idType: ID_TYPE,
  };
}

/** Base scraper shared by Amex and Isracard — uses API login with card validation. */
class IsracardAmexBaseScraper extends BaseScraperWithBrowser<{
  id: string;
  password: string;
  card6Digits: string;
}> {
  private _baseUrl: string;

  private _companyCode: string;

  private _servicesUrl: string;

  /**
   * Creates an IsracardAmexBaseScraper with the given API base URL and company code.
   *
   * @param options - scraper options including companyId, timeouts, and browser settings
   * @param baseUrl - the bank's API base URL (e.g. he.americanexpress.co.il)
   * @param companyCode - the bank-specific company code used in API requests
   */
  constructor(options: ScraperOptions, baseUrl: string, companyCode: string) {
    super(options);
    this._baseUrl = baseUrl;
    this._companyCode = companyCode;
    this._servicesUrl = `${baseUrl}/services/ProxyRequestHandler.ashx`;
  }

  /**
   * Performs API-based login via ValidateIdData → performLogonI flow.
   *
   * @param credentials - user card credentials
   * @param credentials.id - the user's national ID number
   * @param credentials.password - the user's bank password
   * @param credentials.card6Digits - the last 6 digits of the card number
   * @returns the login result (success or appropriate error type)
   */
  public async login(credentials: {
    id: string;
    password: string;
    card6Digits: string;
  }): Promise<ScraperScrapingResult> {
    this.setupResponseLogging();
    await this.navigateToLoginPage();
    await waitForPageStability(this.page);
    const validatedData = await this.validateCredentials(credentials);
    if (!validatedData) return await this.throwWafBlockError();
    const validateReturnCode = validatedData.returnCode;
    LOG.info(`user validate with return code '${validateReturnCode}'`);
    return validateReturnCode === '1'
      ? this.performLogin(credentials, validatedData.userName ?? '')
      : this.handleValidateReturnCode(validateReturnCode);
  }

  /**
   * Fetches all transaction data for the current user across all months.
   *
   * @returns a successful scraping result with all account transactions
   */
  public async fetchData(): Promise<{
    success: boolean;
    accounts: { accountNumber: string; txns: Transaction[] }[];
  }> {
    const defaultStartMoment = moment().subtract(1, 'years');
    const startDate = this.options.startDate;
    const startDateMoment = moment(startDate);
    const startMoment = moment.max(defaultStartMoment, startDateMoment);
    return fetchAllTransactions({
      page: this.page,
      options: this.options,
      companyServiceOptions: { servicesUrl: this._servicesUrl, companyCode: this._companyCode },
      startMoment,
    });
  }

  /**
   * Throws a WafBlockError when validateCredentials returns null (no response or no bean).
   * This indicates a true WAF/IP block, not an auth failure with wrong credentials.
   *
   * @returns a Promise that never resolves — always throws
   */
  private async throwWafBlockError(): Promise<never> {
    const currentPageUrl = this.page.url();
    throw WafBlockError.apiBlock(0, currentPageUrl, {
      pageTitle: await this.page.title(),
      responseSnippet: 'validateCredentials returned null',
    });
  }

  /**
   * Builds the validation POST body for the ValidateIdData endpoint.
   *
   * @param credentials - user card credentials
   * @param credentials.id - the user's national ID number
   * @param credentials.password - the user's bank password
   * @param credentials.card6Digits - the last 6 digits of the card number
   * @returns a key-value map for the validation POST request body
   */
  private buildValidateRequest(credentials: {
    id: string;
    password: string;
    card6Digits: string;
  }): Record<string, string> {
    return {
      id: credentials.id,
      cardSuffix: credentials.card6Digits,
      countryCode: COUNTRY_CODE,
      idType: ID_TYPE,
      checkLevel: CHECK_LEVEL,
      companyCode: this._companyCode,
    };
  }

  /**
   * Calls ValidateIdData API to verify card ownership and retrieve the userName.
   *
   * @param credentials - user card credentials
   * @param credentials.id - the user's national ID number
   * @param credentials.password - the user's bank password
   * @param credentials.card6Digits - the last 6 digits of the card number
   * @returns the ValidateIdDataBean (on success or auth error), or null for WAF/network blocks
   */
  private async validateCredentials(credentials: {
    id: string;
    password: string;
    card6Digits: string;
  }): Promise<ScrapedLoginValidation['ValidateIdDataBean'] | null> {
    const validateUrl = `${this._servicesUrl}?reqName=ValidateIdData`;
    LOG.info('validating credentials');
    const result = await fetchPostWithinPage<ScrapedLoginValidation>(this.page, validateUrl, {
      data: this.buildValidateRequest(credentials),
    });
    const resultSnippet = JSON.stringify(result).substring(0, 300);
    if (!result?.ValidateIdDataBean) {
      LOG.info('validation failed (no response): result=%s', resultSnippet);
      return null;
    }
    if (result.Header.Status !== '1')
      LOG.info('validation failed (auth error): result=%s', resultSnippet);
    return result.ValidateIdDataBean;
  }

  /**
   * Maps the performLogonI status code to a ScraperScrapingResult.
   *
   * @param status - the login status string ('1'=success, '3'=change password, other=failed)
   * @returns the appropriate scraping result
   */
  private interpretLoginStatus(status: string | undefined): ScraperScrapingResult {
    if (status === '1') {
      this.emitProgress(ScraperProgressTypes.LoginSuccess);
      return { success: true };
    }
    if (status === '3') {
      this.emitProgress(ScraperProgressTypes.ChangePassword);
      return { success: false, errorType: ScraperErrorTypes.ChangePassword };
    }
    this.emitProgress(ScraperProgressTypes.LoginFailed);
    return {
      success: false,
      errorType: ScraperErrorTypes.InvalidPassword,
      errorMessage: `Login failed with status: ${status ?? 'unknown'}`,
    };
  }

  /**
   * Sends the performLogonI login request and interprets the result.
   *
   * @param credentials - user card credentials
   * @param credentials.id - the user's national ID number
   * @param credentials.password - the user's bank password
   * @param credentials.card6Digits - the last 6 digits of the card number
   * @param userName - the userName returned by ValidateIdData
   * @returns the login result based on the API response status
   */
  private async performLogin(
    credentials: { id: string; password: string; card6Digits: string },
    userName: string,
  ): Promise<ScraperScrapingResult> {
    const loginUrl = `${this._servicesUrl}?reqName=performLogonI`;
    LOG.info('user login started');
    const loginResult = await fetchPostWithinPage<{ status: string }>(this.page, loginUrl, {
      data: buildLoginRequest(credentials, userName),
    });
    LOG.info(loginResult, `user login with status '${loginResult?.status ?? ''}'`);
    return this.interpretLoginStatus(loginResult?.status);
  }

  /**
   * Interprets a non-'1' ValidateIdData returnCode to a scraping error result.
   *
   * @param returnCode - the returnCode from ValidateIdDataBean ('4'=change password, other=invalid)
   * @returns the appropriate error scraping result
   */
  private handleValidateReturnCode(returnCode: string): ScraperScrapingResult {
    if (returnCode === '4') {
      this.emitProgress(ScraperProgressTypes.ChangePassword);
      return { success: false, errorType: ScraperErrorTypes.ChangePassword };
    }
    this.emitProgress(ScraperProgressTypes.LoginFailed);
    return {
      success: false,
      errorType: ScraperErrorTypes.InvalidPassword,
      errorMessage: `Validate failed with returnCode: ${returnCode}`,
    };
  }

  /**
   * Attaches a response listener that logs API proxy and personal area responses.
   */
  private setupResponseLogging(): void {
    this.page.on('response', response => {
      const url = response.url();
      if (url.includes('ProxyRequestHandler') || url.includes('personalarea')) {
        const responseStatus = response.status();
        const urlSnippet = url.substring(0, 120);
        LOG.info('response: %d %s', responseStatus, urlSnippet);
      }
    });
  }

  /**
   * Navigates to the bank's personal area login page and waits for it to be fully loaded.
   */
  private async navigateToLoginPage(): Promise<void> {
    LOG.info(`navigating to ${this._baseUrl}/personalarea/Login`);
    await this.navigateTo(`${this._baseUrl}/personalarea/Login`);
    await this.page.waitForFunction(() => document.readyState === 'complete');
    await humanDelay(LOGIN_DELAY_MIN, LOGIN_DELAY_MAX);
    this.emitProgress(ScraperProgressTypes.LoggingIn);
  }
}

export default IsracardAmexBaseScraper;
