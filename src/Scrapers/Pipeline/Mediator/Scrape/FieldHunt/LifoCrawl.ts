/**
 * LIFO crawl — depth-first iterative walk that finds the first
 * high-signature array in a nested API response. Powers
 * `findFirstArray`, used by ContainerPicker fallbacks.
 *
 * Sub-split out of FieldHunt.ts during Phase 5 to keep both files
 * under the per-cluster max-lines:150 eff cap (master plan
 * pipeline-decoupling-master-2026-05-28 / phase-5).
 */

import { getDebug } from '../../../Types/Debug.js';
import { type ApiRecord, type UntypedValue } from '../AutoMapperFacade/AutoMapperTypes.js';
import { flattenObjectTree } from '../BfsFieldSearch/BfsFieldSearch.js';
import { MIN_TXN_SCORE, scoreTxnSignature } from '../BfsFieldSearch/TxnSignature.js';

const LOG = getDebug(import.meta.url);

/** Max depth for stack-based array search. */
const MAX_ARRAY_DEPTH = 15;

/** Stack entry for LIFO array search. */
interface IStackEntry {
  readonly node: unknown;
  readonly depth: number;
}

/** Context for handleArrayNode. */
interface IArrayNodeCtx {
  readonly collected: unknown[];
  readonly stack: IStackEntry[];
  readonly node: unknown[];
  readonly depth: number;
}

/**
 * Push object items from an array onto the stack.
 * @param stack - Exploration stack.
 * @param items - Array items to push.
 * @param depth - Current depth.
 * @returns Number of items pushed.
 */
function pushArrayChildren(
  stack: IStackEntry[],
  items: readonly UntypedValue[],
  depth: number,
): number {
  const objects = items.filter((item): boolean => typeof item === 'object' && item !== null);
  for (const obj of objects) {
    stack.push({ node: obj, depth: depth + 1 });
  }
  return objects.length;
}

/**
 * Push child values of an object onto the stack.
 * @param stack - Exploration stack.
 * @param obj - Object whose values to push.
 * @param depth - Current depth.
 * @returns Number of items pushed.
 */
function pushObjectChildren(
  stack: IStackEntry[],
  obj: Record<string, unknown>,
  depth: number,
): number {
  const values = Object.values(obj);
  for (const value of values) {
    stack.push({ node: value, depth: depth + 1 });
  }
  return values.length;
}

/**
 * Commit a txn-shaped array onto the LIFO collector. Pulled out so
 * {@link handleArrayNode} stays a single guard + dispatch.
 *
 * @param node - Array of txn-like items already scored above threshold.
 * @param collected - Mutable accumulator.
 * @returns Always true (sentinel for callers).
 */
function commitArrayNode(node: readonly UntypedValue[], collected: UntypedValue[]): true {
  for (const item of node) collected.push(item);
  return true;
}

/**
 * Handle an array node during LIFO traversal.
 * @param ctx - Array node context.
 * @returns True if items were collected.
 */
function handleArrayNode(ctx: IArrayNodeCtx): boolean {
  if (ctx.node.length === 0) return false;
  const score = scoreTxnSignature(ctx.node[0]);
  if (score < MIN_TXN_SCORE) {
    pushArrayChildren(ctx.stack, ctx.node, ctx.depth);
    return false;
  }
  return commitArrayNode(ctx.node, ctx.collected);
}

/**
 * Dispatch a LIFO array entry — bundles the args into an
 * {@link IArrayNodeCtx} and forwards to {@link handleArrayNode}.
 * Pulled out so {@link processStackEntry} stays a flat dispatcher.
 *
 * @param entry - Stack entry with `node: readonly UntypedValue[]`.
 * @param collected - Mutable accumulator.
 * @param stack - Exploration stack.
 * @returns True if items were collected.
 */
function dispatchArrayStackEntry(
  entry: IStackEntry,
  collected: UntypedValue[],
  stack: IStackEntry[],
): boolean {
  const node = entry.node as unknown[];
  const ctx: IArrayNodeCtx = { collected, stack, node, depth: entry.depth };
  return handleArrayNode(ctx);
}

/**
 * Process one stack entry: dispatch array vs object.
 * @param entry - Stack entry to process.
 * @param collected - Accumulator for items.
 * @param stack - Exploration stack.
 * @returns True if the entry was processed.
 */
function processStackEntry(
  entry: IStackEntry,
  collected: UntypedValue[],
  stack: IStackEntry[],
): boolean {
  if (entry.depth > MAX_ARRAY_DEPTH) return false;
  if (Array.isArray(entry.node)) return dispatchArrayStackEntry(entry, collected, stack);
  const isObj = typeof entry.node === 'object' && entry.node !== null;
  if (!isObj) return false;
  pushObjectChildren(stack, entry.node as Record<string, unknown>, entry.depth);
  return true;
}

