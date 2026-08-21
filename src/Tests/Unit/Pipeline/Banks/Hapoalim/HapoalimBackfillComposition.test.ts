/**
 * Hapoalim's own cursor and the generic backfill loop, composed.
 *
 * Two mechanisms now answer the same defect. The shape walks the window itself,
 * reading the bank's declared `numItemsPerPage` to know a page was truncated;
 * the generic loop watches the rows that survive the walk and narrows the bound
 * when they fall short of the requested start. Keeping both is deliberate — the
 * shape is the more precise of the two because it reads the bank's own stated
 * cap rather than inferring truncation after the fact — but two mechanisms that
 * can each move the same bound must be shown not to fight.
 *
 * This exercises the real `txnsExtractPage` against a stand-in bank that caps
 * responses the way Hapoalim does, then hands the result to the real coverage
 * audit and the real decision. Bodies are synthetic and structural only.
 */

import {
  type HapoalimCursor,
  txnsExtractPage,
} from '../../../../../Scrapers/Pipeline/Banks/Hapoalim/scrape/HapoalimShapeTxns.js';
import { assessWindowCoverage } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/CoverageAudit/WindowCoverage.js';
import { buildOverlapMerge } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/OverlapMerge.js';
import { planBackfill } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/WindowBackfill.js';
import type { IExtractPageArgs } from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import type { Option } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import { some } from '../../../../../Scrapers/Pipeline/Types/Option.js';

/** Window start the caller asks for, as the shape reads it. */
const START_DAY = '2026-02-20';

/** Same instant in the form the coverage audit is given. */
const START_ISO = '2026-02-20T00:00:00.000Z';

/** The bank's server-side cap, stated in every response. */
const SERVER_CAP = 3;

/** Bound the first request carried — later than anything the bank holds. */
const FIRST_END: Option<Date> = some(new Date('2026-09-01T00:00:00Z'));

/** Log identity; carries no row content. */
const LABEL = 'hapoalim/txns';

/**
 * Every row the stand-in bank holds, newest first.
 *
 * The oldest lands exactly on {@link START_DAY}, which is what a fully served
 * window looks like: the walk reaches the start and stops there.
 */
const BANK_ROWS: readonly number[] = [20260820, 20260401, 20260317, 20260310, 20260225, 20260220];

/**
 * One synthetic row.
 * @param eventDate - Transaction date as the bank reports it.
 * @returns A synthetic transaction row.
 */
function row(eventDate: number): Record<string, unknown> {
  return { eventDate, eventAmount: 10, activityDescription: 'DEMO' };
}

/**
 * Serve one response the way Hapoalim does: newest first, capped server-side.
 * @param end - Upper bound of the request, or false for the first call.
 * @returns A response body carrying at most {@link SERVER_CAP} rows.
 */
function serve(end: HapoalimCursor | false): Record<string, unknown> {
  const bound = end === false ? '99999999' : String(end);
  const inWindow = BANK_ROWS.filter((date): boolean => String(date) <= bound);
  const capped = inWindow.slice(0, SERVER_CAP);
  return { numItemsPerPage: SERVER_CAP, transactions: capped.map(row) };
}

/**
 * Build the extractor argument bundle for one page.
 * @param body - Response body.
 * @param cursor - Bound that produced it.
 * @returns Args for `txnsExtractPage`.
 */
function argsFor(body: object, cursor: HapoalimCursor | false): IExtractPageArgs<never, never> {
  const ctx = { options: { startDate: new Date(START_DAY) } };
  const bundle = { body, cursor, acct: {}, ctx };
  return bundle as unknown as IExtractPageArgs<never, never>;
}

/**
 * Extract one page from the stand-in bank.
 * @param cursor - Bound to request under.
 * @returns The extracted page and the cursor it owes.
 */
function extractAt(cursor: HapoalimCursor | false): ReturnType<typeof txnsExtractPage> {
  const body = serve(cursor);
  const args = argsFor(body, cursor);
  return txnsExtractPage(args);
}

/**
 * Raised when a test walk exhausts its iteration budget without the shape
 * signalling the end. Throwing rather than returning what was gathered keeps a
 * non-terminating walk from passing as a short but plausible result.
 */
class WalkDidNotTerminateError extends Error {}

/**
 * Run the shape's own walk to exhaustion, joining pages the way production does.
 *
 * The shape declares `pagesMayOverlap`, so the collection loop joins pages with
 * {@link buildOverlapMerge} rather than concatenating. Reaching for the same
 * function here keeps this a test of the real composition: were the declaration
 * dropped, or the merge changed, this walk would double the boundary rows.
 *
 * @returns Every row the walk gathered, in arrival order.
 */
function walkShape(): readonly object[] {
  const merge = buildOverlapMerge(LABEL);
  let cursor: HapoalimCursor | false = false;
  let gathered: readonly object[] = [];
  for (let step = 0; step <= BANK_ROWS.length; step += 1) {
    const extracted = extractAt(cursor);
    gathered = merge(gathered, extracted.items);
    if (extracted.nextCursor === false) return gathered;
    cursor = extracted.nextCursor;
  }
  throw new WalkDidNotTerminateError(
    'walkShape did not terminate — the resume bound stopped making progress',
  );
}

