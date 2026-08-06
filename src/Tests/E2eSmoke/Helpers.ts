import { LOGIN_RESULTS } from '../../Scrapers/Base/BaseScraperWithBrowser.js';
import { ScraperErrorTypes } from '../../Scrapers/Base/Errors.js';
import type { IScraperScrapingResult } from '../../Scrapers/Base/Interface.js';
import { CI_BROWSER_ARGS } from '../Config/TestTimingConfig.js';

/** Re-exported smoke-specific timeout — see `SMOKE_TIMEOUT` in
 *  TestTimingConfig.ts for the current value. Caps each invalid-creds
 *  smoke test so CAPTCHA / WAF / network hangs are caught there instead
 *  of running to the SCRAPE_TIMEOUT 15-min budget. */
export { SMOKE_TIMEOUT } from '../Config/TestTimingConfig.js';
export const isCiEnvironment = !!process.env.CI;
export const BROWSER_ARGS = isCiEnvironment ? CI_BROWSER_ARGS : [];

/**
 * Error types that count as a genuine invalid-credential rejection.
 *
 * <p>`Timeout` is deliberately ABSENT. A timeout means the run never reached a
 * login verdict, so accepting it would let a required gate pass without having
 * tested anything — the exact silent-green failure mode the per-bank
 * `smokeTimeoutMs` budgets exist to remove. Raising a budget must surface a
 * real verdict, not convert an external jest timeout into an internal one that
 * scores as a pass.
 *
 * <p>`WafBlocked` and `TwoFactorRetrieverMissing` ARE accepted: both are
 * environmental outcomes of running from a shared CI IP with synthetic
 * credentials, and neither is something a code change can fix. They are
 * reported by `describeSmokeOutcome` so the per-bank mix stays visible rather
 * than silently absorbed.
 */
export const FAILED_LOGIN_TYPES: readonly string[] = [
  LOGIN_RESULTS.InvalidPassword,
  LOGIN_RESULTS.UnknownError,
  ScraperErrorTypes.Generic,
  ScraperErrorTypes.ChangePassword,
  ScraperErrorTypes.WafBlocked,
  ScraperErrorTypes.TwoFactorRetrieverMissing,
] as const;

/**
 * Emit the outcome so CI logs carry the per-bank error-type mix.
 * Without this the suite asserts and discards, leaving no evidence of which
 * banks reach a real credential rejection and which only ever produce an
 * environmental outcome.
 * @param result - The scraper result to describe.
 * @returns The reported error type, or `(none)` when the result carries none.
 */
function describeSmokeOutcome(result: IScraperScrapingResult): string {
  const errorType = result.errorType ?? '(none)';
  process.stdout.write(`[smoke] success=${String(result.success)} errorType=${errorType}\n`);
  return errorType;
}

/**
 * Assert that a scrape result indicates a failed login.
 * @param result - The scraper result to validate.
 * @returns True when all assertions pass.
 */
export function assertFailedLogin(result: IScraperScrapingResult): boolean {
  describeSmokeOutcome(result);
  expect(result.success).toBe(false);
  expect(FAILED_LOGIN_TYPES).toContain(result.errorType);
  return true;
}
