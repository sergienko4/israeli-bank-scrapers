/**
 * JsonPointer — RFC-6901 walker used by GenericEnvelopeParser.
 * Returns Procedure<JsonValue> so callers can surface the failing
 * path directly; carries zero bank knowledge.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../Types/Procedure.js';

/** JSON scalar subset — no `undefined`; null is the missing-marker from banks. */
type JsonPrimitive = string | number | boolean | null;

/** Predicate flag used inside Array.find callbacks that filter JSON entries. */
type JsonEntryMatch = boolean;

/** Decoded RFC-6901 segment (post `~0`/`~1` unescape). */
type DecodedSegment = string;

/** JSON array recursion node. */
type JsonArray = readonly JsonValue[];

/** JSON object recursion node — keys are always strings. */
interface IJsonObject {
  readonly [key: string]: JsonValue;
}

/** Full JSON-document algebra used by the walker. */
type JsonValue = JsonPrimitive | JsonArray | IJsonObject;

/**
 * Produce the standardised "path miss" failure with a caller-facing
 * message. Keeps the failure-shape consistent across the walker
 * and the parser that consumes it.
 * @param path - Pointer (or sub-path) that walked off the graph.
 * @returns Procedure failure with Generic error type.
 */
function missFail(path: string): Procedure<JsonValue> {
  return fail(ScraperErrorTypes.Generic, `json-pointer miss at ${path}`);
}

/**
 * Step an array cursor by numeric index.
 * @param arr - Current array cursor.
 * @param key - Decoded segment expected to parse as an integer.
 * @param path - Pointer prefix traversed so far (for diagnostics).
 * @returns Procedure with the next value, or miss failure.
 */
function stepArray(arr: JsonArray, key: string, path: string): Procedure<JsonValue> {
  const idx = Number(key);
  const isValid = Number.isInteger(idx) && idx >= 0 && idx < arr.length;
  if (!isValid) return missFail(path);
  return succeed(arr[idx]);
}

/**
 * Step an object cursor by property name.
 * @param obj - Current object cursor.
 * @param key - Decoded property name.
 * @param path - Pointer prefix traversed so far (for diagnostics).
 * @returns Procedure with the property value, or miss failure.
 */
function stepObject(obj: IJsonObject, key: string, path: string): Procedure<JsonValue> {
  if (!Object.hasOwn(obj, key)) return missFail(path);
  return succeed(obj[key]);
}

/**
 * True when the entry is a plain JSON object (not array, not null).
 * @param entry - JSON value.
 * @returns True if entry is an object.
 */
function isPlainObject(entry: JsonValue): entry is IJsonObject {
  if (entry === null) return false;
  if (typeof entry !== 'object') return false;
  return !Array.isArray(entry);
}

/**
 * Extended: step an array by picking the first element that has a
 * given property name defined. Encoded as segment `*<propName>`.
 * @param arr - Current array cursor.
 * @param propName - Property name to probe on each entry.
 * @param path - Pointer prefix traversed so far.
 * @returns Procedure with that property's value, or miss failure.
 */
function stepArrayPick(arr: JsonArray, propName: string, path: string): Procedure<JsonValue> {
  const matched = arr.find((entry): JsonEntryMatch => {
    if (!isPlainObject(entry)) return false;
    return Object.hasOwn(entry, propName);
  });
  if (matched === undefined) return missFail(path);
  return succeed((matched as IJsonObject)[propName]);
}

/**
 * Extended: filter an array down to the first element whose named
 * property equals the given string. Encoded as segment `?k=v`.
 * @param arr - Current array cursor.
 * @param expr - Expression text after the `?` (e.g. 'type=password').
 * @param path - Pointer prefix traversed so far.
 * @returns Procedure with the matched entry (whole element), or miss.
 */
function stepArrayFilter(arr: JsonArray, expr: string, path: string): Procedure<JsonValue> {
  const eq = expr.indexOf('=');
  if (eq <= 0) return missFail(path);
  const k = expr.slice(0, eq);
  const v = expr.slice(eq + 1);
  const matched = arr.find((entry): JsonEntryMatch => {
    if (!isPlainObject(entry)) return false;
    if (!Object.hasOwn(entry, k)) return false;
    return entry[k] === v;
  });
  if (matched === undefined) return missFail(path);
  return succeed(matched);
}

