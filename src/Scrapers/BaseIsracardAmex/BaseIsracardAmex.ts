import moment from 'moment';

import { getDebug } from '../../Common/Debug';
import { fetchPostWithinPage } from '../../Common/Fetch';
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

class IsracardAmexBaseScraper extends BaseScraperWithBrowser<{
  id: string;
  password: string;
  card6Digits: string;
}> {
  private _baseUrl: string;

  private _companyCode: string;

  private _servicesUrl: string;

  constructor(options: ScraperOptions, baseUrl: string, companyCode: string) {
    super(options);
    this._baseUrl = baseUrl;
    this._companyCode = companyCode;
    this._servicesUrl = `${baseUrl}/services/ProxyRequestHandler.ashx`;
  }

  public async login(credentials: {
    id: string;
    password: string;
    card6Digits: string;
  }): Promise<ScraperScrapingResult> {
    this.setupResponseLogging();
    await this.navigateToLoginPage();
    const validatedData = await this.validateCredentials(credentials);
    if (!validatedData) {
      throw WafBlockError.apiBlock(0, this.page.url(), {
        pageTitle: await this.page.title(),
        responseSnippet: 'validateCredentials returned null',
      });
    }
    const validateReturnCode = validatedData.returnCode;
    LOG.info(`user validate with return code '${validateReturnCode}'`);
    return validateReturnCode === '1'
      ? this.performLogin(credentials, validatedData.userName ?? '')
      : this.handleValidateReturnCode(validateReturnCode);
  }

  public async fetchData(): Promise<{
    success: boolean;
    accounts: { accountNumber: string; txns: Transaction[] }[];
  }> {
    const defaultStartMoment = moment().subtract(1, 'years');
    const startDate = this.options.startDate;
    const startMoment = moment.max(defaultStartMoment, moment(startDate));
    return fetchAllTransactions({
      page: this.page,
      options: this.options,
      companyServiceOptions: { servicesUrl: this._servicesUrl, companyCode: this._companyCode },
      startMoment,
    });
  }

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
    if (result?.Header.Status !== '1' || !result.ValidateIdDataBean) {
      LOG.info('validation failed: result=%s', JSON.stringify(result).substring(0, 300));
      return null;
    }
    return result.ValidateIdDataBean;
  }

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

  private setupResponseLogging(): void {
    this.page.on('response', response => {
      const url = response.url();
      if (url.includes('ProxyRequestHandler') || url.includes('personalarea'))
        LOG.info('response: %d %s', response.status(), url.substring(0, 120));
    });
  }

  private async navigateToLoginPage(): Promise<void> {
    LOG.info(`navigating to ${this._baseUrl}/personalarea/Login`);
    await this.navigateTo(`${this._baseUrl}/personalarea/Login`);
    await this.page.waitForFunction(() => document.readyState === 'complete');
    await humanDelay(LOGIN_DELAY_MIN, LOGIN_DELAY_MAX);
    this.emitProgress(ScraperProgressTypes.LoggingIn);
  }
}

export default IsracardAmexBaseScraper;
