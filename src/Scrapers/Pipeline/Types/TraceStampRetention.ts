/**
 * Stamp-retention policy — bounds the store that guarantees unique run
 * stamps. Split from TraceStamp.ts so the policy is testable without
 * reaching into the generator's module state.
 *
 * The store's insertion order is slot order: every issued stamp is recorded at
 * a strictly increasing quantized slot. Retention therefore walks from the
 * oldest entry and stops at the first one still inside the window.
 */

/**
 * Retention window for issued stamps. A formatted stamp can recur when the
 * local clock folds (DST) or a wall clock jumps back; six hours covers the
 * one-hour fold and a one-hour rollback with headroom.
 */
const STAMP_RETENTION_MS = 6 * 60 * 60 * 1000;
/** Hard ceiling on retained stamps — bounds a pathological burst. */
const MAX_RETAINED_STAMPS = 131_072;

/**
 * Drop stamps older than the retention window.
 * @param store - Stamp store to mutate.
 * @param cutoffMs - Oldest slot to keep.
 * @returns True once expired entries are dropped.
 */
function evictExpired<TKey extends string>(store: Map<TKey, number>, cutoffMs: number): true {
  const entries = store.entries();
  let next = entries.next();
  while (!next.done && next.value[1] < cutoffMs) {
    store.delete(next.value[0]);
    next = entries.next();
  }
  return true;
}

/**
 * Drop the oldest stamps until the hard ceiling is met.
 * @param store - Stamp store to mutate.
 * @returns True once the retained size is within the ceiling.
 */
function evictOverflow<TKey extends string>(store: Map<TKey, number>): true {
  const keys = store.keys();
  let next = keys.next();
  while (store.size > MAX_RETAINED_STAMPS && !next.done) {
    store.delete(next.value);
    next = keys.next();
  }
  return true;
}

/**
 * Record one issued stamp and apply both retention bounds.
 * @param store - Stamp store to mutate.
 * @param stamp - Formatted stamp to retain.
 * @param slotMs - Quantized slot the stamp was issued at.
 * @returns True once retained.
 */
function applyRetention<TKey extends string>(
  store: Map<TKey, number>,
  stamp: TKey,
  slotMs: number,
): true {
  store.set(stamp, slotMs);
  evictExpired(store, slotMs - STAMP_RETENTION_MS);
  evictOverflow(store);
  return true;
}

export default applyRetention;
