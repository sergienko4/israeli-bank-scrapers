/**
 * BFS field search — breadth-first walk over nested JSON shapes
 * to locate well-known field names.
 *
 * Extracted from ScrapeAutoMapper as part of the Phase 5
 * pipeline-decoupling split (master plan
 * pipeline-decoupling-master-2026-05-28 / phase-5).
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { IFieldMatch } from '../../../Types/FieldMatch.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../Types/Procedure.js';
import {
  type ApiRecord,
  MAX_SEARCH_DEPTH,
  type ScalarFieldHit,
  type UntypedValue,
} from '../AutoMapperFacade/AutoMapperTypes.js';

/** BFS queue item for iterative deep search. */
interface ISearchItem {
  readonly value: Record<string, unknown>;
  readonly depth: number;
}

/**
 * Check if a value is a searchable object.
 * @param val - Value to check.
 * @returns True if val is a non-null, non-array object.
 */
function isSearchableObject(val: UntypedValue): boolean {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

/**
 * Try matching one WK name against record keys.
 * @param record - Object to search.
 * @param recordKeys - Pre-computed keys.
 * @param wkName - WellKnown field name.
 * @returns IFieldMatch or false.
 */
function tryMatchWk(
  record: Record<string, unknown>,
  recordKeys: readonly string[],
  wkName: string,
): Procedure<IFieldMatch> {
  const wkLower = wkName.toLowerCase();
  const originalKey = recordKeys.find((k): boolean => k.toLowerCase() === wkLower);
  if (!originalKey) return fail(ScraperErrorTypes.Generic, 'key not found');
  const val = record[originalKey];
  const isScalar = typeof val === 'string' || typeof val === 'number';
  if (!isScalar) return fail(ScraperErrorTypes.Generic, 'not scalar');
  return succeed({ originalKey, value: val, matchingKey: wkName });
}

/**
 * Case-insensitive field match via Result Pattern.
 * @param record - Object to search.
 * @param fieldNames - WellKnown field names to match against.
 * @returns Procedure with IFieldMatch on success, failure on miss.
 */
function matchField(
  record: Record<string, unknown>,
  fieldNames: readonly string[],
): Procedure<IFieldMatch> {
  const recordKeys = Object.keys(record);
  /**
   * Try one WK name against this record.
   * @param wk - WK name.
   * @returns Match result.
   */
  const tryWk = (wk: string): Procedure<IFieldMatch> => tryMatchWk(record, recordKeys, wk);
  const results = fieldNames.map(tryWk);
  const hit = results.find(isOk);
  return hit ?? fail(ScraperErrorTypes.Generic, 'no WK match');
}

/**
 * Backward-compat wrapper — returns raw value or false.
 * @param record - Object to check.
 * @param fieldNames - WellKnown names.
 * @returns Matched value or false.
 */
function matchFieldInRecord(
  record: Record<string, unknown>,
  fieldNames: readonly string[],
): ScalarFieldHit {
  const result = matchField(record, fieldNames);
  if (!isOk(result)) return false;
  return result.value.value;
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
  const nextDepth = depth + 1;
  const recordValues = Object.values(record) as readonly UntypedValue[];
  const children = recordValues.filter(isSearchableObject).map(
    (child): ISearchItem => ({
      value: child as Record<string, unknown>,
      depth: nextDepth,
    }),
  );
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
  for (const item of items) {
    enqueueChildren(item.value, item.depth, next);
  }
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

/**
 * Find the first matching field value using BFS.
 * @param obj - Root object to search.
 * @param fieldNames - WellKnown field names to try.
 * @returns Field value or false if not found.
 */
function findFieldValue(
  obj: Record<string, unknown>,
  fieldNames: readonly string[],
): ScalarFieldHit {
  const rootHit = matchFieldInRecord(obj, fieldNames);
  if (rootHit !== false) return rootHit;
  const allObjects = flattenObjectTree(obj);
  const results = allObjects.map((o): ScalarFieldHit => matchFieldInRecord(o, fieldNames));
  const hit = results.find((r): boolean => r !== false);
  return hit ?? false;
}

/**
 * Recursive collector that visits every plain-object node reachable
 * through nested objects AND arrays, accumulating
 * {@link matchFieldInRecord} hits as it goes. Counterpart of
 * {@link flattenObjectTree}'s arrays-not-descended limitation: id
 * discovery shapes nest objects inside arrays (e.g. VisaCal
 * `result.bigNumbers[].cards[]`), so the array-skipping flattener
 * silently shadows the children.
 *
 * @param value - Current JSON value (any nesting depth).
 * @param fieldNames - WellKnown field names to try at each record.
 * @returns Array of hits collected at this node and below.
 */
function collectFieldValuesDeep(
  value: unknown,
  fieldNames: readonly string[],
): readonly ScalarFieldHit[] {
  if (Array.isArray(value)) {
    const arr = value as readonly unknown[];
    return arr.flatMap((item): readonly ScalarFieldHit[] =>
      collectFieldValuesDeep(item, fieldNames),
    );
  }
  if (value === null || typeof value !== 'object') return [];
  return collectFieldValuesFromRecord(value as Record<string, unknown>, fieldNames);
}

/**
 * Match a record at this level + recurse into every child value.
 * Hoisted so {@link collectFieldValuesDeep} stays at depth 1.
 *
 * @param record - Record at the current node.
 * @param fieldNames - WellKnown field names to try at each record.
 * @returns Hits collected at this record + descendants.
 */
function collectFieldValuesFromRecord(
  record: Record<string, unknown>,
  fieldNames: readonly string[],
): readonly ScalarFieldHit[] {
  const direct = matchFieldInRecord(record, fieldNames);
  const hereHits: readonly ScalarFieldHit[] = direct === false ? [] : [direct];
  const children = Object.values(record);
  const childHits = children.flatMap((child): readonly ScalarFieldHit[] =>
    collectFieldValuesDeep(child, fieldNames),
  );
  return [...hereHits, ...childHits];
}

/**
 * Collect every matching field value at any nesting depth — walks
 * both objects and arrays.
 *
 * <p>Counterpart to {@link findFieldValue} that returns ALL hits, not
 * just the first. Required by SCRAPE.final attribution when one
 * captured endpoint exposes multiple WK ids at different depths — for
 * example, VisaCal's `getBigNumberAndDetails` POST body carries a
 * parent `bankAccountUniqueId` on the request side AND a child
 * `cardUniqueId` inside `result.bigNumbers[].cards[]` on the response
 * side. The first-hit variant silently shadows one with the other;
 * the all-hits variant lets the caller match either.
 *
 * @param obj - Root object to search.
 * @param fieldNames - WellKnown field names to try at each level.
 * @returns All scalar hits collected via deep walk (may be empty).
 */
function findAllFieldValues(
  obj: Record<string, unknown>,
  fieldNames: readonly string[],
): readonly ScalarFieldHit[] {
  const hits = collectFieldValuesDeep(obj, fieldNames);
  return hits.filter((h): h is string | number => h !== false);
}

export type { ISearchItem };
export {
  findAllFieldValues,
  findFieldValue,
  flattenObjectTree,
  isSearchableObject,
  matchField,
  matchFieldInRecord,
};
