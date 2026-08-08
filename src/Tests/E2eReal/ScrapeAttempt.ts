import { type CompanyTypes, createScraper } from '../../index.js';
import type {
  IAuthFlowInfo,
  IScraperScrapingResult,
  ScraperCredentials,
  ScraperOptions,
} from '../../Scrapers/Base/Interface.js';
import { BROWSER_ARGS, defaultStartDate } from './Helpers.js';

/**
 * Runs one real-bank scrape and resolves with its result.
 *
 * <p>Each invocation builds a FRESH scraper (and therefore a fresh
 * browser), so a warm-path failure cannot leak session state into the
 * cold-path retry driven by {@link scrapeWithWarmFallback}.
 * @param creds - Warm or cold credential shape.
 * @returns Scrape result.
 */
type ScrapeAttempt = (creds: ScraperCredentials) => Promise<IScraperScrapingResult>;

/**
 * Bank-specific configuration for a scrape attempt.
 */
interface IScrapeAttemptArgs {
  /** Bank under test. */
  readonly companyId: CompanyTypes;
  /** Token-cache writer bound to `ScraperOptions.onAuthFlowComplete`. */
  readonly onAuthFlowComplete: (info: IAuthFlowInfo) => Promise<void>;
}

/**
 * Build the scraper options shared by every OTP-bank E2E attempt.
 * @param args - Bank-specific configuration.
 * @returns Options for a single headless attempt.
 */
function buildAttemptOptions(args: IScrapeAttemptArgs): ScraperOptions {
  return {
    companyId: args.companyId,
    startDate: defaultStartDate(),
    shouldShowBrowser: false,
    args: BROWSER_ARGS,
    onAuthFlowComplete: args.onAuthFlowComplete,
  };
}

/**
 * Build the per-attempt scrape runner for one OTP bank.
 *
 * <p>Pepper, OneZero and PayBox all drive the same warm-then-cold
 * fallback, so the only thing that varies between them is the bank id
 * and the cache writer. Sharing one factory keeps those three suites
 * from drifting apart.
 * @param args - Bank-specific configuration.
 * @returns Attempt callback for {@link scrapeWithWarmFallback}.
 */
function createScrapeAttempt(args: IScrapeAttemptArgs): ScrapeAttempt {
  return (creds: ScraperCredentials): Promise<IScraperScrapingResult> => {
    const options = buildAttemptOptions(args);
    const scraper = createScraper(options);
    return scraper.scrape(creds);
  };
}

export { createScrapeAttempt };
export type { IScrapeAttemptArgs, ScrapeAttempt };
