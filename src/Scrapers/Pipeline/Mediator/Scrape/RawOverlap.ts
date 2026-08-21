/**
 * Overlap collapse for multi-request accounts.
 *
 * A backfill request re-asks the boundary day inclusively, so the reply always
 * re-serves rows the previous request already delivered. Concatenating would
 * double them; dropping the whole day would lose the rows a row-count cap
 * withheld. The collapse is what makes the inclusive re-ask safe.
 *
 * The collapse is a multiset difference on the *raw* row, before mapping:
 * a row from the newer reply is dropped only while an unconsumed byte-identical
 * copy is still held. That distinction matters — two genuinely distinct rows
 * that happen to serialize identically (the same amount, the same merchant,
 * the same day) both survive, because the second reply's two copies cancel the
 * two already held rather than collapsing to one. Set semantics would have
 * deleted one of them.
 *
 * This is deliberately narrower than {@link collapseDuplicates}, which needs a
 * declared key because it judges rows the provider sent *once*. Here the
 * duplication is something we caused by asking twice, so identity is the whole
 * test and no bank has to declare anything.
 */

import { getDebug } from '../../Logging/Debug.js';
import { tallyBy } from './Multiset.js';

const LOG = getDebug(import.meta.url);

/** Inputs for one overlap collapse. */
export interface IOverlapArgs {
  /** Rows already held for this account. */
  readonly collected: readonly object[];
  /** Rows the newest request returned. */
  readonly incoming: readonly object[];
  /** Bank + step identity for the log line. Never contains row content. */
  readonly label: string;
}

/** Outcome of one collapse. Counts only — never row content. */
export interface IOverlapResult {
  /** Incoming rows not already held. */
  readonly kept: readonly object[];
  /** How many incoming rows were re-served. */
  readonly dropped: number;
}

/**
 * Rebuild a value with every object's keys in sorted order, recursively.
 *
 * `JSON.stringify` preserves insertion order, so two rows carrying identical
 * data serialize differently when the provider's serializer emits their keys in
 * a different order between replies. That would let a re-served row read as
 * fresh and be returned twice. Sorting first makes the identity depend on the
 * data alone.
 *
 * @param value - Any JSON-shaped value.
 * @returns The same value with object keys ordered.
 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  const isPlainObject = value !== null && typeof value === 'object';
  if (!isPlainObject) return value;
  const entries = Object.entries(value as Record<string, unknown>);
  entries.sort((a, b): number => (a[0] < b[0] ? -1 : 1));
  const ordered: Record<string, unknown> = {};
  for (const [key, nested] of entries) ordered[key] = canonical(nested);
  return ordered;
}

/**
 * Serialize a raw row for identity comparison.
 *
 * Key order is normalised first — see {@link canonical}. Provider replies are
 * plain JSON, so the ordered serialized form is a faithful identity for rows
 * from the same account and step.
 *
 * @param row - One raw row as the shape extracted it.
 * @returns Stable string identity.
 */
function keyOf(row: object): string {
  const ordered = canonical(row);
  return JSON.stringify(ordered);
}

/**
 * Count how many copies of each row are already held.
 * @param rows - Rows already collected.
 * @returns Row identity to remaining copy count.
 */
function tally(rows: readonly object[]): Map<string, number> {
  return tallyBy(rows, keyOf);
}

/**
 * Whether one incoming row is fresh, spending a held copy when it is not.
 * @param row - One incoming row.
 * @param budget - Remaining copies held, decremented on a match.
 * @returns True when the row was not already held.
 */
function keepRow(row: object, budget: Map<string, number>): boolean {
  const key = keyOf(row);
  const held = budget.get(key) ?? 0;
  if (held === 0) return true;
  budget.set(key, held - 1);
  return false;
}

/**
 * Drop incoming rows already held, one copy at a time.
 * @param incoming - Rows the newest request returned.
 * @param budget - Remaining copies held, consumed as matches are found.
 * @returns Rows not already held.
 */
function selectFresh(incoming: readonly object[], budget: Map<string, number>): readonly object[] {
  return incoming.filter((row): boolean => keepRow(row, budget));
}

/**
 * Remove from `incoming` the rows already held in `collected`.
 *
 * @param args - Rows held, rows just returned, and log identity.
 * @returns The fresh rows plus how many were re-served.
 */
export function dropOverlap(args: IOverlapArgs): IOverlapResult {
  const budget = tally(args.collected);
  const kept = selectFresh(args.incoming, budget);
  const dropped = args.incoming.length - kept.length;
  const counts = `dropped=${String(dropped)} kept=${String(kept.length)}`;
  LOG.debug({ message: `overlap ${args.label}: ${counts}` });
  return { kept, dropped };
}

export default dropOverlap;
