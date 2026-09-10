/**
 * The three-state window verdict, and the RED cases that define it.
 *
 * The classifier is the one place the scrape decides what it may claim about
 * the window it was asked for, so the properties it must not break are here
 * rather than spread across the walk's integration tests:
 *
 * - `covered` requires BOTH the start date being reached AND every guardrail
 *   staying quiet. Either alone is not enough.
 * - a caller-supplied start that cannot be read outranks every other answer,
 *   because nothing downstream can be measured against a start we cannot read.
 * - every `WindowUnprovenReason` is produced by some real stop condition.
 */

import type { IWindowResult } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/CoverageAudit/WindowCoverage.js';
import type { WindowStop } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/CoverageAudit/WindowCoverageVerdict.js';
import { classifyWindowCoverage } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/CoverageAudit/WindowCoverageVerdict.js';
import type { WindowCaveat } from '../../../../../WindowCoverage.js';

/** A start the caller asked for, as an instant. */
const START = '2026-01-01T00:00:00.000Z';

/** Coverage result for a walk whose oldest row reached the requested start. */
const REACHED: IWindowResult = { verdict: 'covered', oldest: '2025-12-25', gapDays: 0 };

/** Coverage result for a walk that stopped eleven days short. */
const SHORT: IWindowResult = { verdict: 'unproven', oldest: '2026-01-12', gapDays: 11 };

/** Coverage result for a walk whose rows carried no readable date at all. */
const UNDATED: IWindowResult = { verdict: 'unproven', oldest: '', gapDays: 0 };

/** No guardrail spoke. */
const CLEAN: readonly WindowCaveat[] = [];

/** The loop's answer when the audit said the window was reached. */
const COVERED_STOP: WindowStop = 'covered';

/** The loop's answer when it spent every ask it was allowed. */
const CEILING_STOP: WindowStop = 'backfillCeilingReached';

/** The loop's answer when no row carried a date to narrow the bound with. */
const UNDATED_STOP: WindowStop = 'noRowCarriedAUsableDate';

describe('classifyWindowCoverage/the start date was reached', () => {
  it('claims covered only when every guardrail also stayed quiet', () => {
    const args = { requestedStart: START, coverage: REACHED, stop: COVERED_STOP, caveats: CLEAN };
    const verdict = classifyWindowCoverage(args);
    expect(verdict).toEqual({ status: 'covered', requestedStart: START, oldest: '2025-12-25' });
  });

  it('refuses covered when a guardrail reported loss, and says which', () => {
    const caveats: readonly WindowCaveat[] = ['paginationStoppedEarly'];
    const args = { requestedStart: START, coverage: REACHED, stop: COVERED_STOP, caveats };
    const verdict = classifyWindowCoverage(args);
    expect(verdict).toEqual({
      status: 'lowerBoundReached',
      requestedStart: START,
      oldest: '2025-12-25',
      caveats: ['paginationStoppedEarly'],
    });
  });

  it('carries every caveat through, not just the first', () => {
    const caveats: readonly WindowCaveat[] = ['declaredRowShortfall', 'mappingRejectedRows'];
    const args = { requestedStart: START, coverage: REACHED, stop: COVERED_STOP, caveats };
    const verdict = classifyWindowCoverage(args);
    const reported = verdict.status === 'lowerBoundReached' ? verdict.caveats : [];
    expect(reported).toEqual(['declaredRowShortfall', 'mappingRejectedRows']);
  });
});

describe('classifyWindowCoverage/the start date was not reached', () => {
  it('reports the gap it fell short by', () => {
    const args = {
      requestedStart: START,
      coverage: SHORT,
      stop: CEILING_STOP,
      caveats: CLEAN,
    };
    const verdict = classifyWindowCoverage(args);
    expect(verdict).toEqual({
      status: 'unproven',
      reason: 'backfillCeilingReached',
      requestedStart: START,
      oldest: '2026-01-12',
      gapDays: 11,
    });
  });

  it('omits the oldest day when no row carried one', () => {
    const args = {
      requestedStart: START,
      coverage: UNDATED,
      stop: UNDATED_STOP,
      caveats: CLEAN,
    };
    const verdict = classifyWindowCoverage(args);
    const hasOldest = 'oldest' in verdict;
    expect(hasOldest).toBe(false);
  });

  it.each([
    'backfillCeilingReached',
    'backfillNotSupportedForBank',
    'backfillDisabled',
    'boundDidNotMove',
    'noRowCarriedAUsableDate',
  ] as const)('carries the loop stop code %s straight through', stop => {
    const args = { requestedStart: START, coverage: SHORT, stop, caveats: CLEAN };
    const verdict = classifyWindowCoverage(args);
    const reason = verdict.status === 'unproven' ? verdict.reason : 'not-unproven';
    expect(reason).toBe(stop);
  });
});

describe('classifyWindowCoverage/the caller asked for a start we cannot read', () => {
  it('says so rather than reporting a gap measured against nothing', () => {
    const args = {
      requestedStart: 'Invalid date',
      coverage: SHORT,
      stop: CEILING_STOP,
      caveats: CLEAN,
    };
    const verdict = classifyWindowCoverage(args);
    const reason = verdict.status === 'unproven' ? verdict.reason : 'not-unproven';
    expect(reason).toBe('requestedStartUnreadable');
  });

  it('outranks even a coverage result that claims the window was reached', () => {
    const args = {
      requestedStart: '',
      coverage: REACHED,
      stop: COVERED_STOP,
      caveats: CLEAN,
    };
    const verdict = classifyWindowCoverage(args);
    expect(verdict.status).toBe('unproven');
  });
});
