/**
 * JsonBody — recursive redactor for parsed-or-string JSON payloads.
 *
 * Used by NetworkDiscovery.dumpResponseBody and the FixtureCapture
 * writers. Walks the value tree, applying the Facade's censor to
 * leaves whose path-tail classifies as PII. Arrays containing any
 * PII-bearing object are collapsed to a sentinel that preserves the
 * element count (`[<N redacted items>]`) — the bank-side aggregate
 * shape is debuggable, individual transactions are not.
 */

import { LITERAL_TEXT_PII_PATTERNS } from './CommonHelpers.js';
import { type CensorFn, classifyKey, createCensorFn } from './Facade.js';
import {
  type IJsonObject,
  isPiiRedactionDisabled,
  type JsonArray,
  type JsonScalar,
  type JsonValue,
  type PiiCategory,
  type PiiClassifierBool,
  type PiiHintString,
} from './Types.js';

export const JSON_BODY_CATEGORY: PiiCategory = 'unknown';

/** Maximum walk depth before redactJsonBody bails out for safety. */
const MAX_WALK_DEPTH = 1000;

/**
 * Maximum recursion depth used by {@link objectHasPii} when probing
 * for nested PII. Conservative bail-out: deeper objects without a
 * top-level PII key are NOT flagged for array-size collapse — the
 * per-leaf censor still redacts any PII it walks past.
 */
const MAX_PII_PROBE_DEPTH = 50;

/** Recursive walk state — carried through redactNode for safety guards. */
interface IWalkState {
  readonly depth: number;
  readonly seen: WeakSet<object>;
  readonly censor: CensorFn;
}

/**
 * Whether a JsonValue at any nesting level contains a PII-classified
 * key. Walks both arrays and objects up to {@link MAX_PII_PROBE_DEPTH}
 * levels — the cap is a defensive bound for pathological inputs and
 * is not normally reachable.
 * @param value - Candidate value.
 * @param depth - Current recursion depth.
 * @returns True when nested PII is found.
 */
function nestedHasPii(value: JsonValue, depth: number): PiiClassifierBool {
  if (depth > MAX_PII_PROBE_DEPTH) return false as PiiClassifierBool;
  if (isJsonObject(value)) return objectHasPii(value, depth);
  if (Array.isArray(value)) return arrayHasPiiObject(value, depth);
  return false as PiiClassifierBool;
}

/**
 * Whether a captured plain object carries PII — recursively inspects
 * nested objects and arrays so `[{ meta: { phone: '…' } }]` is
 * correctly flagged.
 * @param obj - Candidate object.
 * @param depth - Current recursion depth (default 0).
 * @returns True when the subtree contains at least one PII-classified key.
 */
function objectHasPii(obj: IJsonObject, depth = 0): PiiClassifierBool {
  return Object.keys(obj).some(
    (k): boolean => classifyKey(k) !== 'unknown' || nestedHasPii(obj[k], depth + 1),
  ) as PiiClassifierBool;
}

/**
 * Whether a JsonValue is a plain JSON object (not array, not null).
 * @param v - Candidate value.
 * @returns True for plain JSON objects.
 */
function isJsonObject(v: JsonValue): v is IJsonObject {
  if (v === null) return false;
  if (typeof v !== 'object') return false;
  if (Array.isArray(v)) return false;
  return true;
}

/**
 * Whether an array contains at least one plain-object element with
 * nested or top-level PII. Recurses through {@link objectHasPii} so
 * `[{ meta: { phone: '…' } }]` triggers the array-collapse rule.
 * @param arr - Candidate array.
 * @param depth - Current recursion depth (default 0).
 * @returns True when at least one element carries PII.
 */
function arrayHasPiiObject(arr: JsonArray, depth = 0): PiiClassifierBool {
  return arr.some(
    (el): boolean => isJsonObject(el) && objectHasPii(el, depth + 1),
  ) as PiiClassifierBool;
}

/**
 * Build a fresh WeakSet via Reflect.construct.
 * @returns Empty WeakSet typed for arbitrary objects.
 */
function buildSeenSet(): WeakSet<object> {
  return Reflect.construct(WeakSet, []) as WeakSet<object>;
}

/**
 * Build a fresh walk state at depth 0.
 * @param censor - Active censor function.
 * @returns Initial walk state.
 */
function buildWalkState(censor: CensorFn): IWalkState {
  return { depth: 0, seen: buildSeenSet(), censor };
}

/**
 * Apply the censor to a leaf scalar.
 * @param value - Leaf primitive (excluding null).
 * @param path - Path to this leaf.
 * @param censor - Active censor function.
 * @returns Censored hint string or the raw value.
 */
function redactLeaf(
  value: string | number | boolean,
  path: readonly string[],
  censor: CensorFn,
): JsonScalar {
  const tail = path.at(-1) ?? '';
  if (classifyKey(tail) === 'unknown') return value;
  return censor(value, path);
}

