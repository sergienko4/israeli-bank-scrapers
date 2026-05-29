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
 * Process one array node — collect if txn-like, else push children.
 * @param args - Bundled hunt array arguments.
 * @returns True if collected.
 */
function processHuntArray(args: IHuntArrayArgs): boolean {
  const { objects, depth, collected, stack } = args;
  if (objects.length === 0) return false;
  const firstObj = objects[0] as ApiRecord;
  const score = scoreTxnSignature(firstObj);
  if (score >= MIN_TXN_SCORE) {
    collected.push(...(objects as ApiRecord[]));
    return true;
  }
  const children = objects.map((o): IHuntEntry => ({ val: o, depth: depth + 1 }));
  stack.push(...children);
  return false;
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
  const children = Object.values(record)
    .filter((v): boolean => typeof v === 'object' && v !== null)
    .map((v): IHuntEntry => ({ val: v, depth: depth + 1 }));
  stack.push(...children);
  return true;
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
  const { val, depth } = entry;
  if (Array.isArray(val)) {
    const objects = (val as unknown[]).filter((v): boolean => typeof v === 'object' && v !== null);
    return processHuntArray({ objects, depth, collected, stack });
  }
  if (typeof val === 'object' && val !== null) {
    return processHuntObject(val as Record<string, unknown>, depth, stack);
  }
  return false;
}

/**
 * Drain the hunt stack — process entries until empty.
 * @param stack - Mutable stack.
 * @param collected - Mutable collector.
 * @returns Collected transaction items.
 */
function drainHuntStack(stack: IHuntEntry[], collected: ApiRecord[]): readonly ApiRecord[] {
  if (stack.length === 0) return collected;
  const entry = stack.pop();
  if (entry) processHuntEntry(entry, collected, stack);
  return drainHuntStack(stack, collected);
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
