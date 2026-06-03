/**
 * BFS field search barrel — composes the {@link Match} (scalar
 * matchers) and {@link Flatten} (tree flattener) siblings into the
 * `findFieldValue` / `findAllFieldValues` entry points consumed by
 * TxnMapper, ContainerClaim and AccountExtractor.
 *
 * Extracted from ScrapeAutoMapper as part of the Phase 5
 * pipeline-decoupling split (master plan
 * pipeline-decoupling-master-2026-05-28 / phase-5).
 */

import type { ScalarFieldHit } from '../AutoMapperFacade/AutoMapperTypes.js';
import { flattenObjectTree, type ISearchItem } from './BfsFieldSearch.Flatten.js';
import { isSearchableObject, matchField, matchFieldInRecord } from './BfsFieldSearch.Match.js';

/**
 * Find first scalar hit across the flattened object tree.
 * Pulled out so {@link findFieldValue} stays under the LoC budget.
 * @param obj - Root object (already missed at the root level).
 * @param fieldNames - WellKnown field names to try at each level.
 * @returns First scalar hit or false.
 */
function findInFlattenedTree(
  obj: Record<string, unknown>,
  fieldNames: readonly string[],
): ScalarFieldHit {
  const allObjects = flattenObjectTree(obj);
  const results = allObjects.map((o): ScalarFieldHit => matchFieldInRecord(o, fieldNames));
  const hit = results.find((r): boolean => r !== false);
  return hit ?? false;
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
  return findInFlattenedTree(obj, fieldNames);
}

/**
 * Walk an array node by recursing into each item.
 * Pulled out so {@link collectFieldValuesDeep} stays at depth 1.
 * @param arr - Array of unknown items.
 * @param fieldNames - WellKnown field names to try at each record.
 * @returns Hits collected across all items.
 */
function collectFromArray(
  arr: readonly unknown[],
  fieldNames: readonly string[],
): readonly ScalarFieldHit[] {
  return arr.flatMap((item): readonly ScalarFieldHit[] => collectFieldValuesDeep(item, fieldNames));
}

/**
 * Collect hits from every child value of a record.
 * Pulled out so {@link collectFieldValuesFromRecord} stays under the LoC budget.
 * @param record - Record whose children should be descended.
 * @param fieldNames - WellKnown field names to try at each level.
 * @returns Hits collected across all descendants.
 */
function collectChildHits(
  record: Record<string, unknown>,
  fieldNames: readonly string[],
): readonly ScalarFieldHit[] {
  const children = Object.values(record);
  return children.flatMap((c): readonly ScalarFieldHit[] => collectFieldValuesDeep(c, fieldNames));
}

/**
 * Match a record at this level + recurse into every child value.
 * Hoisted so {@link collectFieldValuesDeep} stays at depth 1.
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
  const childHits = collectChildHits(record, fieldNames);
  return [...hereHits, ...childHits];
}

/**
 * Recursive collector that visits every plain-object node reachable
 * through nested objects AND arrays.
 * @param value - Current JSON value (any nesting depth).
 * @param fieldNames - WellKnown field names to try at each record.
 * @returns Array of hits collected at this node and below.
 */
function collectFieldValuesDeep(
  value: unknown,
  fieldNames: readonly string[],
): readonly ScalarFieldHit[] {
  if (Array.isArray(value)) return collectFromArray(value as readonly unknown[], fieldNames);
  if (value === null || typeof value !== 'object') return [];
  return collectFieldValuesFromRecord(value as Record<string, unknown>, fieldNames);
}

/**
 * Collect every matching field value at any nesting depth — walks
 * both objects and arrays.
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
