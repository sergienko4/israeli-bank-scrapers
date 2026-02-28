import moment from 'moment';
import { ScraperProgressTypes } from '../definitions';
import { getDebug } from '../helpers/debug';
import { fetchPostWithinPage } from '../helpers/fetch';
import { humanDelay } from '../helpers/waiting';
import { type Transaction } from '../transactions';
import { BaseScraperWithBrowser } from './base-scraper-with-browser';
import { ScraperErrorTypes, WafBlockError } from './errors';
import { type ScraperOptions, type ScraperScrapingResult } from './interface';
import { type ScrapedLoginValidation } from './base-isracard-amex-types';
import { fetchAllTransactions } from './base-isracard-amex-transactions';

const COUNTRY_CODE = '212';
const ID_TYPE = '1';

const debug = getDebug('base-isracard-amex');

type ScraperSpecificCredentials = { id: string; password: string; card6Digits: string };

class IsracardAmexBaseScraper extends BaseScraperWithBrowser<ScraperSpecificCredentials> {
  private baseUrl: string;

  private companyCode: string;

  private servicesUrl: string;

  constructor(options: ScraperOptions, baseUrl: string, companyCode: string) {
    super(options);
    this.baseUrl = baseUrl;
    this.companyCode = companyCode;
    this.servicesUrl = `${baseUrl}/services/ProxyRequestHandler.ashx`;
  }

  private async validateCredentials(
    credentials: ScraperSpecificCredentials,
  ): Promise<ScrapedLoginValidation['ValidateIdDataBean'] | null> {
    const validateUrl = `${this.servicesUrl}?reqName=ValidateIdData`;
    const validateRequest = {
      id: credentials.id,
      cardSuffix: credentials.card6Digits,
      countryCode: COUNTRY_CODE,
      idType: ID_TYPE,
      checkLevel: '1',
      companyCode: this.companyCode,
    };
    debug('validating credentials');
    const result = await fetchPostWithinPage<ScrapedLoginValidation>(this.page, validateUrl, { data: validateRequest });
    if (!result?.Header || result.Header.Status !== '1' || !result.ValidateIdDataBean) {
      debug('validation failed: result=%s', JSON.stringify(result)?.substring(0, 300) ?? 'null');
      return null;
    }
    return result.ValidateIdDataBean;
  }

  private buildLoginRequest(credentials: ScraperSpecificCredentials, userName: string): Record<string, string> {
    return {
      KodMishtamesh: userName,
      MisparZihuy: credentials.id,
      Sisma: credentials.password,
      cardSuffix: credentials.card6Digits,
      countryCode: COUNTRY_CODE,
      idType: ID_TYPE,
    };
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
    credentials: ScraperSpecificCredentials,
    userName: string,
  ): Promise<ScraperScrapingResult> {
    const loginUrl = `${this.servicesUrl}?reqName=performLogonI`;
    debug('user login started');
    const loginResult = await fetchPostWithinPage<{ status: string }>(this.page, loginUrl, {
      data: this.buildLoginRequest(credentials, userName),
    });
    debug(`user login with status '${loginResult?.status}'`, loginResult);
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
        debug('response: %d %s', response.status(), url.substring(0, 120));
    });
  }

  private async navigateToLoginPage(): Promise<void> {
    debug(`navigating to ${this.baseUrl}/personalarea/Login`);
    await this.navigateTo(`${this.baseUrl}/personalarea/Login`);
    await this.page.waitForFunction(() => document.readyState === 'complete');
    await humanDelay(1500, 3000);
    this.emitProgress(ScraperProgressTypes.LoggingIn);
  }

  async login(credentials: ScraperSpecificCredentials): Promise<ScraperScrapingResult> {
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
    debug(`user validate with return code '${validateReturnCode}'`);
    return validateReturnCode === '1'
      ? this.performLogin(credentials, validatedData.userName ?? '')
      : this.handleValidateReturnCode(validateReturnCode);
  }

  async fetchData(): Promise<{ success: boolean; accounts: { accountNumber: string; txns: Transaction[] }[] }> {
    const defaultStartMoment = moment().subtract(1, 'years');
    const startDate = this.options.startDate || defaultStartMoment.toDate();
    const startMoment = moment.max(defaultStartMoment, moment(startDate));
    return fetchAllTransactions({
      page: this.page,
      options: this.options,
      companyServiceOptions: { servicesUrl: this.servicesUrl, companyCode: this.companyCode },
      startMoment,
    });
  }
}

export default IsracardAmexBaseScraper;
