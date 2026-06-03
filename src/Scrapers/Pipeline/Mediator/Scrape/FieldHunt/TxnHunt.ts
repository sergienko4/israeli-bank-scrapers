/**
 * Transaction hunt — depth-first iterative walk that collects
 * every txn-like array in a nested API response. Powers
 * `huntTransactions`, used by ContainerPicker's primary extractor.
 *
 * Sub-split out of FieldHunt.ts during Phase 5 to keep both files
 * under the per-cluster max-lines:150 eff cap (master plan
 * pipeline-decoupling-master-2026-05-28 / phase-5).
 */

import { type ApiRecord } from '../AutoMapperFacade/AutoMapperTypes.js';
import { MIN_TXN_SCORE, scoreTxnSignature } from '../BfsFieldSearch/TxnSignature.js';

/** Max depth for transaction hunting. */
const MAX_HUNT_DEPTH = 20;

/** Stack entry for iterative tree walk. */
interface IHuntEntry {
  readonly val: unknown;
  readonly depth: number;
}

/** Bundled args for array processing. */
interface IHuntArrayArgs {
  readonly objects: readonly unknown[];
  readonly depth: number;
  readonly collected: ApiRecord[];
  readonly stack: IHuntEntry[];
}

/**
 * Push the array's object children onto the hunt stack as the
 * "not-a-txn-array" fallback. Splitting this out keeps
 * {@link processHuntArray} body short enough to satisfy the cap.
 *
 * @param objects - Object children of the candidate array.
 * @param depth - Current BFS depth.
 * @param stack - Mutable hunt stack to extend.
 * @returns True after pushing (sentinel for callers).
 */
function pushNonTxnObjects(objects: readonly unknown[], depth: number, stack: IHuntEntry[]): true {
  const children = objects.map((o): IHuntEntry => ({ val: o, depth: depth + 1 }));
  stack.push(...children);
  return true;
}

/**
 * Commit a txn-shaped array onto the hunt collector. Pulled out so
 * {@link processHuntArray} stays within the per-function LoC budget
 * and the assert-style cast lives at the seam where the score check
 * has already validated the shape.
 *
 * @param args - Bundled hunt array arguments (collected + objects).
 * @returns Always true (sentinel for callers).
 */
function commitTxnArray(args: IHuntArrayArgs): true {
  args.collected.push(...(args.objects as ApiRecord[]));
  return true;
}

/**
 * Process one array node — collect if txn-like, else push children.
 * @param args - Bundled hunt array arguments.
 * @returns True if collected.
 */
function processHuntArray(args: IHuntArrayArgs): boolean {
  const { objects, depth, stack } = args;
  if (objects.length === 0) return false;
  const score = scoreTxnSignature(objects[0]);
  if (score >= MIN_TXN_SCORE) return commitTxnArray(args);
  pushNonTxnObjects(objects, depth, stack);
  return false;
}

/**
 * Build the next-depth child hunt entries from a record's values.
 * Pulled out so {@link processHuntObject} stays under the LoC budget.
 * @param record - Object to expand.
 * @param depth - Current depth (children get depth+1).
 * @returns Hunt entries with non-null object children.
 */
function buildHuntChildren(record: Record<string, unknown>, depth: number): readonly IHuntEntry[] {
  return Object.values(record)
    .filter((v): boolean => typeof v === 'object' && v !== null)
    .map((v): IHuntEntry => ({ val: v, depth: depth + 1 }));
}

/**
 * Process one object node — push child values onto stack.
 * @param record - Object to expand.
 * @param depth - Current depth.
 * @param stack - Mutable stack.
 * @returns True after pushing.
 */
function processHuntObject(
  record: Record<string, unknown>,
  depth: number,
  stack: IHuntEntry[],
): boolean {
  const children = buildHuntChildren(record, depth);
  stack.push(...children);
  return true;
}

/** Bundled args for processArrayEntry. */
interface IArrayEntryArgs {
  readonly val: readonly unknown[];
  readonly depth: number;
  readonly collected: ApiRecord[];
  readonly stack: IHuntEntry[];
}

