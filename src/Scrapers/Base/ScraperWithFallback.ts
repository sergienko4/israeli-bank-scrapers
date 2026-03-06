import { BrowserEngineType, getGlobalEngineChain } from '../../Common/BrowserEngine';
import { getDebug } from '../../Common/Debug';
import { type CompanyTypes, type ScraperProgressTypes } from '../../Definitions';
import { ScraperErrorTypes } from './ErrorTypes';
import type {
  Scraper,
  ScraperCredentials,
  ScraperGetLongTermTwoFactorTokenResult,
  ScraperOptions,
  ScraperScrapingResult,
  ScraperTwoFactorAuthTriggerResult,
} from './Interface';
import { ScraperWebsiteChangedError } from './ScraperWebsiteChangedError';

/** Callback type matching the Scraper.onProgress signature. */
type ProgressCallback = (companyId: CompanyTypes, payload: { type: ScraperProgressTypes }) => void;

const LOG = getDebug('scraper-with-fallback');

/**
 * Error types that trigger a fallback to the next engine.
 * Only WAF blocks — timeouts could be login failures (wrong credentials) and must not retry.
 */
const FALLBACK_ERRORS = new Set<ScraperErrorTypes>([ScraperErrorTypes.WafBlocked]);

/** Default fallback chain: stealth → rebrowser → patchright (kept for backward compat). */
export const DEFAULT_ENGINE_CHAIN: BrowserEngineType[] = [
  BrowserEngineType.PlaywrightStealth,
  BrowserEngineType.Rebrowser,
  BrowserEngineType.Patchright,
];

/** Records the engine used and the result it produced in a full-queue attempt run. */
export interface ScraperEngineAttempt {
  engine: BrowserEngineType;
  result: ScraperScrapingResult;
}

/**
 * Returns true when the result should trigger a fallback to the next engine.
 *
 * @param result - the scraping result to inspect
 * @returns true for WafBlocked or Timeout errors; false otherwise
 */
function shouldFallback(result: ScraperScrapingResult): boolean {
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
function formatAttempt(attempt: ScraperEngineAttempt): string {
  const { engine, result } = attempt;
  const errType = result.errorType ?? 'unknown';
  const errMsg = result.errorMessage ?? '(no message)';
  return `[${engine}] ${errType}: ${errMsg}`;
}

/**
 * Builds a combined failure result when every engine in the chain triggered a fallback.
 *
 * @param attempts - all engine attempts collected during the run
 * @returns a failed ScraperScrapingResult with a rich errorMessage listing all engines
 */
function buildAllFailedResult(attempts: ScraperEngineAttempt[]): ScraperScrapingResult {
  const summary = attempts.map(formatAttempt).join(' | ');
  const lastResult = attempts.at(-1)?.result;
  const errorType = lastResult?.errorType ?? ScraperErrorTypes.WafBlocked;
  const base: ScraperScrapingResult = {
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
export class ScraperWithFallback implements Scraper<ScraperCredentials> {
  private readonly _options: ScraperOptions;

  private readonly _createFn: (opts: ScraperOptions) => Scraper<ScraperCredentials>;

  private readonly _engines: BrowserEngineType[];

  private _progressCallback: ProgressCallback | null = null;

  /**
   * Creates a new ScraperWithFallback.
   *
   * @param options - base scraper options (companyId, startDate, etc.)
   * @param createFn - factory function that constructs a concrete Scraper for given options
   * @param engines - ordered list of engine types to try; defaults to getGlobalEngineChain()
   */
  constructor(
    options: ScraperOptions,
    createFn: (opts: ScraperOptions) => Scraper<ScraperCredentials>,
    engines: BrowserEngineType[] = getGlobalEngineChain(),
  ) {
    this._options = options;
    this._createFn = createFn;
    this._engines = engines;
  }

  /**
   * Registers a progress callback forwarded to each engine's scraper during its run.
   * Matches the Scraper interface so ScraperWithFallback is a transparent drop-in.
   *
   * @param func - callback receiving companyId and progress type on each state change
   */
  public onProgress(func: ProgressCallback): void {
    this._progressCallback = func;
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
   * Scrapes bank transactions, trying each engine in order on WafBlocked only.
   * Collects all attempts; returns the first non-fallback result immediately.
   * If every engine triggers a fallback, returns a rich error listing all attempts.
   *
   * @param credentials - bank login credentials
   * @returns the scraping result (success, non-WAF error, or all-engines-failed rich error)
   */
  public async scrape(credentials: ScraperCredentials): Promise<ScraperScrapingResult> {
    const seed: Promise<ScraperEngineAttempt[]> = Promise.resolve([]);
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
  ): Promise<ScraperScrapingResult> {
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
