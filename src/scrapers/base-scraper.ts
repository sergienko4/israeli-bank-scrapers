import { EventEmitter } from 'events';
import moment from 'moment-timezone';
import { type CompanyTypes, ScraperProgressTypes } from '../definitions';
import { TimeoutError } from '../helpers/waiting';
import {
  type ErrorResult,
  WafBlockError,
  createGenericError,
  createTimeoutError,
  createWafBlockedError,
} from './errors';
import {
  type Scraper,
  type ScraperCredentials,
  type ScraperGetLongTermTwoFactorTokenResult,
  type ScraperLoginResult,
  type ScraperOptions,
  type ScraperScrapingResult,
  type ScraperTwoFactorAuthTriggerResult,
} from './interface';

const SCRAPE_PROGRESS = 'SCRAPE_PROGRESS';

function extractErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  return String(e);
}

function categorizeError(e: unknown): ErrorResult {
  if (e instanceof TimeoutError) return createTimeoutError(e.message);
  if (e instanceof WafBlockError) return createWafBlockedError(e.message, e.details);
  return createGenericError(extractErrorMessage(e));
}

export class BaseScraper<TCredentials extends ScraperCredentials> implements Scraper<TCredentials> {
  private eventEmitter = new EventEmitter();

  constructor(public options: ScraperOptions) {}

  // eslint-disable-next-line  @typescript-eslint/require-await
  async initialize() {
    this.emitProgress(ScraperProgressTypes.Initializing);
    moment.tz.setDefault('Asia/Jerusalem');
  }

  private async executeLogin(credentials: TCredentials): Promise<ScraperScrapingResult> {
    try { return await this.login(credentials); } catch (e) { return categorizeError(e); }
  }

  private async executeFetchData(loginResult: ScraperScrapingResult): Promise<ScraperScrapingResult> {
    if (!loginResult.success) return loginResult;
    try {
      const scrapeResult = await this.fetchData();
      if (scrapeResult.success && 'persistentOtpToken' in loginResult && loginResult.persistentOtpToken) {
        scrapeResult.persistentOtpToken = loginResult.persistentOtpToken;
      }
      return scrapeResult;
    } catch (e) { return categorizeError(e); }
  }

  private async handleTermination(scrapeResult: ScraperScrapingResult): Promise<ScraperScrapingResult> {
    try {
      await this.terminate(scrapeResult?.success === true);
    } catch (e) { return createGenericError((e as Error).message); }
    return scrapeResult;
  }

  async scrape(credentials: TCredentials): Promise<ScraperScrapingResult> {
    this.emitProgress(ScraperProgressTypes.StartScraping);
    await this.initialize();
    const loginResult = await this.executeLogin(credentials);
    const scrapeResult = await this.executeFetchData(loginResult);
    const finalResult = await this.handleTermination(scrapeResult);
    this.emitProgress(ScraperProgressTypes.EndScraping);
    return finalResult;
  }

  triggerTwoFactorAuth(_phoneNumber: string): Promise<ScraperTwoFactorAuthTriggerResult> {
    throw new Error(`triggerOtp() is not created in ${this.options.companyId}`);
  }

  getLongTermTwoFactorToken(_otpCode: string): Promise<ScraperGetLongTermTwoFactorTokenResult> {
    throw new Error(`getPermanentOtpToken() is not created in ${this.options.companyId}`);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  protected async login(_credentials: TCredentials): Promise<ScraperLoginResult> {
    throw new Error(`login() is not created in ${this.options.companyId}`);
  }

  // eslint-disable-next-line  @typescript-eslint/require-await
  protected async fetchData(): Promise<ScraperScrapingResult> {
    throw new Error(`fetchData() is not created in ${this.options.companyId}`);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  protected async terminate(_success: boolean) {
    this.emitProgress(ScraperProgressTypes.Terminating);
  }

  protected emitProgress(type: ScraperProgressTypes) {
    this.emit(SCRAPE_PROGRESS, { type });
  }

  protected emit(eventName: string, payload: Record<string, any>) {
    this.eventEmitter.emit(eventName, this.options.companyId, payload);
  }

  onProgress(func: (companyId: CompanyTypes, payload: { type: ScraperProgressTypes }) => void) {
    this.eventEmitter.on(SCRAPE_PROGRESS, func);
  }
}
