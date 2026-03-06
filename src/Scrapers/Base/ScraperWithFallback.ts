import { BrowserEngineType } from '../../Common/BrowserEngine';
import { getDebug } from '../../Common/Debug';
import { ScraperErrorTypes } from './ErrorTypes';
import type {
  Scraper,
  ScraperCredentials,
  ScraperOptions,
  ScraperScrapingResult,
} from './Interface';

const LOG = getDebug('scraper-with-fallback');

/** Error types that trigger a fallback to the next engine (WAF block or timeout). */
const FALLBACK_ERRORS = new Set<ScraperErrorTypes>([
  ScraperErrorTypes.WafBlocked,
  ScraperErrorTypes.Timeout,
]);

/** Default fallback chain: stealth → rebrowser → patchright. */
export const DEFAULT_ENGINE_CHAIN: BrowserEngineType[] = [
  BrowserEngineType.PlaywrightStealth,
  BrowserEngineType.Rebrowser,
  BrowserEngineType.Patchright,
];

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
 * A scraper wrapper that tries multiple browser engines in order,
 * falling back to the next engine when the current one returns WafBlocked or Timeout.
 *
 * @example
 * const scraper = new ScraperWithFallback(
 *   options,
 *   createScraper,
 *   [BrowserEngineType.PlaywrightStealth, BrowserEngineType.Rebrowser],
 * );
 * const result = await scraper.scrape(credentials);
 */
export class ScraperWithFallback {
  private readonly _options: ScraperOptions;

  private readonly _createFn: (opts: ScraperOptions) => Scraper<ScraperCredentials>;

  private readonly _engines: BrowserEngineType[];

  /**
   * Creates a new ScraperWithFallback.
   *
   * @param options - base scraper options (companyId, startDate, etc.)
   * @param createFn - factory function that constructs a concrete Scraper for given options
   * @param engines - ordered list of engine types to try; defaults to DEFAULT_ENGINE_CHAIN
   */
  constructor(
    options: ScraperOptions,
    createFn: (opts: ScraperOptions) => Scraper<ScraperCredentials>,
    engines: BrowserEngineType[] = DEFAULT_ENGINE_CHAIN,
  ) {
    this._options = options;
    this._createFn = createFn;
    this._engines = engines;
  }

  /**
   * Scrapes bank transactions, trying each engine in order on WafBlocked/Timeout.
   * Returns the first successful result, or the last failure if all engines fail.
   *
   * @param credentials - bank login credentials
   * @returns the scraping result (success or last-engine failure)
   */
  public async scrape(credentials: ScraperCredentials): Promise<ScraperScrapingResult> {
    const notStartedError = ScraperErrorTypes.WafBlocked;
    const notStarted: ScraperScrapingResult = { success: false, errorType: notStartedError };
    const seed: Promise<ScraperScrapingResult> = Promise.resolve(notStarted);
    return this._engines.reduce(async (prev, engine) => {
      const prior = await prev;
      if (!shouldFallback(prior)) return prior;
      return this.tryEngine(engine, credentials);
    }, seed);
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
      return await this._createFn(engineOpts).scrape(credentials);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      LOG.info('engine %s threw: %s', engine, msg);
      return { success: false, errorType: ScraperErrorTypes.Generic, errorMessage: msg };
    }
  }
}
