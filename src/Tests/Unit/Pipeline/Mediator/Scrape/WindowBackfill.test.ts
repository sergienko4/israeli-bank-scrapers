/**
 * Backfill planning — when a coverage gap earns another request, and when it
 * cannot.
 *
 * The decision is the whole safety story of the backfill loop: it is what
 * stops a narrowing walk from running forever against a provider, and what
 * keeps banks whose window cannot be narrowed from being asked pointlessly.
 * These cases pin every exit.
 */

import type { IWindowResult } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/CoverageAudit/WindowCoverage.js';
import {
  type IBackfillPlanArgs,
  MAX_BACKFILL_ASKS,
  planBackfill,
} from '../../../../../Scrapers/Pipeline/Mediator/Scrape/WindowBackfill.js';
import type { Option } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import { isSome, none, some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type { WindowNarrowing } from '../../../../../Scrapers/Pipeline/Types/WindowNarrowing.js';

/**
 * A shortfall verdict reaching back only as far as the given day.
 * @param oldest - Calendar day of the oldest row held.
 * @returns An uncovered window result.
 */
function gapTo(oldest: string): IWindowResult {
  return { verdict: 'unproven', oldest, gapDays: 30 };
}

/**
 * Plan args with sensible defaults for a backfillable bank.
 * @param over - Fields to override.
 * @returns Complete plan args.
 */
function argsFor(over: Partial<IBackfillPlanArgs> = {}): IBackfillPlanArgs {
  const coverage = gapTo('2026-04-01');
  const previousEnd: Option<Date> = none();
  return { stance: 'windowEnd', coverage, attempt: 0, previousEnd, label: 'demo/txns', ...over };
}

describe('planBackfill/asks again', () => {
  it('re-asks the oldest day held, inclusively', () => {
    const args = argsFor();
    const plan = planBackfill(args);
    expect(plan.shouldAsk).toBe(true);
    // Inclusive on purpose: a row-count cap can cut part-way through a day, so
    // resuming the day before would step over the rows it withheld. The
    // re-served rows are dropped by raw identity in dropOverlap.
    const bound = isSome(plan.nextEnd) ? plan.nextEnd.value : new Date(0);
    const asDay = [bound.getFullYear(), bound.getMonth(), bound.getDate()];
    expect(asDay).toEqual([2026, 3, 1]);
  });

  it('puts the bound at the end of that day, not its start', () => {
    // Seven of the eight backfillable banks render the bound day-granularly, to
    // which the time is invisible. Leumi puts it on the wire as an RFC-1123
    // instant, so a start-of-day bound would exclude that whole day.
    const args = argsFor();
    const plan = planBackfill(args);
    const fallback = new Date(0);
    const bound = isSome(plan.nextEnd) ? plan.nextEnd.value : fallback;
    const hours = bound.getHours();
    const minutes = bound.getMinutes();
    expect(hours).toBe(23);
    expect(minutes).toBe(59);
  });

  it('names the new bound in the reason it logs', () => {
    const args = argsFor();
    const plan = planBackfill(args);
    expect(plan.reason).toContain('2026-04-01');
  });
});

describe('planBackfill/stops', () => {
  it('stops once the window is covered', () => {
    const covered: IWindowResult = { verdict: 'covered', oldest: '2026-01-01', gapDays: 0 };
    const args = argsFor({ coverage: covered });
    const plan = planBackfill(args);
    expect(plan.shouldAsk).toBe(false);
    expect(plan.reason).toContain('covered');
  });

  it('stops when no row carried a date to narrow against', () => {
    const undatable: IWindowResult = { verdict: 'unproven', oldest: '', gapDays: 0 };
    const args = argsFor({ coverage: undatable });
    const plan = planBackfill(args);
    expect(plan.shouldAsk).toBe(false);
    expect(plan.reason).toContain('usable date');
  });

  it('stops at the request ceiling rather than walking forever', () => {
    const args = argsFor({ attempt: MAX_BACKFILL_ASKS });
    const plan = planBackfill(args);
    const ceiling = String(MAX_BACKFILL_ASKS);
    expect(plan.shouldAsk).toBe(false);
    expect(plan.reason).toContain(ceiling);
  });

  it('stops when the derived bound is not earlier than the one just used', () => {
    // The previous request already ended on 2026-03-31 and returned nothing
    // older, so narrowing again would repeat that exact request.
    const previousEnd = some(new Date('2026-03-31T00:00:00'));
    const args = argsFor({ previousEnd });
    const plan = planBackfill(args);
    expect(plan.shouldAsk).toBe(false);
    expect(plan.reason).toContain('did not move');
  });
});

describe('planBackfill/stance', () => {
  const excluded: readonly WindowNarrowing[] = [
    'periodEnumeration',
    'lowerBoundOnly',
    'providerCursor',
  ];

  it.each(excluded)('does not ask a %s bank, and says why', stance => {
    const args = argsFor({ stance });
    const plan = planBackfill(args);
    expect(plan.shouldAsk).toBe(false);
    expect(plan.reason.length).toBeGreaterThan('gapDays=30 — '.length);
  });

  it('reports the gap alongside every refusal, so it is never silent', () => {
    const args = argsFor({ stance: 'lowerBoundOnly' });
    const plan = planBackfill(args);
    expect(plan.reason).toContain('gapDays=30');
  });
});

describe('planBackfill/kill switch', () => {
  // Restore rather than delete: an operator running the suite with the switch
  // already set would otherwise have it silently cleared for every later test.
  const original = process.env.WINDOW_BACKFILL;

  afterEach(() => {
    if (original === undefined) delete process.env.WINDOW_BACKFILL;
    else process.env.WINDOW_BACKFILL = original;
  });

  it('issues no extra request when an operator turns backfill off', () => {
    process.env.WINDOW_BACKFILL = 'off';
    const args = argsFor();
    const plan = planBackfill(args);
    expect(plan.shouldAsk).toBe(false);
    expect(plan.reason).toContain('WINDOW_BACKFILL=off');
  });

  it('stays on for any other value, so a typo cannot disable it', () => {
    process.env.WINDOW_BACKFILL = 'false';
    const args = argsFor();
    const plan = planBackfill(args);
    expect(plan.shouldAsk).toBe(true);
  });
});
