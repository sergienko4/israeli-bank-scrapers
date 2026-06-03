/**
 * BfsFieldSearch.Match — scalar field matchers extracted from the
 * Phase 5 BfsFieldSearch sibling so the barrel stays under the
 * per-file LoC cap (master plan pipeline-decoupling-master-2026-05-28
 * / phase-2e-residue).
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { IFieldMatch } from '../../../Types/FieldMatch.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../Types/Procedure.js';
import { type ScalarFieldHit, type UntypedValue } from '../AutoMapperFacade/AutoMapperTypes.js';

/**
 * Check if a value is a searchable object.
 * @param val - Value to check.
 * @returns True if val is a non-null, non-array object.
 */
function isSearchableObject(val: UntypedValue): boolean {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

/**
 * Validate that `record[originalKey]` is a scalar match.
 * Pulled out so {@link tryMatchWk} stays under the per-function LoC budget.
 * @param record - Object to search.
 * @param originalKey - Key resolved by case-insensitive match.
 * @param wkName - Canonical WK name to record on hit.
 * @returns Match procedure (succeed when scalar, fail otherwise).
 */
function validateScalarMatch(
  record: Record<string, unknown>,
  originalKey: string,
  wkName: string,
): Procedure<IFieldMatch> {
  const val = record[originalKey];
  const isScalar = typeof val === 'string' || typeof val === 'number';
  if (!isScalar) return fail(ScraperErrorTypes.Generic, 'not scalar');
  return succeed({ originalKey, value: val, matchingKey: wkName });
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
  return validateScalarMatch(record, originalKey, wkName);
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

export { isSearchableObject, matchField, matchFieldInRecord };
