/**
 * Run-stamp retention oracle — the store that guarantees unique stamps must
 * not grow forever. These tests drive the production retention policy with a
 * local store and pin the six-hour slot window (covers DST folds and
 * wall-clock rollbacks with headroom). A burst above the former 131,072
 * ceiling is retained, because dropping it would reopen a fold collision.
 *
 * Integration through `nextRunStamp`, format and uniqueness remain covered by
 * `TraceStamp.test.ts` and the stress suite.
 */

import { jest } from '@jest/globals';

import type * as TraceStampModuleType from '../../../../Scrapers/Pipeline/Types/TraceStamp.js';
import type { RunStampStr } from '../../../../Scrapers/Pipeline/Types/TraceStamp.js';
import applyRetention from '../../../../Scrapers/Pipeline/Types/TraceStampRetention.js';
import formatRunStamp from '../../../Helpers/RunStampFormat.js';

type TraceStampModule = typeof TraceStampModuleType;

/** A burst above the old count ceiling, still inside the fold window. */
const FOLD_BURST_SIZE = 131_073;
/** First DST fold pass: 01:00 IDT on 2026-10-25. */
const FOLD_FIRST_PASS_MS = Date.UTC(2026, 9, 24, 22, 0, 0);
/** Repeat fold pass: the same local 01:00, one hour later (IST). */
const FOLD_SECOND_PASS_MS = Date.UTC(2026, 9, 24, 23, 0, 0);
/** Retention window approved for stamps that could still collide. */
const RETENTION_MS = 6 * 60 * 60 * 1000;
/** One quantized slot step. */
const SLOT_MS = 10;
/** A non-DST winter instant so only the injected offsets shape the clock. */
const BASE_MS = Date.UTC(2026, 0, 5, 8, 0, 0);

/**
 * Load a fresh TraceStamp module so its retention state starts empty.
 * @returns The typed module exports.
 */
async function freshTraceStamp(): Promise<TraceStampModule> {
  jest.resetModules();
  return await import('../../../../Scrapers/Pipeline/Types/TraceStamp.js');
}

/**
 * Build a synthetic map key for one issue.
 * @param index - Issue ordinal.
 * @returns Branded stamp key.
 */
function stampKey(index: number): RunStampStr {
  return `stamp-${String(index)}` as RunStampStr;
}

/**
 * Apply one retention entry under its synthetic key.
 * @param store - Stamp store to mutate.
 * @param index - Issue ordinal.
 * @param slotMs - Quantized slot to record.
 * @returns True once applied.
 */
function applyOne(store: Map<RunStampStr, number>, index: number, slotMs: number): true {
  const key = stampKey(index);
  applyRetention(store, key, slotMs);
  return true;
}

/**
 * Apply one contiguous run of retention entries at ten-millisecond slots.
 * @param store - Stamp store to mutate.
 * @param count - Number of entries to apply.
 * @returns True once the run is applied.
 */
function issueRun(store: Map<RunStampStr, number>, count: number): true {
  for (let index = 0; index < count; index += 1) {
    const slotMs = BASE_MS + index * SLOT_MS;
    applyOne(store, index, slotMs);
  }
  return true;
}

describe('TraceStamp — retention bounds', () => {
  it('retains a 10k burst', () => {
    const store = new Map<RunStampStr, number>();
    issueRun(store, 10_000);
    expect(store.size).toBe(10_000);
  });

  it('keeps stamps exactly at the six-hour boundary and drops the older one', () => {
    const store = new Map<RunStampStr, number>();
    const first = stampKey(0);
    const second = stampKey(1);
    applyOne(store, 0, BASE_MS);
    applyOne(store, 1, BASE_MS + RETENTION_MS);
    expect(store.size).toBe(2);
    applyOne(store, 2, BASE_MS + RETENTION_MS + SLOT_MS);
    const hasFirst = store.has(first);
    const hasSecond = store.has(second);
    expect(store.size).toBe(2);
    expect(hasFirst).toBe(false);
    expect(hasSecond).toBe(true);
  });

  it('keeps a burst inside the window even above the old count ceiling', () => {
    const store = new Map<RunStampStr, number>();
    issueRun(store, FOLD_BURST_SIZE);
    const oldest = stampKey(0);
    const newest = stampKey(FOLD_BURST_SIZE - 1);
    const hasOldest = store.has(oldest);
    const hasNewest = store.has(newest);
    expect(store.size).toBe(FOLD_BURST_SIZE);
    expect(hasOldest).toBe(true);
    expect(hasNewest).toBe(true);
  });

  it('does not reuse the first fold-pass stamp after a burst crosses the old ceiling', async () => {
    const mod = await freshTraceStamp();
    const first = mod.nextRunStamp(FOLD_FIRST_PASS_MS);
    const expectedFirst = formatRunStamp(new Date(FOLD_FIRST_PASS_MS));
    expect(first).toBe(expectedFirst);
    for (let index = 1; index < FOLD_BURST_SIZE; index += 1) {
      mod.nextRunStamp(FOLD_FIRST_PASS_MS);
    }
    const secondPass = mod.nextRunStamp(FOLD_SECOND_PASS_MS);
    expect(secondPass).not.toBe(first);
  });

  it('never drops a stamp on the first insert', () => {
    const store = new Map<RunStampStr, number>();
    applyOne(store, 0, BASE_MS);
    expect(store.size).toBe(1);
  });
});
