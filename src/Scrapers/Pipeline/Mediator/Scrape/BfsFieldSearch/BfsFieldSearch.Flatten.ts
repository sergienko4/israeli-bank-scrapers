/**
 * BfsFieldSearch.Flatten — BFS object-tree flattener extracted from
 * the Phase 5 BfsFieldSearch sibling so the barrel stays under the
 * per-file LoC cap (master plan pipeline-decoupling-master-2026-05-28
 * / phase-2e-residue).
 */

import {
  type ApiRecord,
  MAX_SEARCH_DEPTH,
  type UntypedValue,
} from '../AutoMapperFacade/AutoMapperTypes.js';
import { isSearchableObject } from './BfsFieldSearch.Match.js';

/** BFS queue item for iterative deep search. */
interface ISearchItem {
  readonly value: Record<string, unknown>;
  readonly depth: number;
}

/**
 * Build BFS child entries from a record's values, pre-filtered to
 * searchable child objects. Pulled out so {@link enqueueChildren}
 * stays a thin guard + push.
 *
 * @param record - Parent object.
 * @param depth - Current BFS depth.
 * @returns Child entries with depth+1.
 */
function buildBfsChildren(record: Record<string, unknown>, depth: number): readonly ISearchItem[] {
  const nextDepth = depth + 1;
  const recordValues = Object.values(record) as readonly UntypedValue[];
  return recordValues
    .filter(isSearchableObject)
    .map((child): ISearchItem => ({ value: child as Record<string, unknown>, depth: nextDepth }));
}

/**
 * Enqueue child objects from a record into BFS queue.
 * @param record - Parent object.
 * @param depth - Current depth.
 * @param queue - BFS queue to append to.
 * @returns True if children were enqueued.
 */
function enqueueChildren(
  record: Record<string, unknown>,
  depth: number,
  queue: ISearchItem[],
): boolean {
  if (depth >= MAX_SEARCH_DEPTH) return false;
  const children = buildBfsChildren(record, depth);
  queue.push(...children);
  return true;
}

/**
 * Process one BFS level and return next level items.
 * @param items - Current level items.
 * @returns Next level items.
 */
function bfsOneLevel(items: readonly ISearchItem[]): readonly ISearchItem[] {
  const next: ISearchItem[] = [];
  for (const item of items) enqueueChildren(item.value, item.depth, next);
  return next;
}

/**
 * Recursive BFS level processor — accumulates all objects.
 * @param current - Current level items.
 * @param accum - All items collected so far.
 * @returns Complete flat list.
 */
function bfsAccumulate(
  current: readonly ISearchItem[],
  accum: readonly ISearchItem[],
): readonly ISearchItem[] {
  if (current.length === 0) return accum;
  const merged = [...accum, ...current];
  const next = bfsOneLevel(current);
  return bfsAccumulate(next, merged);
}

/**
 * Flatten a nested object tree into an array of records via BFS.
 * @param root - Root API record.
 * @returns All records found at any depth.
 */
function flattenObjectTree(root: ApiRecord): readonly ApiRecord[] {
  const seed: ISearchItem[] = [{ value: root, depth: 0 }];
  const all = bfsAccumulate(seed, []);
  return all.map((entry): ApiRecord => entry.value);
}

export type { ISearchItem };
export { flattenObjectTree };
