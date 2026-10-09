/**
 * AuthFailureWatcher BodyClassifier — classifies a parsed body against
 * the shared AUTH_BODY_FAILURE_PATTERNS table. A record that declares
 * success (AUTH_BODY_SUCCESS_MARKERS) is never a failure.
 */

import type { JsonUnknown } from '../../../Types/JsonValue.js';
import AUTH_BODY_FAILURE_PATTERNS, { AUTH_BODY_SUCCESS_MARKERS } from './Patterns.js';
import type { IBodyFailurePattern, IBodySuccessMarker } from './Types.js';

/**
 * Per-pattern match against one record.
 * @param record - Object to inspect.
 * @param pattern - Body-failure pattern row.
 * @returns True when the pattern's field is present and predicate fires.
 */
function patternFits(record: Record<string, JsonUnknown>, pattern: IBodyFailurePattern): boolean {
  if (!(pattern.field in record)) return false;
  return pattern.isFailure(record[pattern.field]);
}

/**
 * Per-marker match against one record.
 * @param record - Object to inspect.
 * @param marker - Explicit-success marker row.
 * @returns True when the marker's field is present and declares success.
 */
function markerFits(record: Record<string, JsonUnknown>, marker: IBodySuccessMarker): boolean {
  if (!(marker.field in record)) return false;
  return marker.isSuccess(record[marker.field]);
}

/**
 * Whether a record explicitly declares success.
 * @param record - Object to inspect.
 * @returns True when any success marker fits the record.
 */
function declaresSuccess(record: Record<string, JsonUnknown>): boolean {
  return AUTH_BODY_SUCCESS_MARKERS.some((marker): boolean => markerFits(record, marker));
}

/**
 * Test whether a single record (top-level or nested) matches any pattern.
 * A record that declares success vetoes every failure pattern.
 * @param record - Object to inspect.
 * @returns Note from the matching pattern, or false.
 */
function matchInRecord(record: Record<string, JsonUnknown>): string | false {
  if (declaresSuccess(record)) return false;
  const hit = AUTH_BODY_FAILURE_PATTERNS.find((pattern): boolean => patternFits(record, pattern));
  if (!hit) return false;
  return hit.note;
}

/**
 * Try to match one nested value against the pattern table.
 * @param value - Nested JSON value.
 * @returns Note when matched, false otherwise.
 */
function matchNestedValue(value: JsonUnknown): string | false {
  if (value === null || typeof value !== 'object') return false;
  return matchInRecord(value as Record<string, JsonUnknown>);
}

/**
 * Walk nested values for the first match.
 * @param values - Nested values from the top record.
 * @returns Note when matched, false otherwise.
 */
function findNestedMatch(values: readonly JsonUnknown[]): string | false {
  const hit = values.find((v): boolean => matchNestedValue(v) !== false);
  if (hit === undefined) return false;
  return matchNestedValue(hit);
}

/**
 * Inspect a parsed JSON body against the shared failure-pattern table.
 * Top-level first, then one level deep into nested object values. The
 * success veto is per record: a wrapper's flag never hides a nested
 * record's own rejection.
 * @param body - Parsed JSON response body.
 * @returns Matching pattern note when failure detected, false otherwise.
 */
function classifyBodyAsFailure(body: JsonUnknown): string | false {
  if (body === null || typeof body !== 'object') return false;
  const topRecord = body as Record<string, JsonUnknown>;
  const topHit = matchInRecord(topRecord);
  if (topHit !== false) return topHit;
  const nestedValues = Object.values(topRecord);
  return findNestedMatch(nestedValues);
}

export default classifyBodyAsFailure;
