import moment from 'moment';

import { getDebug } from '../../Common/Debug.js';
import { fetchPostWithinPage } from '../../Common/Fetch.js';
import { humanDelay } from '../../Common/Waiting.js';
import { CompanyTypes, ScraperProgressTypes } from '../../Definitions.js';
import { type ITransaction } from '../../Transactions.js';
import { BaseScraperWithBrowser } from '../Base/BaseScraperWithBrowser.js';
import { ScraperErrorTypes, WafBlockError } from '../Base/Errors.js';
import { type IScraperScrapingResult, type ScraperOptions } from '../Base/Interface.js';
import { SCRAPER_CONFIGURATION } from '../Registry/ScraperConfig.js';
import { fetchAllTransactions } from './BaseIsracardAmexEnrich.js';
import { type IScrapedLoginValidation } from './BaseIsracardAmexTypes.js';

// Shared by both Amex and Isracard — identical values in both config entries
const {
  countryCode: COUNTRY_CODE,
  idType: ID_TYPE,
  checkLevel: CHECK_LEVEL,
} = SCRAPER_CONFIGURATION.banks[CompanyTypes.Amex].auth;
const { loginDelayMinMs: LOGIN_DELAY_MIN, loginDelayMaxMs: LOGIN_DELAY_MAX } =
  SCRAPER_CONFIGURATION.banks[CompanyTypes.Amex].timing;

const LOG = getDebug('base-isracard-amex');

interface IScraperSpecificCredentials {
  id: string;
  password: string;
  card6Digits: string;
}

type ValidatedBean = NonNullable<IScrapedLoginValidation['ValidateIdDataBean']>;

/** Shared scraper base for Amex and Isracard credit-card portals. */
class IsracardAmexBaseScraper extends BaseScraperWithBrowser<IScraperSpecificCredentials> {
  private _baseUrl: string;

  private _companyCode: string;

  private _servicesUrl: string;

  /**
   * Create a new IsracardAmex scraper with portal-specific config.
   * @param options - scraper options
   * @param baseUrl - portal base URL
   * @param companyCode - portal company code
   */
  constructor(options: ScraperOptions, baseUrl: string, companyCode: string) {
    super(options);
    this._baseUrl = baseUrl;
    this._companyCode = companyCode;
    this._servicesUrl = `${baseUrl}/services/ProxyRequestHandler.ashx`;
  }

  /**
   * Validate credentials against the portal and perform login.
   * @param credentials - user credentials
   * @returns scraping result indicating success or failure reason
   */
  public async login(credentials: IScraperSpecificCredentials): Promise<IScraperScrapingResult> {
    this.setupResponseLogging();
    await this.navigateToLoginPage();
    const validatedData = await this.validateCredentials(credentials);
    const validateReturnCode = validatedData.returnCode;
    LOG.debug(`user validate with return code '${validateReturnCode}'`);
    return validateReturnCode === '1'
      ? this.performLogin(credentials, validatedData.userName ?? '')
      : this.handleValidateReturnCode(validateReturnCode);
  }

  /**
   * Fetch all transaction data across accounts and months.
   * @returns aggregated account transactions
   */
  public async fetchData(): Promise<{
    success: boolean;
    accounts: { accountNumber: string; txns: ITransaction[] }[];
  }> {
    const defaultStartMoment = moment().subtract(1, 'years');
    const startDateMoment = moment(this.options.startDate);
    const startMoment = moment.max(defaultStartMoment, startDateMoment);
    return fetchAllTransactions({
      page: this.page,
      options: this.options,
      companyServiceOptions: { servicesUrl: this._servicesUrl, companyCode: this._companyCode },
      startMoment,
    });
  }

  /**
   * Build the credential-validation request payload.
   * @param credentials - user credentials
   * @param companyCode - portal company code
   * @returns key-value request body
   */
  private static buildValidateRequest(
    credentials: IScraperSpecificCredentials,
    companyCode: string,
  ): Record<string, string> {
    return {
      id: credentials.id,
      cardSuffix: credentials.card6Digits,
      countryCode: COUNTRY_CODE,
      idType: ID_TYPE,
      checkLevel: CHECK_LEVEL,
      companyCode,
    };
  }

