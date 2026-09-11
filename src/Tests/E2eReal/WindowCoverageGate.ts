/**
 * E2E gate: every scraped account must publish a window-coverage verdict.
 *
 * <p>Issue #553 asked why a green CI run told nobody that a 90-day request
 * came back with 30 days of data. The answer is that nothing in the E2E
 * assertions ever looked: `assertSuccessfulScrape` checks that transactions
 * exist, never that they span what was asked for. A scrape that silently
 * truncated the window passed every gate.
 *
 * <p>A **missing** verdict is a code regression and fails. Direct loss evidence
 * warns. Unavailable audits and unresolved completeness remain visible through
 * one informational summary, because warning on routine uncertainty would
 * train everyone to ignore the signal.
 *
 * <p>A `lowerBoundReached` verdict can carry both classes at once. Each caveat
 * is routed independently so an unavailable audit never masquerades as
 * observed loss, while a real loss signal on the same account still warns.
 */

import { maskAccount } from '../../Common/ResultFormatter.js';
import type { ITransactionsAccount } from '../../Transactions.js';
import type { IWindowCoverage, WindowCaveat, WindowUnprovenReason } from '../../WindowCoverage.js';

/** Output severity for a non-covered observation. */
type CoverageSignal = 'warning' | 'information';

const WARNING: CoverageSignal = 'warning';
const INFORMATION: CoverageSignal = 'information';

/** Every caveat classified explicitly so a new one cannot inherit a severity. */
const CAVEAT_SIGNAL: Readonly<Record<WindowCaveat, CoverageSignal>> = Object.freeze({
  paginationStoppedEarly: WARNING,
  declaredRowShortfall: WARNING,
  declaredRowAuditUnavailable: INFORMATION,
  extractionShortfall: WARNING,
  extractionAuditUnavailable: INFORMATION,
  mappingRejectedRows: WARNING,
  walkOrderViolated: WARNING,
});

/** Unproven reasons express uncertainty, not direct evidence that rows were lost. */
const UNPROVEN_SIGNAL: Readonly<Record<WindowUnprovenReason, CoverageSignal>> = Object.freeze({
  noRowCarriedAUsableDate: INFORMATION,
  requestedStartUnreadable: INFORMATION,
  backfillCeilingReached: INFORMATION,
  backfillNotSupportedForBank: INFORMATION,
  backfillDisabled: INFORMATION,
  boundDidNotMove: INFORMATION,
});

/** One account's verdict, paired with the account that carries it. */
interface IAccountVerdict {
  /** Masked account label — this reaches CI logs, so never the raw number. */
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
    return { account: maskAccount(a.accountNumber), coverage };
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
 * Why a verdict belongs on one severity channel, in its own words.
 * @param coverage - A verdict that is not `covered`.
 * @param signal - Severity channel being rendered.
 * @returns Matching reason or caveats, or empty when none belong there.
 */
function shortfallOf(coverage: IWindowCoverage, signal: CoverageSignal): string {
  if (coverage.status === 'unproven') {
    return UNPROVEN_SIGNAL[coverage.reason] === signal ? coverage.reason : '';
  }
  if (coverage.status === 'lowerBoundReached') {
    return coverage.caveats.filter((c): boolean => CAVEAT_SIGNAL[c] === signal).join(', ');
  }
  return '';
}

/**
 * Render one less-than-covered verdict as a human-readable line.
 * @param verdict - The account and its verdict.
 * @param signal - Severity channel being rendered.
 * @returns One matching line, empty when this channel has nothing to report.
 */
function describeShortfall(verdict: IAccountVerdict, signal: CoverageSignal): string {
  const c = verdict.coverage;
  if (c === 'absent') return '';
  const why = shortfallOf(c, signal);
  if (why.length === 0) return '';
  return `  ${verdict.account}: ${c.status} — ${why} (requested from ${c.requestedStart})`;
}

/**
 * Lines for every account carrying evidence at one severity.
 * @param verdicts - Paired accounts and verdicts.
 * @param signal - Severity channel being collected.
 * @returns One line per matching account observation.
 */
function shortfallLines(
  verdicts: readonly IAccountVerdict[],
  signal: CoverageSignal,
): readonly string[] {
  const lines = verdicts.map((v): string => describeShortfall(v, signal));
  return lines.filter((l): boolean => l.length > 0);
}

/** Outcome of the gate, separated by operational severity. */
export interface ICoverageGateReport {
  /** Accounts that published no verdict. Non-empty means a regression. */
  readonly missing: readonly string[];
  /** Accounts carrying direct evidence that rows may have been lost. */
  readonly warnings: readonly string[];
  /** Accounts whose completeness remains uncertain without direct loss evidence. */
  readonly information: readonly string[];
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
  const warnings = shortfallLines(verdicts, WARNING);
  const information = shortfallLines(verdicts, INFORMATION);
  return { missing: missing(verdicts), warnings, information };
}

/**
 * Emit the warning block for direct row-loss evidence.
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
 * Emit one structured summary for uncertainty that is not direct loss.
 * @param information - Lines produced by {@link inspectWindowCoverage}.
 * @returns True when anything was emitted.
 */
function inform(information: readonly string[]): boolean {
  if (information.length === 0) return false;
  console.info({
    eventName: 'windowCoverageUnproven',
    message: 'The listed coverage observations are uncertainty signals, not direct loss evidence.',
    observations: information,
  });
  return true;
}

/**
 * Assert every account published a verdict and emit calibrated evidence.
 * @param accounts - Accounts from the scrape result.
 * @returns True when every account published a verdict.
 */
export function assertWindowCoverage(accounts: readonly ITransactionsAccount[]): boolean {
  const report = inspectWindowCoverage(accounts);
  warn(report.warnings);
  inform(report.information);
  expect(report.missing).toEqual([]);
  return true;
}
