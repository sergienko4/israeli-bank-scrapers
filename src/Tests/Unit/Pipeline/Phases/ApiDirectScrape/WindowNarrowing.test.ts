/**
 * Cross-bank contract: every `windowNarrowing` declaration must be true.
 *
 * The backfill loop trusts this declaration to decide whether a coverage gap
 * can be closed by re-asking for an older slice. A wrong declaration fails in
 * the worst possible way — silently, by looping without ever changing the
 * request, or by skipping a bank that could in fact have been backfilled.
 *
 * So the contract checks the claim in BOTH directions against the real shapes:
 * a bank that claims `windowEnd` must issue different requests when the bound
 * moves, and a bank that claims it cannot narrow must issue the same ones.
 * Neither can be satisfied by a comment.
 *
 * The walk is sampled rather than the first request alone. Banks that chunk
 * the window (Yahav) or enumerate billing months (Isracard, Amex, Max,
 * VisaCal) always open at the *start* of the window, so a first-request check
 * would clear every one of them regardless of the truth — which is exactly
 * what it did before this contract was widened.
 */

import type { WindowNarrowing } from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import {
  ctxBoundedAt,
  ctxUnbounded,
  EARLY_END,
  LATE_END,
  renderWalk,
  WINDOW_NARROWING_CASES,
} from './WindowNarrowingFixtures.js';

const NARROWABLE = WINDOW_NARROWING_CASES.filter(c => c.txns.windowNarrowing === 'windowEnd');
const FIXED = WINDOW_NARROWING_CASES.filter(c => c.txns.windowNarrowing !== 'windowEnd');
const FIXED_REASONS: readonly WindowNarrowing[] = [
  'periodEnumeration',
  'lowerBoundOnly',
  'providerCursor',
];
const NARROWABLE_ROWS = NARROWABLE.map(c => [c.bank, c] as const);
const FIXED_ROWS = FIXED.map(c => [c.bank, c] as const);
const ALL_STANCES: readonly WindowNarrowing[] = ['windowEnd', ...FIXED_REASONS];

describe('window-narrowing contract', () => {
  it('covers every bank in the API-direct scrape phase', () => {
    expect(WINDOW_NARROWING_CASES).toHaveLength(16);
  });

  it('declares a known stance for every bank', () => {
    const declared = WINDOW_NARROWING_CASES.map(c => c.txns.windowNarrowing);
    const unknownStances = declared.filter(stance => !ALL_STANCES.includes(stance));
    expect(unknownStances).toEqual([]);
  });

  it('splits the banks between narrowable and fixed', () => {
    expect(NARROWABLE).toHaveLength(8);
    expect(FIXED).toHaveLength(8);
  });
});

describe('banks declaring windowEnd', () => {
  it.each(NARROWABLE_ROWS)('[%s] moving the bound changes the requests', (_bank, testCase) => {
    const earlyCtx = ctxBoundedAt(EARLY_END);
    const lateCtx = ctxBoundedAt(LATE_END);
    const early = renderWalk(testCase.txns, earlyCtx);
    const late = renderWalk(testCase.txns, lateCtx);
    expect(early).not.toEqual(late);
  });

  it.each(NARROWABLE_ROWS)(
    '[%s] an absent bound reaches further than a past one',
    (_bank, testCase) => {
      const boundedCtx = ctxBoundedAt(EARLY_END);
      const openCtx = ctxUnbounded();
      const bounded = renderWalk(testCase.txns, boundedCtx);
      const unbounded = renderWalk(testCase.txns, openCtx);
      expect(bounded).not.toEqual(unbounded);
    },
  );
});

describe('banks that cannot narrow within a gap', () => {
  it.each(FIXED_ROWS)('[%s] declares why it cannot', (_bank, testCase) => {
    expect(FIXED_REASONS).toContain(testCase.txns.windowNarrowing);
  });

  it.each(FIXED_ROWS)('[%s] moving the bound cannot reach inside a gap', (_bank, testCase) => {
    const earlyCtx = ctxBoundedAt(EARLY_END);
    const lateCtx = ctxBoundedAt(LATE_END);
    const early = renderWalk(testCase.txns, earlyCtx);
    const late = renderWalk(testCase.txns, lateCtx);
    expect(early).toEqual(late);
  });
});
