/**
 * Start-date window — honour the caller's `startDate` on the ApiDirect path.
 *
 * `ScraperOptions.startDate` is a required field meaning "give me transactions
 * from this date onwards", yet no bank on the ApiDirectScrape path applied it.
 * The legacy filter ({@link filterAfterStart}) still exists but nothing reaches
 * it — every registered bank routes through `withApiDirect`, which
 * short-circuits the builder straight to the ApiDirectScrape phase. Callers
 * therefore received whatever the provider happened to return.
 *
 * For card issuers that is not "startDate to today" but whole **billing
 * cycles**, and a cycle carries rows whose purchase date can be far older than
 * the cycle itself — installments and out-of-statement charges. Measured
 * against captured Isracard traffic, a 180-day request returned 15 months of
 * history: 61 of 239 rows predated the window.
 *
 * <p>Lower bound only, deliberately. `futureMonthsToScrape` means callers
 * explicitly ask for charges dated after today — VisaCal's newest billing date
 * sits two weeks past the run date — so an upper bound would delete data the
 * caller requested.
 *
 * <p>Filters on `date` (purchase date). Isracard exposes no distinct billing
 * date, so its mapped `processedDate` is a copy of `date`; windowing on
 * `processedDate` would be identical there and inconsistent elsewhere.
 *
 * <p>Fails open on a row with no usable date — see {@link isUndated}. This is
 * why the legacy `filterAfterStart` is deliberately **not** reused: its
 * `NaN >= startMs` comparison drops such rows silently.
 *
 * <p>Compares **calendar days**, not instants, because the two sides arrive in
 * different calendars. A provider's date-only value ('2026-02-20') is parsed
 * by `parseAutoDate` through *local* midnight, while the documented caller
 * form `new Date('2026-02-20')` is *UTC* midnight. Comparing those as instants
 * puts the row two hours before the bound in Israel and deletes every
 * transaction dated on the very day the caller asked for. Reducing both sides
 * to a local day label is exact wherever the run and the bank share a
 * calendar, and elsewhere errs one day wide — which keeps a row the caller may
 * not have wanted rather than destroying one they did.
 */

import moment from 'moment';

import type { ITransaction } from '../../../../Transactions.js';
import { getDebug } from '../../Logging/Debug.js';

const LOG = getDebug(import.meta.url);

/** Calendar-day label both sides of the comparison are reduced to. */
const DAY = 'YYYY-MM-DD';

/** Inputs for one windowing round. */
export interface IStartWindowArgs {
  /** Mapped transactions for one account, before the window is applied. */
  readonly txns: readonly ITransaction[];
  /** Inclusive lower bound taken from `ScraperOptions.startDate`. */
  readonly startDate: Date;
  /** Bank + step identity for the log line. Never contains row content. */
  readonly label: string;
}

/** Outcome of one windowing round. Counts only — never row content. */
export interface IStartWindowResult {
  /** Rows on or after the window lower bound, plus any row with no usable date. */
  readonly kept: readonly ITransaction[];
  /** Rows the caller never asked for. Above zero is expected on card issuers. */
  readonly dropped: number;
}

/**
 * Resolve the window lower bound as a calendar day.
 *
 * Returns `false` when no usable bound was supplied so the caller can pass the
 * rows through untouched. Dropping every row because a mock omitted `startDate`
 * would turn a test-fixture gap into silent data loss — the exact failure this
 * module exists to prevent.
 *
 * @param startDate - Caller-supplied window lower bound.
 * @returns Local calendar-day label, or `false` when the bound is unusable.
 */
function windowStartDay(startDate: Date): string | false {
  const isDateValue = startDate instanceof Date;
  if (!isDateValue) return false;
  const ms = startDate.getTime();
  const isRealDate = Number.isFinite(ms);
  if (!isRealDate) return false;
  return moment(startDate).format(DAY);
}

/**
 * Build the one-line windowing verdict.
 *
 * @param label - Bank + step identity.
 * @param before - Row count before the window.
 * @param after - Row count after the window.
 * @returns Log message carrying counts only.
 */