/**
 * Process one LIFO iteration — pop last entry and process it.
 * @param stack - Mutable stack.
 * @param collected - Mutable accumulator.
 * @returns True if stack is now empty.
 */
function processOneLifo(stack: IStackEntry[], collected: UntypedValue[]): boolean {
  // `Array.pop` returns `undefined` on an empty stack, consolidating the
  // "stack is drained" signal into a single check.
  const entry = stack.pop();
  if (entry === undefined) return true;
  processStackEntry(entry, collected, stack);
  return stack.length === 0;
}

/** Hard cap on iterations — defends against pathological cycles. */
const MAX_DRAIN_ITERATIONS = 1_000_000;

/**
 * LIFO drain — bounded iterative loop. Processes stack entries until
 * either (a) the first qualifying array is collected, (b) the stack
 * is exhausted, or (c) MAX_DRAIN_ITERATIONS fires (pathological-cycle
 * defense).
 *
 * Previously kept draining past the first match because `processOneLifo`
 * only reports "stack empty", not "array found" — so later sibling
 * arrays would be appended into `collected` and `findFirstArray` would
 * silently merge multiple arrays' items together, violating its
 * "first" contract (CodeRabbit PR #277 follow-up Finding 2).
 *
 * The `collected.length === 0` check in the loop condition becomes
 * false after `handleArrayNode` appends a high-signature array, so the
 * next iteration exits cleanly. Depth-1 compliant (no nested `if`).
 * @param stack - Mutable stack.
 * @param collected - Mutable accumulator.
 * @returns Collected items.
 */
function drainLifoStack(stack: IStackEntry[], collected: UntypedValue[]): readonly UntypedValue[] {
  let isDone = false;
  for (let i = 0; i < MAX_DRAIN_ITERATIONS && !isDone && collected.length === 0; i += 1) {
    isDone = processOneLifo(stack, collected);
  }
  return collected;
}

/**
 * Predicate: does `value` look like an array of object-shape items?
 * Excludes arrays of primitives (string[], number[], boolean[])
 * because the BFS fallback's downstream callers expect record-like
 * items they can BFS into. Per CodeRabbit PR #277 review.
 * @param value - Candidate value.
 * @returns True when value is an array containing at least one object.
 */
function isObjectArray(value: unknown): value is readonly UntypedValue[] {
  if (!Array.isArray(value)) return false;
  return value.some((item): boolean => typeof item === 'object' && item !== null);
}

/**
 * BFS fallback used when the LIFO drain finds no leaf-array. Scans
 * the entire object tree for any property whose value is an array
 * of OBJECTS (primitive arrays excluded) and returns the first hit.
 * @param obj - Root API record to search.
 * @returns First object-array discovered, or `[]` when none exists.
 */
function findArrayByBfsFallback(obj: ApiRecord): readonly UntypedValue[] {
  const allObjects = flattenObjectTree(obj);
  const arrays = allObjects.map((o): readonly UntypedValue[] | false => {
    const arr = Object.values(o).find(isObjectArray);
    if (arr) return arr;
    return false;
  });
  const hit = arrays.find((a): a is readonly UntypedValue[] => a !== false);
  return hit ?? [];
}

/**
 * Drain the LIFO stack and return the collected items when the
 * primary scan landed any hits. Pulled out so {@link findFirstArray}
 * stays a thin guard/branch.
 *
 * @param root - Root API record to scan.
 * @returns Collected items, or `false` to signal a primary-scan miss.
 */
function runLifoScan(root: ApiRecord): readonly UntypedValue[] | false {
  const initial: IStackEntry = { node: root, depth: 0 };
  const stack: IStackEntry[] = [initial];
  const collected: UntypedValue[] = [];
  drainLifoStack(stack, collected);
  if (collected.length === 0) return false;
  LOG.debug({ message: `findFirstArray: collected ${String(collected.length)} items` });
  return collected;
}

/**
 * Find the first array of objects in a nested structure via LIFO traversal.
 * @param obj - Root API record to search.
 * @returns First array of searchable items found.
 */
function findFirstArray(obj: ApiRecord): readonly UntypedValue[] {
  const lifoHit = runLifoScan(obj);
  if (lifoHit !== false) return lifoHit;
  LOG.debug({ message: 'findFirstArray: falling back to BFS' });
  return findArrayByBfsFallback(obj);
}

export default findFirstArray;