/**
 * Walk a JSON object's own enumerable properties.
 * @param obj - Source object.
 * @param path - Path to this object.
 * @param state - Walk state.
 * @returns Redacted object.
 */
function redactObject(obj: IJsonObject, path: readonly string[], state: IWalkState): IJsonObject {
  const childState: IWalkState = { depth: state.depth + 1, seen: state.seen, censor: state.censor };
  const out: Record<string, JsonValue> = {};
  for (const key of Object.keys(obj)) {
    const next: readonly string[] = [...path, key];
    out[key] = redactNode(obj[key], next, childState);
  }
  return out;
}

/**
 * Walk a JSON array. If any element is a PII-bearing object, replace
 * the whole array with the sentinel '[<N redacted items>]'.
 * @param arr - Source array.
 * @param path - Path to the array.
 * @param state - Walk state.
 * @returns Redacted array or sentinel string.
 */
function redactArray(arr: JsonArray, path: readonly string[], state: IWalkState): JsonValue {
  if (arr.length === 0) return [];
  if (arrayHasPiiObject(arr)) return `[<${String(arr.length)} redacted items>]`;
  const childState: IWalkState = { depth: state.depth + 1, seen: state.seen, censor: state.censor };
  return arr.map((el): JsonValue => redactNode(el, path, childState));
}

/**
 * Whether a JsonValue is a JSON array (for type-narrowing).
 * @param v - Candidate value.
 * @returns True for JSON arrays.
 */
function isJsonArray(v: JsonValue): v is JsonArray {
  return Array.isArray(v);
}

/**
 * Walk a parsed JSON value, applying the censor to leaves and the
 * array-size rule to PII-bearing arrays.
 * @param value - Current node.
 * @param path - Path from root.
 * @param state - Walk state.
 * @returns Redacted node.
 */
function redactNode(value: JsonValue, path: readonly string[], state: IWalkState): JsonValue {
  if (state.depth > MAX_WALK_DEPTH) return '[REDACTED:depth-limit]';
  if (value === null) return value;
  if (typeof value !== 'object') return redactLeaf(value, path, state.censor);
  if (state.seen.has(value)) return '[REDACTED:cycle]';
  state.seen.add(value);
  if (isJsonArray(value)) return redactArray(value, path, state);
  return redactObject(value, path, state);
}

/**
 * Apply the regex fallback to a non-JSON body (also used post-stringify).
 * @param input - String to scrub.
 * @returns Scrubbed string.
 */
function applyFallbackPatterns(input: string): PiiHintString {
  return LITERAL_TEXT_PII_PATTERNS.reduce(
    (acc, p): PiiHintString => acc.replaceAll(p.re, p.to) as PiiHintString,
    input as PiiHintString,
  );
}

/** Parsed-or-fallback result of trying JSON.parse on a body string. */
interface IParseAttempt {
  readonly ok: boolean;
  readonly parsed: JsonValue;
}

/**
 * Try JSON.parse without throwing.
 * @param body - Candidate JSON string.
 * @returns Parse attempt with parsed value on success.
 */
function tryParseJson(body: string): IParseAttempt {
  try {
    const raw = JSON.parse(body) as JsonValue;
    return { ok: true, parsed: raw };
  } catch {
    return { ok: false, parsed: null };
  }
}

/**
 * Parse + redact + restringify a JSON body string.
 * @param body - Raw body string.
 * @returns Redacted body string.
 */
function redactBodyString(body: string): PiiHintString {
  const attempt = tryParseJson(body);
  if (!attempt.ok) return applyFallbackPatterns(body);
  const censor = createCensorFn();
  const state = buildWalkState(censor);
  const out = redactNode(attempt.parsed, [], state);
  const stringified = JSON.stringify(out);
  return applyFallbackPatterns(stringified);
}

/**
 * Walk + redact an already-parsed JsonValue tree.
 * @param body - Parsed JSON tree.
 * @returns Redacted body string.
 */
function redactBodyValue(body: JsonValue): PiiHintString {
  const censor = createCensorFn();
  const state = buildWalkState(censor);
  const out = redactNode(body, [], state);
  const stringified = JSON.stringify(out);
  return applyFallbackPatterns(stringified);
}

/**
 * Identity passthrough used by `redactJsonBody` in LOCAL DEV MODE.
 * @param body - Raw body string OR parsed JsonValue tree.
 * @returns The body unchanged (stringified when given a parsed tree).
 */
function passThroughJsonBody(body: string | JsonValue): PiiHintString {
  if (typeof body === 'string') return body as PiiHintString;
  return JSON.stringify(body) as PiiHintString;
}

/**
 * Redact a JSON body before persisting to disk. Accepts either a raw
 * string or an already-parsed JsonValue tree.
 * @param body - Raw body string OR parsed JsonValue tree.
 * @returns Redacted body string.
 */
function redactJsonBody(body: string | JsonValue): PiiHintString {
  if (isPiiRedactionDisabled) return passThroughJsonBody(body);
  if (typeof body === 'string') return redactBodyString(body);
  return redactBodyValue(body);
}

export { redactJsonBody };
