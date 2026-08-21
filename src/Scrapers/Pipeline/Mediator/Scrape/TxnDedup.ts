/**
 * Opt-in duplicate collapse for shapes that declare a row key.
 *
 * `fetchPaginated` concatenates pages blindly, so a provider that ignores the
 * cursor and re-serves a page emits every row on it twice. PayBox solves that
 * inside its own cursor logic; nothing solves it generically.
 *
 * Collapsing is **destructive**, which is why it is opt-in and why it refuses to
 * act on a key alone. Measured across captured traffic for all nine pipeline
 * banks, neither obvious key is safe:
 *
 * - `identifier` is not unique. Beinleumi repeats it 33 times across 42
 *   distinct rows; Leumi and Yahav repeat it too. Collapsing on it would have
 *   deleted most of a Beinleumi statement.
 * - date + amount + description collides on genuinely distinct rows — Isracard
 *   and Amex each carry one such pair. Two identical coffees on the same day
 *   are two transactions, not one.
 *
 * So a declared key only nominates candidates: a row is collapsed only when its
 * key **and** its full content match a row already kept. A key that matches
 * while content differs is a mis-declared key, and the row is kept and reported
 * rather than deleted. Deleting a row we cannot prove redundant is the same
 * silent loss this module sits next to {@link applyStartWindow} to prevent.
 *
 * No bank declares a key today. The measurements above are the evidence a bank
 * needs before one is added.
 */

import type { ITransaction } from '../../../../Transactions.js';
import { getDebug } from '../../Logging/Debug.js';

const LOG = getDebug(import.meta.url);

/** Separator for composite keys — not valid inside a canonical field value. */
const KEY_SEP = '\u0000';

/** Inputs for one dedup round. */
export interface IDedupArgs {
  /** Mapped transactions for one account, in the order the pages arrived. */
  readonly txns: readonly ITransaction[];
  /** Canonical field names the shape declares as a row key. Empty ⇒ disabled. */
  readonly keyFields: readonly string[];
  /** Bank + step identity for the log line. Never contains row content. */
  readonly label: string;
}

/** Outcome of one dedup round. Counts only — never row content. */
export interface IDedupResult {
  /** Rows in arrival order with provably redundant repeats removed. */
  readonly kept: readonly ITransaction[];
  /** Repeats removed. Above zero means a page was served more than once. */
  readonly collapsed: number;
  /** Rows sharing a key but not content. Above zero means the key is wrong. */
  readonly collisions: number;
}

/** Row key to every distinct content fingerprint seen under it. */
type Seen = Map<string, Set<string>>;

/**
 * Read one canonical field as text.
 *
 * @param txn - Mapped transaction.
 * @param field - Canonical field name.
 * @returns Field value as text, or `''` when the row omits it.
 */
function fieldText(txn: ITransaction, field: string): string {
  const bag = txn as unknown as Record<string, unknown>;
  const value = bag[field];
  const isText = typeof value === 'string';
  if (isText) return value;
  const isScalar = typeof value === 'number' || typeof value === 'boolean';
  return isScalar ? String(value) : '';
}

/**
 * Build the declared row key.
 *
 * @param txn - Mapped transaction.
 * @param keyFields - Canonical field names the shape declared.
 * @returns Composite key text.
 */
function rowKey(txn: ITransaction, keyFields: readonly string[]): string {
  return keyFields.map((f): string => fieldText(txn, f)).join(KEY_SEP);
}

/**
 * Fingerprint the whole row, so a collapse can be proven rather than assumed.
 *
 * @param txn - Mapped transaction.
 * @returns Content fingerprint covering every canonical field.
 */
function rowContent(txn: ITransaction): string {
  return JSON.stringify(txn);
}

/**
 * Record one row and report whether its exact content was already kept.
 *
 * Tracks a set of contents per key rather than the last one, so an A, B, A
 * sequence under one key still recognises the second A.
 *
 * @param seen - Contents already recorded, keyed by declared row key.
 * @param key - Declared row key.
 * @param content - Full-row content fingerprint.
 * @returns True when this exact row was already kept.
 */
function isRedundant(seen: Seen, key: string, content: string): boolean {
  const contents = seen.get(key) ?? new Set<string>();
  const isRepeat = contents.has(content);
  contents.add(content);
  seen.set(key, contents);
  return isRepeat;
}

/**
 * Decide whether to keep one row.
 *
 * @param seen - Contents already recorded, keyed by declared row key.
 * @param txn - Mapped transaction under test.
 * @param keyFields - Canonical field names the shape declared.
 * @returns True when the row is not a proven repeat.
 */
function isAdmitted(seen: Seen, txn: ITransaction, keyFields: readonly string[]): boolean {
  const key = rowKey(txn, keyFields);
  const content = rowContent(txn);
  return !isRedundant(seen, key, content);
}

/**
 * Count keys that cover more than one distinct row.
 *
 * @param seen - Row key to every distinct content fingerprint seen under it.
 * @returns Number of surplus rows sharing a key with different content.
 */
function countCollisions(seen: ReadonlyMap<string, Set<string>>): number {
  const surplus = [...seen.values()].map((c): number => c.size - 1);
  return surplus.reduce((a, b): number => a + b, 0);
}

/**
 * Build the one-line dedup verdict.
 *
 * @param label - Bank + step identity.
 * @param result - Counts for the round.
 * @returns Log message carrying counts only.
 */
function dedupMessage(label: string, result: IDedupResult): string {
  const detail = `kept=${String(result.kept.length)} collapsed=${String(result.collapsed)}`;
  if (result.collisions === 0) return `dedup ${label}: ${detail}`;
  return `dedup ${label}: KEY NOT UNIQUE — collisions=${String(result.collisions)} (${detail})`;
}

/**
 * Emit the dedup verdict.
 *
 * <p>A collision is the actionable case: the shape declared a key the provider
 * does not honour, so the key must be corrected or withdrawn. Those rows are
 * kept, so nothing is lost while it is — but a wrong key means the collapse is
 * doing nothing useful and must not be trusted.
 *
 * @param label - Bank + step identity.
 * @param result - Counts for the round.
 * @returns True once the verdict is emitted.
 */
function reportDedup(label: string, result: IDedupResult): true {
  const message = dedupMessage(label, result);
  if (result.collisions > 0) LOG.warn({ message });
  else LOG.debug({ message });
  return true;
}

/**
 * Remove rows a page served more than once.
 *
 * @param args - Transactions, declared key fields and log identity.
 * @returns Surviving transactions plus collapse and collision counts.
 */
export function collapseDuplicates(args: IDedupArgs): IDedupResult {
  const isEnabled = args.keyFields.length > 0;
  if (!isEnabled) return { kept: args.txns, collapsed: 0, collisions: 0 };
  const seen: Seen = new Map();
  const kept = args.txns.filter((t): boolean => isAdmitted(seen, t, args.keyFields));
  const collapsed = args.txns.length - kept.length;
  const result = { kept, collapsed, collisions: countCollisions(seen) };
  reportDedup(args.label, result);
  return result;
}
