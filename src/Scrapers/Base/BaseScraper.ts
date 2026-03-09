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
  type IErrorResult,
  WafBlockError,
} from './Errors.js';
import {
  type IScraper,
  type IScraperDiagnostics,
  type IScraperLoginResult,
  type IScraperScrapingResult,
  type ScraperCredentials,
  type ScraperGetLongTermTwoFactorTokenResult,
  type ScraperOptions,
  type ScraperTwoFactorAuthTriggerResult,
} from './Interface.js';
import type { VoidResult } from './Interfaces/CallbackTypes.js';
import ScraperError from './ScraperError.js';

/** Internal state for tracking login and fetch diagnostics. */
interface IDiagnosticsState {
  loginUrl: string;
  finalUrl?: string;
  loginStartMs: number;
  fetchStartMs?: number;
  lastAction: string;
  pageTitle?: string;
  warnings: string[];
}

/** Event name for scrape progress notifications. */
const SCRAPE_PROGRESS = 'SCRAPE_PROGRESS';
const LOG = getDebug('base-scraper');

/**
 * Extract a human-readable message from an unknown error value.
 * @param error - The caught error value.
 * @returns A string error message.
 */
function extractErrorMessage(error: Error | string): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error);
}

/**
 * Map an error to a structured error result based on its type.
 * @param error - The caught error value.
 * @returns A structured error result for the scraper.
 */
function categorizeError(error: Error | string): IErrorResult {
  if (error instanceof TimeoutError) return createTimeoutError(error.message);
  if (error instanceof WafBlockError) return createWafBlockedError(error.message, error.details);
  const message = extractErrorMessage(error);
  return createGenericError(message);
}

/** Payload shape for scraper progress events. */
interface IProgressPayload {
  type: ScraperProgressTypes;
}

/**
 * Base scraper class — handles lifecycle (init, login, fetch, terminate)
 * and emits progress events.
 */
export default class BaseScraper<
  TCredentials extends ScraperCredentials,
