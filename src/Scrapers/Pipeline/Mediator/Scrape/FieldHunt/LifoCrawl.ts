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
 * Handle an array node during LIFO traversal.
 * @param ctx - Array node context.
 * @returns True if items were collected.
 */
function handleArrayNode(ctx: IArrayNodeCtx): boolean {
  if (ctx.node.length === 0) return false;
  const firstNode = ctx.node[0];
  const score = scoreTxnSignature(firstNode);
  if (score < MIN_TXN_SCORE) {
    pushArrayChildren(ctx.stack, ctx.node, ctx.depth);
    return false;
  }
  for (const item of ctx.node) ctx.collected.push(item);
  return true;
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
  if (Array.isArray(entry.node)) {
    return handleArrayNode({
      collected,
      stack,
      node: entry.node,
      depth: entry.depth,
    });
  }
  const isObj = typeof entry.node === 'object' && entry.node !== null;
  if (!isObj) return false;
  const record = entry.node as Record<string, unknown>;
  pushObjectChildren(stack, record, entry.depth);
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
 * LIFO drain — iterative loop via `Array.every` short-circuit.
 * Processes every stack entry until `processOneLifo` reports the
 * stack is empty. Iterative (was tail-recursive) so adversarial
 * bodies with tens of thousands of nested items (e.g. Lottie
 * animation JSON) cannot blow Node's stack budget.
 * @param stack - Mutable stack.
 * @param collected - Mutable accumulator.
 * @returns Collected items.
 */
function drainLifoStack(stack: IStackEntry[], collected: UntypedValue[]): readonly UntypedValue[] {
  // `every` short-circuits when the predicate returns false. Each
  // step calls `processOneLifo`; when it returns true (stack drained)
  // the negation short-circuits `every` and the loop ends.
  const iterations: readonly number[] = Array.from(
    { length: MAX_DRAIN_ITERATIONS },
    (_unused, i): number => i,
  );
  iterations.every((): boolean => !processOneLifo(stack, collected));
  return collected;
}

/**
 * BFS fallback used when the LIFO drain finds no leaf-array. Scans
 * the entire object tree for any property whose value is an array
 * of objects and returns the first hit.
 * @param obj - Root API record to search.
 * @returns First object-array discovered, or `[]` when none exists.
 */
function findArrayByBfsFallback(obj: ApiRecord): readonly UntypedValue[] {
  const allObjects = flattenObjectTree(obj);
  const arrays = allObjects.map((o): readonly UntypedValue[] | false => {
    const arr = Object.values(o).find(Array.isArray);
    if (arr) return arr as readonly UntypedValue[];
    return false;
  });
  const hit = arrays.find((a): a is readonly UntypedValue[] => a !== false);
  return hit ?? [];
}

/**
 * Find the first array of objects in a nested structure via LIFO traversal.
 * @param obj - Root API record to search.
 * @returns First array of searchable items found.
 */
function findFirstArray(obj: ApiRecord): readonly UntypedValue[] {
  const initial: IStackEntry = { node: obj, depth: 0 };
  const stack: IStackEntry[] = [initial];
  const collected: UntypedValue[] = [];
  drainLifoStack(stack, collected);
  if (collected.length > 0) {
    LOG.debug({ message: `findFirstArray: collected ${String(collected.length)} items` });
    return collected;
  }
  LOG.debug({ message: 'findFirstArray: falling back to BFS' });
  return findArrayByBfsFallback(obj);
}

export default findFirstArray;
