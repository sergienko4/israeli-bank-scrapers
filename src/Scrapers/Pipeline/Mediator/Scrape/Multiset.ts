/**
 * Multiset counting — how many copies of each identity a row collection holds.
 *
 * Two guardrails in this cluster need the same primitive for different keys:
 * overlap trimming counts raw JSON identities to spend one held copy per
 * re-served row, and coverage reconciliation counts mapped identities to tell
 * a repeated charge from a single one. Both are wrong the moment they collapse
 * to a `Set`: presence-only membership erases multiplicity, so the second of
 * two identical transactions becomes invisible.
 */

/**
 * Count copies of each identity in a row collection.
 *
 * @param items - Rows to count.
 * @param keyOf - Identity for one row, or false to exclude it entirely.
 * @returns Identity to copy count. Excluded rows appear in no entry.
 */
export function tallyBy<T>(
  items: readonly T[],
  keyOf: (item: T) => string | false,
): Map<string, number> {
  const counts = new Map<string, number>();
  const keys = items.map(keyOf).filter((key): key is string => key !== false);
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  return counts;
}

/**
 * Merge tallies by taking each identity's LARGEST count, not its sum.
 *
 * Used when the same item may legitimately appear in more than one source —
 * a transaction cross-listed in a summary container and a detail container is
 * one transaction, so summing would invent a duplicate. The largest single
 * source is the strongest evidence of true multiplicity.
 *
 * @param tallies - Per-source tallies to merge.
 * @returns Identity to its largest count across the sources.
 */
export function maxMerge(tallies: readonly ReadonlyMap<string, number>[]): Map<string, number> {
  const merged = new Map<string, number>();
  const entries = tallies.flatMap((tally): [string, number][] => [...tally]);
  for (const [key, count] of entries) {
    const best = Math.max(merged.get(key) ?? 0, count);
    merged.set(key, best);
  }
  return merged;
}
