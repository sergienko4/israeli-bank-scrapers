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

function categorizeError(e: unknown): ErrorResult {
  if (e instanceof TimeoutError) return createTimeoutError((e as Error).message);
  if (e instanceof WafBlockError) return createWafBlockedError(e.message, e.details);
  return createGenericError((e as Error).message);
}

export class BaseScraper<TCredentials extends ScraperCredentials> implements Scraper<TCredentials> {
  private eventEmitter = new EventEmitter();

  constructor(public options: ScraperOptions) {}

  // eslint-disable-next-line  @typescript-eslint/require-await
  async initialize() {
    this.emitProgress(ScraperProgressTypes.Initializing);
    moment.tz.setDefault('Asia/Jerusalem');
  }

  async scrape(credentials: TCredentials): Promise<ScraperScrapingResult> {
    this.emitProgress(ScraperProgressTypes.StartScraping);
    await this.initialize();

    let loginResult;
    try {
      loginResult = await this.login(credentials);
    } catch (e) {
      loginResult = categorizeError(e);
    }

    let scrapeResult;
    if (loginResult.success) {
      try {
        scrapeResult = await this.fetchData();
      } catch (e) {
        scrapeResult = categorizeError(e);
      }
    } else {
      scrapeResult = loginResult;
    }

    try {
      const success = scrapeResult && scrapeResult.success === true;
      await this.terminate(success);
    } catch (e) {
      scrapeResult = createGenericError((e as Error).message);
    }
    this.emitProgress(ScraperProgressTypes.EndScraping);

    return scrapeResult;
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