/**
 * A date's calendar day in the local zone.
 *
 * The bound is a local midnight, and the shape formats it with a local
 * formatter. Rendering it as UTC would report the day before for half the
 * year and make the two paths look like they disagree when they do not.
 * @param when - Date to render.
 * @returns Calendar day, `YYYYMMDD`.
 */
function dayOf(when: Date): string {
  const year = when.getFullYear();
  const month = when.getMonth() + 1;
  const day = when.getDate();
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${String(year)}${mm}${dd}`;
}

/**
 * Ask the generic loop what it would do with a given set of rows.
 * @param rows - Rows held so far.
 * @returns The backfill decision.
 */
function decide(rows: readonly object[]): ReturnType<typeof planBackfill> {
  const coverage = assessWindowCoverage({ requestedStart: START_ISO, rows, label: LABEL });
  return planBackfill({
    stance: 'windowEnd',
    coverage,
    attempt: 0,
    previousEnd: FIRST_END,
    label: LABEL,
  });
}

describe('Hapoalim shape walk composed with the generic backfill loop', () => {
  it('gathers the whole window through the shape alone', () => {
    const gathered = walkShape();
    expect(gathered).toHaveLength(BANK_ROWS.length);
  });

  it('leaves the generic loop nothing to ask for', () => {
    const gathered = walkShape();
    const plan = decide(gathered);
    expect(plan.shouldAsk).toBe(false);
  });

  it('says so for the right reason — not because the bank is excluded', () => {
    const gathered = walkShape();
    const plan = decide(gathered);
    expect(plan.reason).toContain('window covered');
  });
});

describe('the generic loop as the safety net beneath the shape walk', () => {
  /** First page only — what a shape that ignored the cap would have returned. */
  const firstPageOnly = serve(false).transactions as readonly object[];

  it('asks again when only the first page was gathered', () => {
    const plan = decide(firstPageOnly);
    expect(plan.shouldAsk).toBe(true);
  });

  it('derives the same bound the shape derives independently', () => {
    const plan = decide(firstPageOnly);
    const generic = plan.nextEnd.has ? dayOf(plan.nextEnd.value) : '';
    const extracted = extractAt(false);
    expect(generic).toBe(extracted.nextCursor);
  });
});

/**
 * A bank whose page cap falls in the middle of a day.
 *
 * {@link BANK_ROWS} holds one row per date, which cannot express the case the
 * cap actually creates: the bank counts rows, not days, so the cut lands
 * part-way through a date whenever that date carries more rows than the page
 * budget left. Two rows share 20260317 here, and the cap of 3 separates them.
 */
const SPLIT_DAY_ROWS: readonly number[] = [20260820, 20260401, 20260317, 20260317, 20260225];

/**
 * Serve from {@link SPLIT_DAY_ROWS} under the same cap the real bank states.
 * @param end - Upper bound of the request, or false for the first call.
 * @returns A response body carrying at most {@link SERVER_CAP} rows.
 */
function serveSplitDay(end: HapoalimCursor | false): Record<string, unknown> {
  const bound = end === false ? '99999999' : String(end);
  const inWindow = SPLIT_DAY_ROWS.filter((date): boolean => String(date) <= bound);
  return { numItemsPerPage: SERVER_CAP, transactions: inWindow.slice(0, SERVER_CAP).map(row) };
}

/**
 * Walk {@link SPLIT_DAY_ROWS} exactly as production walks a real account.
 * @returns Every row the walk gathered.
 */
function walkSplitDay(): readonly object[] {
  const merge = buildOverlapMerge(LABEL);
  let cursor: HapoalimCursor | false = false;
  let gathered: readonly object[] = [];
  for (let step = 0; step <= SPLIT_DAY_ROWS.length; step += 1) {
    const body = serveSplitDay(cursor);
    const pageArgs = argsFor(body, cursor);
    const extracted = txnsExtractPage(pageArgs);
    gathered = merge(gathered, extracted.items);
    if (extracted.nextCursor === false) return gathered;
    cursor = extracted.nextCursor;
  }
  throw new WalkDidNotTerminateError(
    'walkSplitDay did not terminate — the resume bound stopped making progress',
  );
}

describe('a page cap that falls in the middle of a day', () => {
  it('loses none of the rows sharing the boundary date', () => {
    // Resuming at the day *before* the oldest row held would step straight over
    // the second 20260317 row, and nothing downstream would ever report it
    // missing. This is the transaction loss the inclusive re-ask exists to stop.
    const gathered = walkSplitDay();
    expect(gathered).toHaveLength(SPLIT_DAY_ROWS.length);
  });

  it('does not report the re-served rows twice', () => {
    const gathered = walkSplitDay();
    const onBoundary = gathered.filter(
      (r): boolean => (r as { eventDate: number }).eventDate === 20260317,
    );
    expect(onBoundary).toHaveLength(2);
  });
});
