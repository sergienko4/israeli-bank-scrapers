/**
 * Iterative BFS replace of a WellKnown field within a JSON tree,
 * with a Base64-encoded paging-context fallback. The public
 * `replaceField` mutates `body` in place.
 */

import type { JsonNode } from '../JsonTraversal.js';
import { encodeToBase64, findPagingContext } from './Base64Paging.js';
import type { JsonRecord } from './JsonTypes.js';

/** Max depth for iterative replaceField BFS. */
const MAX_REPLACE_DEPTH = 15;

/** Bundled BFS replace context. */
interface IBfsReplaceCtx {
  readonly fieldNames: readonly string[];
  readonly value: string;
}

/** Bundled args for one BFS level pass. */
interface IReplaceLevelArgs extends IBfsReplaceCtx {
  readonly queue: readonly JsonRecord[];
}

/** Result of one BFS level pass. */
interface IReplaceLevelResult {
  readonly didReplace: boolean;
  readonly next: JsonRecord[];
}

/**
 * Check if a value is a searchable object (not null, not array).
 * @param val - Value to check.
 * @returns True if val is a non-null, non-array object.
 */
function isSearchableObj(val: JsonNode): boolean {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

/**
 * Find a body key (case-insensitive) whose lower form matches any of `fieldNames`.
 *
 * <p>The returned value is the ORIGINAL body key (preserving casing) so callers
 * may mutate `obj[bodyKey]` directly. Returning the body key (not the WK field
 * name) collapses the previous double-search and removes the unreachable
 * defensive guard in `replaceInObject` (the prior `keys.find()` second pass
 * was provably always defined per the lookup invariant).
 *
 * @param keys - Object keys.
 * @param fieldNames - WellKnown field names.
 * @returns Matched body key or false.
 */
function findLowerHit(keys: readonly string[], fieldNames: readonly string[]): string | false {
  const lowerFieldSet = new Set(fieldNames.map((f): string => f.toLowerCase()));
  return keys.find((k): boolean => lowerFieldSet.has(k.toLowerCase())) ?? false;
}

/**
 * Try to replace a WK field in a single object.
 *
 * <p>When the matched key holds a CONTAINER (object or array), the value is left
 * intact and `false` is returned so the BFS descends INTO it instead of
 * flattening it to a scalar. This preserves banks (e.g. BaNCS-core) whose
 * account identifier is a nested object — overwriting it with a flat string
 * would corrupt the body and the bank would reject the request. For flat banks
 * the matched value is a scalar, so the guard is inert and the overwrite runs.
 * @param obj - Object to check and mutate.
 * @param fieldNames - WellKnown field names to match.
 * @param value - New value to set.
 * @returns True if a scalar field was replaced; false if absent or a container.
 */
function replaceInObject(obj: JsonRecord, fieldNames: readonly string[], value: string): boolean {
  const bodyKey = findLowerHit(Object.keys(obj), fieldNames);
  if (!bodyKey) return false;
  const current = obj[bodyKey];
  if (current !== null && typeof current === 'object') return false;
  obj[bodyKey] = value;
  return true;
}

/**
 * Collect searchable child objects from an array.
 * @param arr - Array to filter for objects.
 * @returns Searchable objects from the array.
 */
function collectArrayObjs(arr: readonly JsonNode[]): JsonRecord[] {
  return arr
    .filter((item): boolean => isSearchableObj(item))
    .map((item): JsonRecord => item as JsonRecord);
}

/**
 * Collect child objects from one value (array or object).
 * @param child - Value to inspect.
 * @returns Array of child objects for BFS.
 */
function collectChildObjs(child: JsonNode): JsonRecord[] {
  if (Array.isArray(child)) return collectArrayObjs(child);
  if (isSearchableObj(child)) return [child as JsonRecord];
  return [];
}

/**
 * Collect all child objects from a record for BFS.
 * @param obj - Parent object.
 * @returns Array of child objects for next BFS level.
 */
function collectBfsChildren(obj: JsonRecord): JsonRecord[] {
  return Object.values(obj).flatMap((v): JsonRecord[] => collectChildObjs(v));
}

/**
 * Process one BFS level: replace fields + collect children.
 * @param args - Queue + replace context.
 * @returns Replace status and next queue.
 */
function processReplaceLevel(args: IReplaceLevelArgs): IReplaceLevelResult {
  let didReplace = false;
  const next: JsonRecord[] = [];
  for (const obj of args.queue) {
    const wasReplaced = replaceInObject(obj, args.fieldNames, args.value);
    didReplace = didReplace || wasReplaced;
    next.push(...collectBfsChildren(obj));
  }
  return { didReplace, next };
}

/**
 * Recursive BFS replace — processes one level then recurses.
 * @param queue - Current level objects.
 * @param ctx - Replace context.
 * @param depth - Current depth.
 * @returns True if any field was replaced.
 */
function replaceBfsLevel(
  queue: readonly JsonRecord[],
  ctx: IBfsReplaceCtx,
  depth: number,
): boolean {
  if (queue.length === 0 || depth >= MAX_REPLACE_DEPTH) return false;
  const level = processReplaceLevel({ ...ctx, queue });
  if (level.didReplace) return true;
  return replaceBfsLevel(level.next, ctx, depth + 1);
}

/**
 * Try replacing a field inside a Base64-encoded paging context.
 * @param body - Object containing potential Base64 field.
 * @param ctx - Replace context.
 * @returns True if replaced inside decoded context.
 */
function replaceFieldInBase64Context(body: JsonRecord, ctx: IBfsReplaceCtx): boolean {
  const pagingHit = findPagingContext(body);
  if (!pagingHit) return false;
  const didReplace = replaceBfsLevel([pagingHit.decoded], ctx, 0);
  if (!didReplace) return false;
  body[pagingHit.key] = encodeToBase64(pagingHit.decoded);
  return true;
}

/**
 * Replace a WellKnown field in a body. Searches direct body via
 * BFS first, then falls back to a Base64-encoded paging context.
 * @param body - Object to replace in (mutated).
 * @param fieldNames - WellKnown field names to match.
 * @param value - New value to set.
 * @returns True if at least one field was replaced.
 */
function replaceField(body: JsonRecord, fieldNames: readonly string[], value: string): boolean {
  const ctx: IBfsReplaceCtx = { fieldNames, value };
  const didReplaceDirect = replaceBfsLevel([body], ctx, 0);
  if (didReplaceDirect) return true;
  return replaceFieldInBase64Context(body, ctx);
}

export default replaceField;