  /**
   * Throw a WafBlockError with page context for validation failures.
   * @param result - raw portal response for debug logging
   */
  private async throwValidationError(result: IScrapedLoginValidation | null): Promise<never> {
    const snippet = JSON.stringify(result).substring(0, 300);
    LOG.debug('validation failed: result=%s', snippet);
    const currentUrl = this.page.url();
    const pageTitle = await this.page.title();
    throw WafBlockError.apiBlock(0, currentUrl, {
      pageTitle,
      responseSnippet: 'validateCredentials returned empty result',
    });
  }

  /**
   * Send credential validation request; throws WafBlockError on failure.
   * @param credentials - user credentials
   * @returns validated data bean from the portal
   */
  private async validateCredentials(
    credentials: IScraperSpecificCredentials,
  ): Promise<ValidatedBean> {
    const validateUrl = `${this._servicesUrl}?reqName=ValidateIdData`;
    LOG.debug('validating credentials');
    const validateRequest = IsracardAmexBaseScraper.buildValidateRequest(
      credentials,
      this._companyCode,
    );
    const result = await fetchPostWithinPage<IScrapedLoginValidation>(this.page, validateUrl, {
      data: validateRequest,
    });
    if (result?.Header.Status !== '1' || !result.ValidateIdDataBean) {
      return this.throwValidationError(result);
    }
    return result.ValidateIdDataBean;
  }

  /**
   * Build the login request payload from credentials and validated username.
   * @param credentials - user credentials
   * @param userName - validated username from the portal
   * @returns key-value request body
   */
  private static buildLoginRequest(
    credentials: IScraperSpecificCredentials,
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

  /**
   * Map the login status code to a scraping result.
   * @param status - login status from the portal
   * @returns scraping result with success/failure info
   */
  private interpretLoginStatus(status: string | undefined): IScraperScrapingResult {
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
   * Execute the login API call after successful credential validation.
   * @param credentials - user credentials
   * @param userName - validated username
   * @returns scraping result indicating login outcome
   */
  private async performLogin(
    credentials: IScraperSpecificCredentials,
    userName: string,
  ): Promise<IScraperScrapingResult> {
    const loginUrl = `${this._servicesUrl}?reqName=performLogonI`;
    LOG.debug('user login started');
    const loginRequest = IsracardAmexBaseScraper.buildLoginRequest(credentials, userName);
    const loginResult = await fetchPostWithinPage<{ status: string }>(this.page, loginUrl, {
      data: loginRequest,
    });
    const loginStatus = loginResult?.status;
    LOG.debug(loginResult, `user login with status '${loginStatus ?? 'null'}'`);
    return this.interpretLoginStatus(loginStatus);
  }

  /**
   * Handle non-success return codes from credential validation.
   * @param returnCode - validation return code
   * @returns scraping result with appropriate error type
   */
  private handleValidateReturnCode(returnCode: string): IScraperScrapingResult {
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

  /** Attach response logging for proxy and personal-area endpoints. */
  private setupResponseLogging(): void {
    this.page.on('response', response => {
      const url = response.url();
      const statusCode = response.status();
      const truncatedUrl = url.substring(0, 120);
      if (url.includes('ProxyRequestHandler') || url.includes('personalarea'))
        LOG.debug('response: %d %s', statusCode, truncatedUrl);
    });
  }

  /** Navigate to the Isracard/Amex login page and wait for readiness. */
  private async navigateToLoginPage(): Promise<void> {
    LOG.debug(`navigating to ${this._baseUrl}/personalarea/Login`);
    await this.navigateTo(`${this._baseUrl}/personalarea/Login`);
    await this.page.waitForFunction(() => document.readyState === 'complete');
    await humanDelay(LOGIN_DELAY_MIN, LOGIN_DELAY_MAX);
    this.emitProgress(ScraperProgressTypes.LoggingIn);
  }
}

export default IsracardAmexBaseScraper;
