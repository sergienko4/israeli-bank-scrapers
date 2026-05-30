/**
 * AuthFailureWatcher BodyClassifier — classifies a parsed body against
 * the shared AUTH_BODY_FAILURE_PATTERNS table.
 */

import type { JsonValue } from '../../../Types/JsonValue.js';
import AUTH_BODY_FAILURE_PATTERNS from './Patterns.js';
import type { IBodyFailurePattern } from './Types.js';

/**
 * Per-pattern match against one record.
 * @param record - Object to inspect.
 * @param pattern - Body-failure pattern row.
 * @returns True when the pattern's field is present and predicate fires.
 */
function patternFits(record: Record<string, JsonValue>, pattern: IBodyFailurePattern): boolean {
  if (!(pattern.field in record)) return false;
  return pattern.isFailure(record[pattern.field]);
}

/**
 * Test whether a single record (top-level or nested) matches any pattern.
 * @param record - Object to inspect.
 * @returns Note from the matching pattern, or false.
 */
export function matchInRecord(record: Record<string, JsonValue>): string | false {
  const hit = AUTH_BODY_FAILURE_PATTERNS.find((pattern): boolean => patternFits(record, pattern));
  if (!hit) return false;
  return hit.note;
}

/**
 * Try to match one nested value against the pattern table.
 * @param value - Nested JSON value.
 * @returns Note when matched, false otherwise.
 */
function matchNestedValue(value: JsonValue): string | false {
  if (value === null || typeof value !== 'object') return false;
  return matchInRecord(value as Record<string, JsonValue>);
}

/**
 * Walk nested values for the first match.
 * @param values - Nested values from the top record.
 * @returns Note when matched, false otherwise.
 */
function findNestedMatch(values: readonly JsonValue[]): string | false {
  const hit = values.find((v): boolean => matchNestedValue(v) !== false);
  if (hit === undefined) return false;
  return matchNestedValue(hit);
}

/**
 * Inspect a parsed JSON body against the shared failure-pattern table.
 * Top-level first, then one level deep into nested object values.
 * @param body - Parsed JSON response body.
 * @returns Matching pattern note when failure detected, false otherwise.
 */
export function classifyBodyAsFailure(body: JsonValue): string | false {
  if (body === null || typeof body !== 'object') return false;
  const topRecord = body as Record<string, JsonValue>;
  const topHit = matchInRecord(topRecord);
  if (topHit !== false) return topHit;
  const nestedValues = Object.values(topRecord);
  return findNestedMatch(nestedValues);
}
