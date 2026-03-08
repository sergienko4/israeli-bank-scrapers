import { EventEmitter } from 'events';
import moment from 'moment-timezone';

import { getDebug } from '../../Common/Debug.js';
import { formatResultSummary } from '../../Common/ResultFormatter.js';
import { TimeoutError } from '../../Common/Waiting.js';
import { type CompanyTypes, ScraperProgressTypes } from '../../Definitions.js';
import {
  createGenericError,
  createTimeoutError,
  createWafBlockedError,
  type ErrorResult,
  WafBlockError,
} from './Errors.js';
import {
  type Scraper,
  type ScraperCredentials,
  type ScraperDiagnostics,
  type ScraperGetLongTermTwoFactorTokenResult,
  type ScraperLoginResult,
  type ScraperOptions,
  type ScraperScrapingResult,
  type ScraperTwoFactorAuthTriggerResult,
} from './Interface.js';

interface DiagnosticsState {
  loginUrl: string;
  finalUrl?: string;
  loginStartMs: number;
  fetchStartMs?: number;
  lastAction: string;
  pageTitle?: string;
  warnings: string[];
}

const SCRAPE_PROGRESS = 'SCRAPE_PROGRESS';
const LOG = getDebug('base-scraper');

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
  protected readonly diagState: DiagnosticsState = {
    loginUrl: '',
    loginStartMs: 0,
    lastAction: 'start',
    warnings: [],
  };

  private eventEmitter = new EventEmitter();

  constructor(public options: ScraperOptions) {}

  // eslint-disable-next-line  @typescript-eslint/require-await
  public async initialize(): Promise<void> {
    this.emitProgress(ScraperProgressTypes.Initializing);
    moment.tz.setDefault('Asia/Jerusalem');
  }

  public async scrape(credentials: TCredentials): Promise<ScraperScrapingResult> {
    this.emitProgress(ScraperProgressTypes.StartScraping);
    await this.initialize();
    const loginResult = await this.executeLogin(credentials);
    const scrapeResult = await this.executeFetchData(loginResult);
    this.logResultSummary(scrapeResult);
    const finalResult = await this.handleTermination(scrapeResult);
    this.emitProgress(ScraperProgressTypes.EndScraping);
    return finalResult;
  }

  public triggerTwoFactorAuth(_phoneNumber: string): Promise<ScraperTwoFactorAuthTriggerResult> {
    throw new Error(`triggerOtp() is not created in ${this.options.companyId}`);
  }

  public getLongTermTwoFactorToken(
    _otpCode: string,
  ): Promise<ScraperGetLongTermTwoFactorTokenResult> {
    throw new Error(`getPermanentOtpToken() is not created in ${this.options.companyId}`);
  }

  public onProgress(
    func: (companyId: CompanyTypes, payload: { type: ScraperProgressTypes }) => void,
  ): void {
    this.eventEmitter.on(SCRAPE_PROGRESS, func);
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
  protected async terminate(_success: boolean): Promise<void> {
    this.emitProgress(ScraperProgressTypes.Terminating);
  }

  protected emitProgress(type: ScraperProgressTypes): void {
    this.emit(SCRAPE_PROGRESS, { type });
  }

  protected emit(eventName: string, payload: Record<string, unknown>): void {
    this.eventEmitter.emit(eventName, this.options.companyId, payload);
  }

  protected buildDiagnostics(): ScraperDiagnostics {
    const { loginUrl, finalUrl, loginStartMs, fetchStartMs, lastAction, pageTitle, warnings } =
      this.diagState;
    return {
      loginUrl,
      finalUrl,
      loginDurationMs: loginStartMs ? Date.now() - loginStartMs : undefined,
      fetchDurationMs: fetchStartMs ? Date.now() - fetchStartMs : undefined,
      lastAction,
      pageTitle,
      warnings: [...warnings],
    };
  }

  private async executeLogin(credentials: TCredentials): Promise<ScraperScrapingResult> {
    this.diagState.loginStartMs = Date.now();
    this.diagState.lastAction = 'logging in';
    try {
      return await this.login(credentials);
    } catch (e) {
      return { ...categorizeError(e), diagnostics: this.buildDiagnostics() };
    }
  }

  private async executeFetchData(
    loginResult: ScraperScrapingResult,
  ): Promise<ScraperScrapingResult> {
    if (!loginResult.success) return loginResult;
    this.diagState.fetchStartMs = Date.now();
    this.diagState.lastAction = 'fetching data';
    try {
      const scrapeResult = await this.fetchData();
      if (
        scrapeResult.success &&
        'persistentOtpToken' in loginResult &&
        loginResult.persistentOtpToken
      ) {
        scrapeResult.persistentOtpToken = loginResult.persistentOtpToken;
      }
      return scrapeResult;
    } catch (e) {
      return { ...categorizeError(e), diagnostics: this.buildDiagnostics() };
    }
  }

  private logResultSummary(result: ScraperScrapingResult): void {
    const lines = formatResultSummary(this.options.companyId, result);
    for (const line of lines) {
      LOG.info(line);
    }
  }

  private async handleTermination(
    scrapeResult: ScraperScrapingResult,
  ): Promise<ScraperScrapingResult> {
    try {
      await this.terminate(scrapeResult.success);
    } catch (e) {
      return createGenericError((e as Error).message);
    }
    return scrapeResult;
  }
}
