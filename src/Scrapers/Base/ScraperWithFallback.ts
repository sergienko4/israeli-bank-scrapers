import { BrowserEngineType, getGlobalEngineChain } from '../../Common/BrowserEngine';
import { getDebug } from '../../Common/Debug';
import { type CompanyTypes, type ScraperProgressTypes } from '../../Definitions';
import type { IDoneResult } from '../../Interfaces/Common/StepResult';
import { ScraperErrorTypes } from './ErrorTypes';
import type {
  IScraper,
  IScraperScrapingResult,
  ScraperCredentials,
  ScraperGetLongTermTwoFactorTokenResult,
  ScraperOptions,
  ScraperTwoFactorAuthTriggerResult,
} from './Interface';
import { ScraperWebsiteChangedError } from './ScraperWebsiteChangedError';

/** Callback type matching the IScraper.onProgress signature. */
type ProgressCallback = (
  companyId: CompanyTypes,
  payload: { type: ScraperProgressTypes },
) => IDoneResult;

const LOG = getDebug('scraper-with-fallback');

/**
 * Error types that trigger a fallback to the next engine.
 * WafBlocked: bank API returned a block/challenge page.
 * Timeout: login redirect timed out (bank redirected back to login = IP/WAF block).
 * Wrong credentials produce InvalidPassword (not Timeout) after the validateCredentials fix,
 * so adding Timeout here does NOT cause wrong-credential retries.
 */
const FALLBACK_ERRORS = new Set<ScraperErrorTypes>([
  ScraperErrorTypes.WafBlocked,
  ScraperErrorTypes.Timeout,
]);

/** Default fallback chain: stealth → rebrowser → patchright (kept for backward compat). */
export const DEFAULT_ENGINE_CHAIN: BrowserEngineType[] = [
  BrowserEngineType.PlaywrightStealth,
  BrowserEngineType.Rebrowser,
  BrowserEngineType.Patchright,
];

/** Records the engine used and the result it produced in a full-queue attempt run. */
export interface IScraperEngineAttempt {
  engine: BrowserEngineType;
  result: IScraperScrapingResult;
}

/**
 * Returns true when the result should trigger a fallback to the next engine.
 *
 * @param result - the scraping result to inspect
 * @returns true for WafBlocked or Timeout errors; false otherwise
 */
function shouldFallback(result: IScraperScrapingResult): boolean {
  return !result.success && result.errorType != null && FALLBACK_ERRORS.has(result.errorType);
}

/**
 * Builds ScraperOptions with the given engine type injected.
 *
 * @param base - the original scraper options
 * @param engineType - the engine to inject
 * @returns cloned options with engineType overridden
 */
function optionsWithEngine(base: ScraperOptions, engineType: BrowserEngineType): ScraperOptions {
  return { ...base, engineType } as ScraperOptions;
}

/**
 * Formats a single engine attempt into a human-readable summary string.
 *
 * @param attempt - the engine attempt to summarise
 * @returns a string like "[camoufox] WafBlocked: blocked"
 */
function formatAttempt(attempt: IScraperEngineAttempt): string {
  const { engine, result } = attempt;
  const errType = result.errorType ?? 'unknown';
  const errMsg = result.errorMessage ?? '(no message)';
  return `[${engine}] ${errType}: ${errMsg}`;
}

/**
 * Builds a combined failure result when every engine in the chain triggered a fallback.
 *
 * @param attempts - all engine attempts collected during the run
 * @returns a failed IScraperScrapingResult with a rich errorMessage listing all engines
 */
function buildAllFailedResult(attempts: IScraperEngineAttempt[]): IScraperScrapingResult {
  const summary = attempts.map(formatAttempt).join(' | ');
  const lastResult = attempts.at(-1)?.result;
  const errorType = lastResult?.errorType ?? ScraperErrorTypes.WafBlocked;
  const base: IScraperScrapingResult = {
    success: false,
    errorType,
    errorMessage: `All engines failed — ${summary}`,
  };
  return lastResult?.errorDetails ? { ...base, errorDetails: lastResult.errorDetails } : base;
}

/**
 * A scraper wrapper that tries multiple browser engines in order,
 * falling back to the next engine when the current one returns WafBlocked or Timeout.
 *
 * @example
 * const scraper = new ScraperWithFallback(
 *   options,
 *   createScraper,
 *   [BrowserEngineType.Camoufox, BrowserEngineType.PlaywrightStealth],
 * );
 * const result = await scraper.scrape(credentials);
 */