/**
 * Step one pointer segment from the current cursor.
 * Extended syntax:
 *   `*<propName>` — pick first array element with propName defined,
 *                   return that property's value.
 *   `?k=v`        — filter array, return first element where .k === 'v'.
 * @param cursor - Current JSON value.
 * @param key - Decoded segment to resolve.
 * @param path - Pointer prefix traversed so far.
 * @returns Procedure with the next cursor value, or miss failure.
 */
/**
 * Dispatch a `*propName` pick segment.
 * @param cursor - Current cursor.
 * @param key - Raw segment (leading `*`).
 * @param path - Pointer prefix for diagnostics.
 * @returns Procedure with picked value or miss.
 */
function dispatchPick(cursor: JsonValue, key: string, path: string): Procedure<JsonValue> {
  if (!Array.isArray(cursor)) return missFail(path);
  const propName = key.slice(1);
  return stepArrayPick(cursor, propName, path);
}

/**
 * Dispatch a `?k=v` filter segment.
 * @param cursor - Current cursor.
 * @param key - Raw segment (leading `?`).
 * @param path - Pointer prefix for diagnostics.
 * @returns Procedure with filtered entry or miss.
 */
function dispatchFilter(cursor: JsonValue, key: string, path: string): Procedure<JsonValue> {
  if (!Array.isArray(cursor)) return missFail(path);
  const expr = key.slice(1);
  return stepArrayFilter(cursor, expr, path);
}

/**
 * Step one pointer segment from the current cursor.
 * Extended syntax:
 *   `*<propName>` — pick first array element with propName defined,
 *                   return that property's value.
 *   `?k=v`        — filter array, return first element where .k === 'v'.
 * @param cursor - Current JSON value.
 * @param key - Decoded segment to resolve.
 * @param path - Pointer prefix traversed so far.
 * @returns Procedure with the next cursor value, or miss failure.
 */
function stepInto(cursor: JsonValue, key: string, path: string): Procedure<JsonValue> {
  if (cursor === null) return missFail(path);
  const isPick = key.startsWith('*') && key.length > 1;
  if (isPick) return dispatchPick(cursor, key, path);
  const isFilter = key.startsWith('?') && key.length > 1;
  if (isFilter) return dispatchFilter(cursor, key, path);
  if (Array.isArray(cursor)) return stepArray(cursor, key, path);
  if (typeof cursor !== 'object') return missFail(path);
  return stepObject(cursor as IJsonObject, key, path);
}

/**
 * Reduce parts through stepInto, short-circuiting on the first miss.
 * Flattened out of walkPointer to satisfy max-depth 1.
 * @param cursor - Current cursor (doc initially).
 * @param parts - Remaining segments to walk.
 * @param pointer - Original pointer (for diagnostics).
 * @returns Procedure with the final cursor, or miss failure.
 */
function reduceParts(
  cursor: JsonValue,
  parts: readonly string[],
  pointer: string,
): Procedure<JsonValue> {
  if (parts.length === 0) return succeed(cursor);
  const [head, ...rest] = parts;
  const stepped = stepInto(cursor, head, pointer);
  if (!isOk(stepped)) return stepped;
  return reduceParts(stepped.value, rest, pointer);
}

/**
 * Decode one RFC-6901 segment (`~1` → `/`, `~0` → `~`).
 * @param raw - Encoded segment.
 * @returns Decoded segment.
 */
function decodeSegment(raw: string): DecodedSegment {
  const slashFixed = raw.replaceAll('~1', '/');
  return slashFixed.replaceAll('~0', '~');
}

/**
 * Walk a JSON document along an RFC-6901 pointer.
 * @param doc - Input JSON document.
 * @param pointer - Pointer string; `''` or `'/'` returns the doc.
 * @returns Procedure with the resolved value, or miss failure.
 */
function walkPointer(doc: JsonValue, pointer: string): Procedure<JsonValue> {
  if (pointer === '' || pointer === '/') return succeed(doc);
  const split = pointer.split('/');
  const rawParts = split.slice(1);
  const parts = rawParts.map(decodeSegment);
  return reduceParts(doc, parts, pointer);
}

export type { IJsonObject, JsonArray, JsonPrimitive, JsonValue };
export default walkPointer;
export { walkPointer };