function windowMessage(label: string, before: number, after: number): string {
  const dropped = before - after;
  const detail = `before=${String(before)} after=${String(after)} dropped=${String(dropped)}`;
  if (dropped === 0) return `window ${label}: every row in range (${detail})`;
  return `window ${label}: trimmed to requested range (${detail})`;
}

/**
 * Epoch — the sentinel a mapper writes for a date it could not read.
 *
 * `ITransaction.date` is a required ISO string with no representation for
 * "unknown", so a mapper facing an unreadable value must invent one; PayBox's
 * `dateOf` settles on the epoch to keep `toISOString` from throwing.
 */
const UNDATED_MS = 0;

/**
 * Decide whether a parsed row date carries no usable information.
 *
 * Covers both spellings of "unknown": a value that will not parse at all, and
 * the epoch sentinel a mapper substitutes for one. No real transaction predates
 * 1970 and no caller's `startDate` does either, so such a value says nothing
 * about the caller's window.
 *
 * @param ms - Row date as epoch milliseconds.
 * @returns True when the date is unreadable or the undated sentinel.
 */
function isUndated(ms: number): boolean {
  const isReadable = Number.isFinite(ms);
  if (!isReadable) return true;
  return ms <= UNDATED_MS;
}

/**
 * Decide whether one row survives the window.
 *
 * <p>Fails **open**: a row with no usable date is kept. The legacy
 * `filterAfterStart` compares `NaN >= startMs`, which is always false, so an
 * unparseable row is dropped without trace. That is the same silent-loss defect
 * this module was written to stop — a row we cannot classify has not been
 * *proven* out of window, and deleting unclassifiable data is strictly worse
 * than returning it. The mapper-reject counter already watches for rows arriving
 * without usable fields.
 *
 * @param txn - Mapped transaction under test.
 * @param startDay - Inclusive window lower bound as a local day label.
 * @returns True when the row is in window or carries no usable date.
 */
function isInWindow(txn: ITransaction, startDay: string): boolean {
  const parsed = moment(txn.date, moment.ISO_8601);
  const ms = parsed.valueOf();
  if (isUndated(ms)) return true;
  const day = parsed.format(DAY);
  return day >= startDay;
}

/**
 * Keep only the rows the caller's window admits.
 *
 * @param txns - Mapped transactions for one account.
 * @param startDay - Inclusive window lower bound as a local day label.
 * @returns Rows on or after the bound, plus any row with no usable date.
 */
function filterToWindow(txns: readonly ITransaction[], startDay: string): readonly ITransaction[] {
  return txns.filter((t): boolean => isInWindow(t, startDay));
}

/**
 * Emit the windowing verdict.
 *
 * <p>Debug level by design. Card issuers trim rows on every run, so a warning
 * here would fire forever and train reviewers to ignore it. The one genuinely
 * actionable case — a window that removes *every* row, which means either a
 * mistaken `startDate` or an account with no recent activity — warns.
 *
 * @param label - Bank + step identity.
 * @param before - Row count before the window.
 * @param after - Row count after the window.
 * @returns True once the verdict is emitted.
 */
function reportWindow(label: string, before: number, after: number): true {
  const message = windowMessage(label, before, after);
  const isTotalWipe = before > 0 && after === 0;
  if (isTotalWipe) LOG.warn({ message });
  else LOG.debug({ message });
  return true;
}

/**
 * Drop transactions dated before the caller's requested window.
 *
 * @param args - Transactions, window bound and log identity.
 * @returns In-window transactions plus the dropped count.
 */
export function applyStartWindow(args: IStartWindowArgs): IStartWindowResult {
  const startDay = windowStartDay(args.startDate);
  if (startDay === false) return { kept: args.txns, dropped: 0 };
  const kept = filterToWindow(args.txns, startDay);
  const before = args.txns.length;
  reportWindow(args.label, before, kept.length);
  return { kept, dropped: before - kept.length };
}
