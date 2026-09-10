/**
 * E2E gate: every scraped account must publish a window-coverage verdict.
 *
 * <p>Issue #553 asked why a green CI run told nobody that a 90-day request
 * came back with 30 days of data. The answer is that nothing in the E2E
 * assertions ever looked: `assertSuccessfulScrape` checks that transactions
 * exist, never that they span what was asked for. A scrape that silently
 * truncated the window passed every gate.
 *
 * <p>The split here is deliberate. A **missing** verdict is a code regression —
 * the scraper stopped publishing a field it is contracted to publish — and
 * fails. Anything short of `covered` is the provider's behaviour on the day,
 * is legitimately reachable against a live bank, and only warns: reddening CI
 * on it would train everyone to ignore the gate.
 *
 * <p>`lowerBoundReached` warns alongside `unproven` on purpose. It means the
 * window's far edge was reached but a loss channel spoke up, which is exactly
 * the "looks complete, isn't" case #553 was about — silencing it here would
 * reintroduce the blind spot one level up.
 */

import type { ITransactionsAccount } from '../../Transactions.js';
import type { IWindowCoverage } from '../../WindowCoverage.js';

/** One account's verdict, paired with the account that carries it. */
interface IAccountVerdict {
  readonly account: string;
  readonly coverage: IWindowCoverage | 'absent';
}

/**
 * Pair each account with its verdict, or the marker for a missing one.
 * @param accounts - Accounts from the scrape result.
 * @returns One entry per account, in result order.
 */
function verdictsOf(accounts: readonly ITransactionsAccount[]): readonly IAccountVerdict[] {
  return accounts.map((a): IAccountVerdict => {
    const coverage = a.windowCoverage ?? 'absent';
    return { account: a.accountNumber, coverage };
  });
}

/**
 * Accounts that published no verdict at all.
 * @param verdicts - Paired accounts and verdicts.
 * @returns Account numbers with no verdict.
 */
function missing(verdicts: readonly IAccountVerdict[]): readonly string[] {
  const absent = verdicts.filter((v): boolean => v.coverage === 'absent');
  return absent.map((v): string => v.account);
}

/**
 * Why a verdict fell short of `covered`, in the verdict's own words.
 * @param coverage - A verdict that is not `covered`.
 * @returns The reason, or the caveats that blocked `covered`.
 */
function shortfallOf(coverage: IWindowCoverage): string {
  if (coverage.status === 'unproven') return coverage.reason;
  if (coverage.status === 'lowerBoundReached') return coverage.caveats.join(', ');
  return '';
}

/**
 * Render one less-than-covered verdict as a human-readable line.
 * @param verdict - The account and its verdict.
 * @returns A single warning line, empty when the window was fully covered.
 */
function describeShortfall(verdict: IAccountVerdict): string {
  const c = verdict.coverage;
  if (c === 'absent') return '';
  const why = shortfallOf(c);
  if (why.length === 0) return '';
  return `  ${verdict.account}: ${c.status} — ${why} (requested from ${c.requestedStart})`;
}

/**
 * Warning lines for every account whose window fell short of `covered`.
 * @param verdicts - Paired accounts and verdicts.
 * @returns One line per account that could not claim a covered window.
 */
function shortfallLines(verdicts: readonly IAccountVerdict[]): readonly string[] {
  const lines = verdicts.map(describeShortfall);
  return lines.filter((l): boolean => l.length > 0);
}

/** Outcome of the gate — what failed, and what merely deserves a warning. */
export interface ICoverageGateReport {
  /** Accounts that published no verdict. Non-empty means a regression. */
  readonly missing: readonly string[];
  /** Human-readable lines for accounts that could not claim a covered window. */
  readonly warnings: readonly string[];
}

/**
 * Inspect a scrape's accounts without asserting, so the same logic can be
 * unit-tested with fixtures and reused by the assertion below.
 * @param accounts - Accounts from the scrape result.
 * @returns What the gate found.
 */
export function inspectWindowCoverage(
  accounts: readonly ITransactionsAccount[],
): ICoverageGateReport {
  const verdicts = verdictsOf(accounts);
  return { missing: missing(verdicts), warnings: shortfallLines(verdicts) };
}

/**
 * Emit the warning block for windows the scrape could not prove.
 * @param warnings - Lines produced by {@link inspectWindowCoverage}.
 * @returns True when anything was emitted.
 */
function warn(warnings: readonly string[]): boolean {
  if (warnings.length === 0) return false;
  const body = warnings.join('\n');
  console.warn(`⚠️  window coverage short of 'covered' — rows may be missing:\n${body}`);
  return true;
}

/**
 * Assert every account published a verdict; warn on any it could not prove.
 * @param accounts - Accounts from the scrape result.
 * @returns True when every account published a verdict.
 */
export function assertWindowCoverage(accounts: readonly ITransactionsAccount[]): boolean {
  const report = inspectWindowCoverage(accounts);
  warn(report.warnings);
  expect(report.missing).toEqual([]);
  return true;
}
