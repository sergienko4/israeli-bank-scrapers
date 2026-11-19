/**
 * Run-stamp retention oracle — the store that guarantees unique stamps must
 * not grow forever. These tests drive the production retention policy with a
 * local store and pin both bounds: a six-hour slot window (covers DST folds
 * and wall-clock rollbacks with headroom) and a hard 131,072-entry ceiling
 * for pathological bursts.
 *
 * Integration through `nextRunStamp`, format and uniqueness remain covered by
 * `TraceStamp.test.ts` and the stress suite.
 */

import type { RunStampStr } from '../../../../Scrapers/Pipeline/Types/TraceStamp.js';
import applyRetention from '../../../../Scrapers/Pipeline/Types/TraceStampRetention.js';

/** Hard ceiling approved for the retained-stamp set. */
const MAX_RETAINED_STAMPS = 131_072;
/** Retention window approved for stamps that could still collide. */
const RETENTION_MS = 6 * 60 * 60 * 1000;
/** One quantized slot step. */
const SLOT_MS = 10;
/** A non-DST winter instant so only the injected offsets shape the clock. */
const BASE_MS = Date.UTC(2026, 0, 5, 8, 0, 0);

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
  it('retains a 10k burst below the cap', () => {
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

  it('caps a pathological burst at the approved ceiling', () => {
    const store = new Map<RunStampStr, number>();
    issueRun(store, MAX_RETAINED_STAMPS + 1);
    const oldest = stampKey(0);
    const newest = stampKey(MAX_RETAINED_STAMPS);
    const hasOldest = store.has(oldest);
    const hasNewest = store.has(newest);
    expect(store.size).toBe(MAX_RETAINED_STAMPS);
    expect(hasOldest).toBe(false);
    expect(hasNewest).toBe(true);
  });

  it('never drops a stamp on the first insert', () => {
    const store = new Map<RunStampStr, number>();
    applyOne(store, 0, BASE_MS);
    expect(store.size).toBe(1);
  });
});