export class ScraperWithFallback implements IScraper<ScraperCredentials> {
  private readonly _options: ScraperOptions;

  private readonly _createFn: (opts: ScraperOptions) => IScraper<ScraperCredentials>;

  private readonly _engines: BrowserEngineType[];

  private _progressCallback?: ProgressCallback;

  /**
   * Creates a new ScraperWithFallback.
   *
   * @param options - base scraper options (companyId, startDate, etc.)
   * @param createFn - factory function that constructs a concrete IScraper for given options
   * @param engines - ordered list of engine types to try; defaults to getGlobalEngineChain()
   */
  constructor(
    options: ScraperOptions,
    createFn: (opts: ScraperOptions) => IScraper<ScraperCredentials>,
    engines: BrowserEngineType[] = getGlobalEngineChain(),
  ) {
    this._options = options;
    this._createFn = createFn;
    this._engines = engines;
  }

  /**
   * Registers a progress callback forwarded to each engine's scraper during its run.
   * Matches the IScraper interface so ScraperWithFallback is a transparent drop-in.
   *
   * @param func - callback receiving companyId and progress type on each state change
   * @returns a done result
   */
  public onProgress(func: ProgressCallback): IDoneResult {
    this._progressCallback = func;
    return { done: true };
  }

  /**
   * Not supported on the fallback wrapper — 2FA banks must use createConcreteScraper() directly.
   *
   * @param phoneNumber - the phone number hint (included in error for diagnostics)
   * @returns never — always throws ScraperWebsiteChangedError
   */
  public triggerTwoFactorAuth(phoneNumber: string): Promise<ScraperTwoFactorAuthTriggerResult> {
    const msg = `2FA not supported on fallback scraper (phone: ${phoneNumber})`;
    throw new ScraperWebsiteChangedError(this._options.companyId, msg);
  }

  /**
   * Not supported on the fallback wrapper — 2FA banks must use createConcreteScraper() directly.
   *
   * @param otpCode - the OTP code (included in error for diagnostics)
   * @returns never — always throws ScraperWebsiteChangedError
   */
  public getLongTermTwoFactorToken(
    otpCode: string,
  ): Promise<ScraperGetLongTermTwoFactorTokenResult> {
    const msg = `2FA not supported on fallback scraper (otp: ${otpCode})`;
    throw new ScraperWebsiteChangedError(this._options.companyId, msg);
  }

  /**
   * Scrapes bank transactions, trying each engine in order on WafBlocked or Timeout.
   * Collects all attempts; returns the first non-fallback result immediately.
   * If every engine triggers a fallback, returns a rich error listing all attempts.
   *
   * @param credentials - bank login credentials
   * @returns the scraping result (success, non-WAF error, or all-engines-failed rich error)
   */
  public async scrape(credentials: ScraperCredentials): Promise<IScraperScrapingResult> {
    const seed: Promise<IScraperEngineAttempt[]> = Promise.resolve([]);
    const attempts = await this._engines.reduce(async (prevPromise, engine) => {
      const prev = await prevPromise;
      const last = prev.at(-1);
      if (last !== undefined && !shouldFallback(last.result)) return prev;
      const result = await this.tryEngine(engine, credentials);
      return [...prev, { engine, result }];
    }, seed);
    const finalAttempt = attempts.at(-1);
    if (finalAttempt === undefined) return buildAllFailedResult([]);
    if (!shouldFallback(finalAttempt.result)) return finalAttempt.result;
    return buildAllFailedResult(attempts);
  }

  /**
   * Attempts a scrape with one engine, catching unexpected errors as Generic failures.
   *
   * @param engine - the engine type to use
   * @param credentials - bank login credentials
   * @returns the scraping result or a Generic error on unexpected throw
   */
  private async tryEngine(
    engine: BrowserEngineType,
    credentials: ScraperCredentials,
  ): Promise<IScraperScrapingResult> {
    try {
      LOG.info('trying engine %s', engine);
      const engineOpts = optionsWithEngine(this._options, engine);
      const scraper = this._createFn(engineOpts);
      if (this._progressCallback) scraper.onProgress(this._progressCallback);
      return await scraper.scrape(credentials);
    } catch (err) {
      if (err instanceof ScraperWebsiteChangedError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      LOG.info('engine %s threw: %s', engine, msg);
      return { success: false, errorType: ScraperErrorTypes.Generic, errorMessage: msg };
    }
  }
}