> implements IScraper<TCredentials> {
  protected readonly diagState: IDiagnosticsState = {
    loginUrl: '',
    loginStartMs: 0,
    lastAction: 'start',
    warnings: [],
  };

  private _eventEmitter = new EventEmitter();

  /**
   * Create a new BaseScraper with the given options.
   * @param options - Scraper configuration options.
   */
  constructor(public options: ScraperOptions) {}

  /**
   * Initialize the scraper and set the default timezone.
   * @returns True when initialization completes.
   */
  public initialize(): Promise<boolean> {
    this.emitProgress(ScraperProgressTypes.Initializing);
    moment.tz.setDefault('Asia/Jerusalem');
    return Promise.resolve(true);
  }

  /**
   * Run the full scrape lifecycle: init, login, fetch, terminate.
   * @param credentials - The user's bank credentials.
   * @returns The scraping result with accounts or error details.
   */
  public async scrape(credentials: TCredentials): Promise<IScraperScrapingResult> {
    this.emitProgress(ScraperProgressTypes.StartScraping);
    await this.initialize();
    const loginResult = await this.executeLogin(credentials);
    const scrapeResult = await this.executeFetchData(loginResult);
    this.logResultSummary(scrapeResult);
    const finalResult = await this.handleTermination(scrapeResult);
    this.emitProgress(ScraperProgressTypes.EndScraping);
    return finalResult;
  }

  /**
   * Trigger two-factor authentication for the given phone number.
   * @param phoneNumber - The phone number to send OTP to.
   * @returns The trigger result with status.
   */
  public triggerTwoFactorAuth(phoneNumber: string): Promise<ScraperTwoFactorAuthTriggerResult> {
    void phoneNumber;
    throw new ScraperError(`triggerOtp() is not created in ${this.options.companyId}`);
  }

  /**
   * Retrieve a long-term token using the provided OTP code.
   * @param otpCode - The one-time password from the user.
   * @returns The long-term token result.
   */
  public getLongTermTwoFactorToken(
    otpCode: string,
  ): Promise<ScraperGetLongTermTwoFactorTokenResult> {
    void otpCode;
    throw new ScraperError(`getPermanentOtpToken() is not created in ${this.options.companyId}`);
  }

  /**
   * Register a listener for scrape progress events.
   * @param func - Callback receiving company ID and progress payload.
   */
  public onProgress(
    func: (companyId: CompanyTypes, payload: IProgressPayload) => VoidResult,
  ): VoidResult {
    this._eventEmitter.on(SCRAPE_PROGRESS, func);
  }

  /**
   * Perform the bank-specific login — override in subclasses.
   * @param credentials - The user's bank credentials.
   * @returns The login result.
   */
  protected login(credentials: TCredentials): Promise<IScraperLoginResult> {
    void credentials;
    throw new ScraperError(`login() is not created in ${this.options.companyId}`);
  }

  /**
   * Fetch transaction data after successful login — override in subclasses.
   * @returns The scraping result with account data.
   */
  protected fetchData(): Promise<IScraperScrapingResult> {
    throw new ScraperError(`fetchData() is not created in ${this.options.companyId}`);
  }

  /**
   * Clean up resources after scraping — override in subclasses.
   * @param isSuccess - Whether the scraping session was successful.
   * @returns True when termination completes.
   */
  protected terminate(isSuccess: boolean): Promise<boolean> {
    void isSuccess;
    this.emitProgress(ScraperProgressTypes.Terminating);
    return Promise.resolve(true);
  }

  /**
   * Emit a scraper progress event to all registered listeners.
   * @param type - The progress event type.
   * @returns True after the event is emitted.
   */
  protected emitProgress(type: ScraperProgressTypes): boolean {
    this.emitEvent(SCRAPE_PROGRESS, { type });
    return true;
  }

  /**
   * Assemble diagnostics from the current scraper state.
   * @returns A snapshot of login and fetch timing, URLs, and warnings.
   */
  protected buildDiagnostics(): IScraperDiagnostics {
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

  /**
   * Emit a named event with a payload to all registered listeners.
   * @param eventName - The event name to emit.
   * @param payload - The event data.
   * @returns True after the event is emitted.
   */
  private emitEvent(eventName: string, payload: IProgressPayload): boolean {
    this._eventEmitter.emit(eventName, this.options.companyId, payload);
    return true;
  }

  /**
   * Execute the login step and catch errors into structured results.
   * @param credentials - The user's bank credentials.
   * @returns The login result or a structured error.
   */
  private async executeLogin(credentials: TCredentials): Promise<IScraperScrapingResult> {
    this.diagState.loginStartMs = Date.now();
    this.diagState.lastAction = 'logging in';
    try {
      return await this.login(credentials);
    } catch (e) {
      const errorResult = categorizeError(e as Error);
      return { ...errorResult, diagnostics: this.buildDiagnostics() };
    }
  }

  /**
   * Execute the fetch step if login was successful.
   * @param loginResult - The result from the login step.
   * @returns The fetch result or the passed-through login failure.
   */
  private async executeFetchData(
    loginResult: IScraperScrapingResult,
  ): Promise<IScraperScrapingResult> {
    if (!loginResult.success) return loginResult;
    this.diagState.fetchStartMs = Date.now();
    this.diagState.lastAction = 'fetching data';
    return this.doFetchData(loginResult);
  }

  /**
   * Perform the actual fetch data call and propagate OTP token.
   * @param loginResult - The login result that may contain a persistent OTP token.
   * @returns The fetch result with optional OTP token propagation.
   */
  private async doFetchData(loginResult: IScraperScrapingResult): Promise<IScraperScrapingResult> {
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
      const errorResult = categorizeError(e as Error);
      return { ...errorResult, diagnostics: this.buildDiagnostics() };
    }
  }

  /**
   * Log a formatted summary of the scraping result.
   * @param result - The scraping result to summarize.
   * @returns True after the summary is logged.
   */
  private logResultSummary(result: IScraperScrapingResult): boolean {
    const lines = formatResultSummary(this.options.companyId, result);
    for (const line of lines) {
      LOG.info(line);
    }
    return true;
  }

  /**
   * Run the termination step and return the original result on failure.
   * @param scrapeResult - The scraping result to return.
   * @returns The original result or a generic error if termination fails.
   */
  private async handleTermination(
    scrapeResult: IScraperScrapingResult,
  ): Promise<IScraperScrapingResult> {
    try {
      await this.terminate(scrapeResult.success);
    } catch (e) {
      return createGenericError((e as Error).message);
    }
    return scrapeResult;
  }
}
