import { LOGIN_RESULTS } from '../../Scrapers/Base/BaseScraperWithBrowser.js';
import { ScraperErrorTypes } from '../../Scrapers/Base/Errors.js';
import type { IScraperScrapingResult } from '../../Scrapers/Base/Interface.js';
import { CI_BROWSER_ARGS } from '../Config/TestTimingConfig.js';

/** Re-exported smoke-specific timeout — 90s per-test cap so invalid-creds
 *  rejections complete fast and CAPTCHA / WAF / network hangs are caught
 *  in 90s instead of the SCRAPE_TIMEOUT 15-min budget. */
export { SMOKE_TIMEOUT } from '../Config/TestTimingConfig.js';
export const isCiEnvironment = !!process.env.CI;
export const BROWSER_ARGS = isCiEnvironment ? CI_BROWSER_ARGS : [];

/** Error types that indicate a valid failure for invalid-credential smoke tests. */
export const FAILED_LOGIN_TYPES: string[] = [
  LOGIN_RESULTS.InvalidPassword,
  LOGIN_RESULTS.UnknownError,
  ScraperErrorTypes.Generic,
  ScraperErrorTypes.Timeout,
  ScraperErrorTypes.ChangePassword,
  ScraperErrorTypes.WafBlocked,
  ScraperErrorTypes.TwoFactorRetrieverMissing,
];

/**
 * Assert that a scrape result indicates a failed login.
 * @param result - The scraper result to validate.
 * @returns True when all assertions pass.
 */
export function assertFailedLogin(result: IScraperScrapingResult): boolean {
  expect(result.success).toBe(false);
  expect(FAILED_LOGIN_TYPES).toContain(result.errorType);
  return true;
}
