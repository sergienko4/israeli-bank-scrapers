import type { LoginResults } from '../../Scrapers/Base/BaseScraperHelpers.js';
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
 *
 * <p>Typed as `LoginResults` plus the two non-login members actually used,
 * rather than `as const`: a bare `as const` infers a tuple naming
 * `LoginBaseResults`, an enum that is NOT exported from `BaseScraperHelpers`,
 * so exporting the value fails with TS4023. Widening to `string[]`, or to the
 * whole `ScraperErrorTypes` enum, would compile but let `Timeout` back in and
 * silently undo the contract above. `LoginResults` already excludes `Timeout`,
 * so this annotation makes that exclusion a compile error, not a comment.
 */
export const FAILED_LOGIN_TYPES: readonly (
  LoginResults | ScraperErrorTypes.Generic | ScraperErrorTypes.WafBlocked
)[] = [
  LOGIN_RESULTS.InvalidPassword,
  LOGIN_RESULTS.UnknownError,
  ScraperErrorTypes.Generic,
  ScraperErrorTypes.ChangePassword,
  ScraperErrorTypes.WafBlocked,
  ScraperErrorTypes.TwoFactorRetrieverMissing,
];

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
 * Fraction of a cell's budget above which the run is treated as at-risk.
 *
 * <p>0.75 sits above every healthy cell's measured usage and below the 92-100 %
 * band that produced the Otsar Hahayal / Pagi failures, so it fires on a bank
 * drifting toward its cap without firing on normal variance.
 */
export const SMOKE_HEADROOM_WARN_RATIO = 0.75;

/**
 * Report how much of its budget a smoke cell consumed.
 *
 * <p>WHY THIS EXISTS — a cell at 95 % of budget passes green and looks
 * identical to one at 40 %. That is how a matrix with four cells sitting on the
 * cliff was read as "all 17 green". Emitting the ratio, and annotating the
 * at-risk band, turns a silent near-miss into a visible signal one run BEFORE
 * it becomes a red required gate.
 * @param bank - Display name of the bank being reported.
 * @param elapsedMs - Wall time the scrape actually consumed.
 * @param budgetMs - Budget the cell was given.
 * @returns Percentage of the budget consumed, rounded.
 */
export function reportSmokeHeadroom(bank: string, elapsedMs: number, budgetMs: number): number {
  const usedRatio = elapsedMs / budgetMs;
  const usedPct = Math.round(usedRatio * 100);
  process.stdout.write(
    `[smoke] bank=${bank} elapsedMs=${String(elapsedMs)} budgetMs=${String(budgetMs)} used=${String(usedPct)}%\n`,
  );
  if (usedRatio >= SMOKE_HEADROOM_WARN_RATIO) {
    process.stdout.write(
      `::warning title=Smoke budget headroom::${bank} used ${String(usedPct)}% of its budget\n`,
    );
  }
  return usedPct;
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