/**
 * Process an array entry off the hunt stack — filters to object
 * children and delegates to {@link processHuntArray}. Pulled out so
 * {@link processHuntEntry} stays within the per-function LoC budget.
 *
 * @param args - Bundled array-entry arguments.
 * @returns True if the array was collected as a txn list.
 */
function processArrayEntry(args: IArrayEntryArgs): boolean {
  const { val, depth, collected, stack } = args;
  const objects = val.filter((v): boolean => typeof v === 'object' && v !== null);
  return processHuntArray({ objects, depth, collected, stack });
}

/**
 * Dispatch an array value to {@link processArrayEntry}.
 * Pulled out so {@link dispatchHuntValue} stays under the LoC budget.
 * @param entry - Stack entry whose value is an array.
 * @param collected - Mutable collector.
 * @param stack - Mutable hunt stack.
 * @returns True if the array was collected as a txn list.
 */
function dispatchHuntArray(
  entry: IHuntEntry,
  collected: ApiRecord[],
  stack: IHuntEntry[],
): boolean {
  const val = entry.val as readonly unknown[];
  return processArrayEntry({ val, depth: entry.depth, collected, stack });
}

/**
 * Dispatch a stack value to the array or object handler. Returns
 * `false` for primitives / null / depth-overflow so the parent can
 * surface a single "no progress" sentinel.
 *
 * @param entry - Stack entry whose value to dispatch.
 * @param collected - Mutable collector.
 * @param stack - Mutable hunt stack.
 * @returns True if processed; false on overflow / non-object.
 */
function dispatchHuntValue(
  entry: IHuntEntry,
  collected: ApiRecord[],
  stack: IHuntEntry[],
): boolean {
  const { val, depth } = entry;
  if (Array.isArray(val)) return dispatchHuntArray(entry, collected, stack);
  if (typeof val !== 'object' || val === null) return false;
  return processHuntObject(val as Record<string, unknown>, depth, stack);
}

/**
 * Process one stack entry — dispatch array vs object.
 * @param entry - Entry to process.
 * @param collected - Mutable collector.
 * @param stack - Mutable stack.
 * @returns True if processed.
 */
function processHuntEntry(entry: IHuntEntry, collected: ApiRecord[], stack: IHuntEntry[]): boolean {
  if (entry.depth > MAX_HUNT_DEPTH) return false;
  return dispatchHuntValue(entry, collected, stack);
}

/**
 * Pop the next stack entry (if any) and dispatch through
 * `processHuntEntry`. Extracted from `drainHuntStack` so the
 * iteration loop stays at depth 1 per the project's max-depth=1
 * rule — the `if (entry !== undefined)` guard lives here at the
 * helper's own depth-1 level.
 * @param stack - Mutable stack (mutated via pop).
 * @param collected - Mutable accumulator.
 * @returns True when an entry was processed, false when the stack was empty.
 */
function popAndProcess(stack: IHuntEntry[], collected: ApiRecord[]): boolean {
  const entry = stack.pop();
  if (entry === undefined) return false;
  processHuntEntry(entry, collected, stack);
  return true;
}

/**
 * Drain the hunt stack — iterative loop processes entries until
 * the stack is empty.
 *
 * Previously implemented as tail recursion. JavaScript engines do
 * NOT reliably perform tail-call optimization, so adversarial
 * response trees with deep nesting could still hit
 * `RangeError: Maximum call stack size exceeded`. CodeRabbit PR
 * #277 review flagged the regression — replaced with a plain `while`
 * loop that has the same semantics without stack risk.
 * @param stack - Mutable stack.
 * @param collected - Mutable collector.
 * @returns Collected transaction items.
 */
function drainHuntStack(stack: IHuntEntry[], collected: ApiRecord[]): readonly ApiRecord[] {
  while (stack.length > 0) {
    popAndProcess(stack, collected);
  }
  return collected;
}

/**
 * Stack-based iterative transaction hunter.
 * Walks the response tree. Collects arrays whose items score as transactions.
 * @param responseBody - Raw API response.
 * @returns Flat array of transaction-like items.
 */
function huntTransactions(responseBody: ApiRecord): readonly ApiRecord[] {
  const stack: IHuntEntry[] = [{ val: responseBody, depth: 0 }];
  return drainHuntStack(stack, []);
}

export default huntTransactions;
