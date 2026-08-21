/**
 * Window-coverage reconciliation — the guardrail that asks whether the provider
 * returned the whole window we asked for.
 *
 * The coverage audit asks "did we read every row the response contained?" and
 * the declared-row audit asks "did the response carry every row it claimed?".
 * Both compare the shape against the body, so both score a truncated response
 * as perfect: if the bank silently drops the oldest half of the window, every
 * row that *did* arrive was read and counted. That blind spot lost a real
 * Hapoalim account four weeks of history (PR #489) with no error and no flag.
 *
 * This audit compares the body against the *request* instead, which is the only
 * question a truncated response cannot answer honestly:
 *
 *   We asked for [startDate … today]. Do the rows reach back to startDate?
 *
 * It reads no provider metadata, so it works on every bank — including the
 * majority that declare neither a page size nor a total. Dates resolve through
 * the shared {@link WK.date} aliases, so a bank adopts this by existing.
 *
 * `unproven` is deliberately not `truncated`: a quiet account and a capped one
 * look identical from one response. Only re-requesting the uncovered slice
 * separates them, which is why the verdict names the doubt rather than a
 * diagnosis. See docs/observability/coverage-audit.md.
 */

import moment from 'moment';

import { getDebug } from '../../../Logging/Debug.js';
import { PIPELINE_WELL_KNOWN_TXN_FIELDS as WK } from '../../../Registry/WK/ScrapeWK.js';
import { findFieldValue } from '../BfsFieldSearch/BfsFieldSearch.js';
import { parseAutoDate } from '../Coercion/Coercion.js';

const LOG = getDebug(import.meta.url);

/**
 * Whether the returned rows prove the requested window was fully served.
 *
 * `covered` means the oldest row sits at or before the requested start, so
 * nothing older can have been withheld. `unproven` means it does not — the
 * account may simply be quiet, or the provider may have truncated.
 */
export type WindowVerdict = 'covered' | 'unproven';

/** Inputs for one window-coverage reconciliation. */
export interface IWindowArgs {
  /** Requested window start, as the caller asked for it. */
  readonly requestedStart: string;
  /** Every row the account has yielded so far, across all asks. */
  readonly rows: readonly object[];
  /** Bank + step identity for the log line. Never contains row content. */
  readonly label: string;
}

/** Outcome of one reconciliation. Dates and counts only — never row content. */
export interface IWindowResult {
  /** Whether the window is provably served. */
  readonly verdict: WindowVerdict;
  /** Calendar day of the oldest row, or empty when no row carried a date. */
  readonly oldest: string;
  /** Days between the requested start and the oldest row. Zero when covered. */
  readonly gapDays: number;
}

/** Verdict when a page proves nothing about the window's older end. */
const UNPROVEN_EMPTY: IWindowResult = { verdict: 'unproven', oldest: '', gapDays: 0 };

/**
 * Calendar-day form. Banks reason in local calendar days, not instants, and an
 * instant would shift the day across the UTC boundary — enough to re-request or
 * skip a day once the backfill bound is derived from `oldest`.
 */
const DAY = 'YYYY-MM-DD';

/**
 * One row's transaction day, resolved through the shared WK aliases.
 *
 * Returns empty rather than a guess when the row carries no recognised date
 * field: a row we cannot date must never be allowed to certify coverage.
 *
 * @param row - One extracted transaction row.
 * @returns Calendar day, or empty when the row carries no usable date.
 */
function rowDay(row: object): string {
  const record = row as Record<string, unknown>;
  const hit = findFieldValue(record, WK.date);
  if (hit === false) return '';
  const raw = String(hit);
  const iso = parseAutoDate(raw);
  const asMoment = moment(iso, moment.ISO_8601, true);
  return asMoment.isValid() ? asMoment.format(DAY) : '';
}

/**
 * The earliest day across a page's rows. Calendar days sort lexicographically,
 * so the reduction needs no date parsing.
 *
 * @param rows - Rows the shape extracted.
 * @returns Calendar day of the oldest row, or empty when none could be dated.
 */
function oldestOf(rows: readonly object[]): string {
  const days = rows.map(rowDay);
  const usable = days.filter((d): boolean => d !== '');
  if (usable.length === 0) return '';
  const [first] = usable;
  return usable.reduce((a, b): string => (a < b ? a : b), first);
}

/**
 * Whole days from the requested start up to the oldest row returned.
 *
 * Both sides are reduced to calendar days first, so a start expressed as an
 * instant cannot truncate the difference by a partial day.
 *
 * @param requestedStart - Requested window start.
 * @param oldest - Calendar day of the oldest row.
 * @returns Day count, never negative.
 */
function gapOf(requestedStart: string, oldest: string): number {
  const startDay = moment(requestedStart).format(DAY);
  const from = moment(startDay, DAY);
  const to = moment(oldest, DAY);
  const days = to.diff(from, 'days');
  return Math.max(days, 0);
}

/**
 * Build the one-line window verdict.
 * @param label - Bank + step identity.
 * @param result - Dates and counts for the page.
 * @returns Log message carrying no row content.
 */
function windowMessage(label: string, result: IWindowResult): string {
  if (result.verdict === 'covered') return `window ${label}: covered`;
  if (result.oldest === '') return `window ${label}: UNPROVEN — no row carried a usable date`;
  const gap = `gapDays=${String(result.gapDays)}`;
  return `window ${label}: UNPROVEN — oldest=${result.oldest} ${gap}`;
}

/**
 * Emit the verdict. Dates, counts and the caller's label only, per
 * logging-pii-guidlines.md.
 *
 * <p>`unproven` warns rather than errors because it is a question, not a
 * finding: the backfill that follows is what turns it into an answer.
 *
 * @param label - Bank + step identity.
 * @param result - Dates and counts for the page.
 * @returns The same result, so callers report and return in one step.
 */
function reportWindow(label: string, result: IWindowResult): IWindowResult {
  const message = windowMessage(label, result);
  if (result.verdict === 'covered') LOG.debug({ message });
  else LOG.warn({ message });
  return result;
}

/**
 * Compare the rows a page carried against the window that was requested.
 *
 * Reports only; never repairs. An empty page and a page whose rows carry no
 * usable date both yield `unproven`, never `covered` — absence of evidence is
 * not evidence the window was served.
 *
 * @param args - Requested start, extracted rows, and log identity.
 * @returns Verdict plus the uncovered gap.
 */
export function assessWindowCoverage(args: IWindowArgs): IWindowResult {
  const oldest = oldestOf(args.rows);
  if (oldest === '') return reportWindow(args.label, UNPROVEN_EMPTY);
  const gapDays = gapOf(args.requestedStart, oldest);
  const isCovered = gapDays === 0;
  const verdict: WindowVerdict = isCovered ? 'covered' : 'unproven';
  return reportWindow(args.label, { verdict, oldest, gapDays });
}
