import { EventEmitter } from 'events';
import moment from 'moment-timezone';

import { TimeoutError } from '../../Common/Waiting';
import { type CompanyTypes, ScraperProgressTypes } from '../../Definitions';
import {
  createGenericError,
  createTimeoutError,
  createWafBlockedError,
  type ErrorResult,
  WafBlockError,
} from './Errors';
import {
  type Scraper,
  type ScraperCredentials,
  type ScraperDiagnostics,
  type ScraperGetLongTermTwoFactorTokenResult,
  type ScraperLoginResult,
  type ScraperOptions,
  type ScraperScrapingResult,
  type ScraperTwoFactorAuthTriggerResult,
} from './Interface';
import { ScraperWebsiteChangedError } from './ScraperWebsiteChangedError';

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

/**
 * Extracts a human-readable error message from any thrown value.
 *
 * @param e - the caught exception (Error, string, or other)
 * @returns a string error message
 */
function extractErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  return String(e);
}

/**
 * Maps a caught exception to the appropriate ErrorResult type.
 *
 * @param e - the caught exception
 * @returns a typed ErrorResult with an appropriate errorType
 */
function categorizeError(e: unknown): ErrorResult {
  if (e instanceof TimeoutError) return createTimeoutError(e.message);
  if (e instanceof WafBlockError) return createWafBlockedError(e.message, e.details);
  const errorMessage = extractErrorMessage(e);
  return createGenericError(errorMessage);
}

/**
 * Abstract base class for all bank scrapers.
 * Implements the core scrape lifecycle: initialize → login → fetchData → terminate.
 */
export class BaseScraper<TCredentials extends ScraperCredentials> implements Scraper<TCredentials> {
  protected readonly diagState: DiagnosticsState = {
    loginUrl: '',
    loginStartMs: 0,
    lastAction: 'start',
    warnings: [],
  };

  private _eventEmitter = new EventEmitter();

  /**
   * Creates a new BaseScraper instance.
   *
   * @param options - scraper options including companyId, timeouts, and browser settings
   */
  constructor(public options: ScraperOptions) {}

  /**
   * Initializes the scraper, setting the default timezone to Asia/Jerusalem.
   *
   * @returns a promise that resolves when initialization is complete
   */
  public initialize(): Promise<void> {
    this.emitProgress(ScraperProgressTypes.Initializing);
    moment.tz.setDefault('Asia/Jerusalem');
    return Promise.resolve();
  }

  /**
   * Runs the full scrape lifecycle: login then fetch data.
   *
   * @param credentials - bank login credentials
   * @returns the scraping result with transactions or an error description
   */
  public async scrape(credentials: TCredentials): Promise<ScraperScrapingResult> {
    this.emitProgress(ScraperProgressTypes.StartScraping);
    await this.initialize();
    const loginResult = await this.executeLogin(credentials);
    const scrapeResult = await this.executeFetchData(loginResult);
    const finalResult = await this.handleTermination(scrapeResult);
    this.emitProgress(ScraperProgressTypes.EndScraping);
    return finalResult;
  }

  /**
   * Triggers the OTP SMS for two-factor authentication. Override in OTP-capable scrapers.
   *
   * @param phoneNumber - the phone number to send the OTP to
   * @returns a promise that resolves with the trigger result
   */
  public triggerTwoFactorAuth(phoneNumber: string): Promise<ScraperTwoFactorAuthTriggerResult> {
    void phoneNumber;
    throw new ScraperWebsiteChangedError(this.options.companyId, 'triggerOtp() not implemented');
  }

  /**
   * Exchanges a short-lived OTP code for a long-term session token. Override in OTP-capable scrapers.
   *
   * @param otpCode - the one-time password received via SMS
   * @returns a promise resolving with the long-term token result
   */
  public getLongTermTwoFactorToken(
    otpCode: string,
  ): Promise<ScraperGetLongTermTwoFactorTokenResult> {
    void otpCode;
    throw new ScraperWebsiteChangedError(
      this.options.companyId,
      'getPermanentOtpToken() not implemented',
    );
  }

  /**
   * Registers a progress callback invoked on each lifecycle stage.
   *
   * @param func - callback receiving the companyId and progress type payload
   */
  public onProgress(
    func: (companyId: CompanyTypes, payload: { type: ScraperProgressTypes }) => void,
  ): void {
    this._eventEmitter.on(SCRAPE_PROGRESS, func);
  }

  /**
   * Performs the bank login. Override in subclasses with browser or API-based login logic.
   *
   * @param credentials - bank login credentials
   * @returns a promise resolving with the login result
   */
  protected login(credentials: TCredentials): Promise<ScraperLoginResult> {
    void credentials;
    throw new ScraperWebsiteChangedError(this.options.companyId, 'login() not implemented');
  }

  /**
   * Fetches transaction data after a successful login. Override in subclasses.
   *
   * @returns a promise resolving with the scraping result containing accounts and transactions
   */
  protected fetchData(): Promise<ScraperScrapingResult> {
    throw new ScraperWebsiteChangedError(this.options.companyId, 'fetchData() not implemented');
  }

  /**
   * Terminates the scraping session. Override to close browser or connections.
   *
   * @param success - whether the scraping was successful
   * @returns a promise that resolves when cleanup is complete
   */
  protected terminate(success: boolean): Promise<void> {
    void success;
    this.emitProgress(ScraperProgressTypes.Terminating);
    return Promise.resolve();
  }

  /**
   * Emits a progress event for the current lifecycle stage.
   *
   * @param type - the progress stage type to emit
   */
  protected emitProgress(type: ScraperProgressTypes): void {
    this.emit(SCRAPE_PROGRESS, { type });
  }

  /**
   * Emits a named event with the company ID and payload.
   *
   * @param eventName - the event name to emit
   * @param payload - data attached to the event
   */
  protected emit(eventName: string, payload: Record<string, unknown>): void {
    this._eventEmitter.emit(eventName, this.options.companyId, payload);
  }

  /**
   * Builds a diagnostics snapshot from the current state for error reporting.
   *
   * @returns a diagnostics object with timing and URL info
   */
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

  /**
   * Executes the login phase, catching errors and wrapping them as error results.
   *
   * @param credentials - bank login credentials
   * @returns the login result or an error result if login threw
   */
  private async executeLogin(credentials: TCredentials): Promise<ScraperScrapingResult> {
    this.diagState.loginStartMs = Date.now();
    this.diagState.lastAction = 'logging in';
    try {
      return await this.login(credentials);
    } catch (e) {
      return { ...categorizeError(e), diagnostics: this.buildDiagnostics() };
    }
  }

  /**
   * Executes the data fetch phase if login succeeded, propagating the persistent OTP token.
   *
   * @param loginResult - the result from the login phase
   * @returns the scraping result from fetchData, or the original login error
   */
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

  /**
   * Runs the terminate() cleanup and returns the original scrape result.
   *
   * @param scrapeResult - the result produced by executeFetchData
   * @returns the original scrape result, or an error result if termination failed
   */
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

export default BaseScraper;
