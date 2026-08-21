/**
 * Coverage reconciliation — a guardrail that answers the one question the
 * pipeline could never answer about itself: *did the extractor read every
 * transaction the response actually carried?*
 *
 * A bank shape names the containers it reads. When a provider adds a fourth
 * container, or renames one, the shape keeps returning rows and the run keeps
 * succeeding — it simply returns fewer. That failure is silent by
 * construction: totals are lower, no field is malformed, and nothing throws.
 * Two banks shipped in exactly that state (Isracard and Amex, each losing
 * ~41% of a real statement while logging nothing above debug).
 *
 * This module re-reads the same response body with
 * {@link huntTransactionGroups}, the schema-agnostic hunter already running in
 * production for Yahav, and reports what the shape did not return. It only
 * ever WARNS — see {@link auditCoverage} for why it must never repair.
 */

import type { ITransaction } from '../../../../../Transactions.js';
import { getDebug } from '../../../Logging/Debug.js';
import type { ApiRecord } from '../AutoMapperFacade/AutoMapperTypes.js';
import { huntTransactionGroups } from '../FieldHunt/TxnHunt.js';
import { maxMerge, tallyBy } from '../Multiset.js';
import { autoMapTransaction } from '../TxnMapper/TxnMapper.js';

const LOG = getDebug(import.meta.url);

/** Outcome of one reconciliation round. Counts only — never row content. */
export interface ICoverageResult {
  /** Distinct transactions the bank shape returned. */
  readonly extracted: number;
  /** Distinct transactions discoverable anywhere in the response body. */
  readonly hunted: number;
  /** Hunted transactions the shape did not return. Above zero means loss. */
  readonly unread: number;
}

/** Inputs for one reconciliation round. */
export interface ICoverageArgs {
  /** Raw response body, exactly as received. */
  readonly body: object;
  /** Rows the bank shape extracted from that body. */
  readonly extracted: readonly object[];
  /** Whether the institution is a card issuer, so charge signs match. */
  readonly isCardIssuer?: boolean;
  /** Bank + step identity for the log line. Never contains row content. */
  readonly label: string;
}

/**
 * Reduce a raw row to the identity the consumer ultimately sees.
 *
 * Comparing object references instead would report a false loss for every
 * transforming extractor — Yahav's BaNCS normaliser returns new objects, so
 * not one of its rows is reference-equal to the row it came from. Comparing
 * mapped output compares what actually reaches the caller.
 *
 * @param raw - Raw row from the response body.
 * @param isCardIssuer - Card-issuer hint forwarded to the mapper.
 * @returns Stable key, or false when the row is not a transaction.
 */
function mappedKey(raw: ApiRecord, isCardIssuer?: boolean): string | false {
  const txn: ITransaction | false = autoMapTransaction(raw, isCardIssuer);
  if (txn === false) return false;
  return `${txn.date}|${String(txn.chargedAmount)}|${txn.description}`;
}

/**
 * Count each row collection's mapped identities, dropping the unmappable.
 *
 * The hunter deliberately over-collects — it scores arrays heuristically and
 * will happily return schema descriptors or summary blocks. A row the mapper
 * rejects is not a transaction, so it can never be a lost one; dropping it
 * here is what keeps the guardrail quiet on healthy banks.
 *
 * Counts rather than distinct keys because a repeated charge is two
 * transactions. Collapsing to presence would let a shape return one of the two
 * and still read as complete — the silent loss this module exists to surface.
 *
 * @param rows - Raw rows to reduce.
 * @param isCardIssuer - Card-issuer hint forwarded to the mapper.
 * @returns Mapped key to the number of rows carrying it.
 */
function countsOf(rows: readonly object[], isCardIssuer?: boolean): Map<string, number> {
  return tallyBy(rows, (row): string | false => mappedKey(row as ApiRecord, isCardIssuer));
}

/**
 * Every transaction the response carries, counted once per genuine copy.
 *
 * Merges the containers by largest count rather than by sum: a transaction
 * cross-listed in a summary container and a detail container is one
 * transaction, and summing would accuse a correct shape of losing a row that
 * never existed. Multiplicity inside a single container, by contrast, is real.
 *
 * @param body - Raw response body.
 * @param isCardIssuer - Card-issuer hint forwarded to the mapper.
 * @returns Mapped key to the number of genuine copies.
 */
function huntedCounts(body: object, isCardIssuer?: boolean): Map<string, number> {
  const groups = huntTransactionGroups(body as ApiRecord);
  const perContainer = groups.map((group): Map<string, number> => countsOf(group, isCardIssuer));
  return maxMerge(perContainer);
}

/**
 * Total copies across every identity in a tally.
 *
 * Private by design: Rule #15 reserves nominal types for module boundaries,
 * and a fold this small earns no export.
 *
 * @param counts - Tally to total.
 * @returns Sum of all copy counts.
 */
function totalOf(counts: ReadonlyMap<string, number>): number {
  const values = [...counts.values()];
  return values.reduce((sum, count): number => sum + count, 0);
}

/**
 * Copies of each hunted transaction the shape did not return.
 *
 * @param hunted - Genuine copies discoverable in the body.
 * @param extracted - Copies the shape returned.
 * @returns Total unreturned copies across every identity.
 */
function unreadCount(
  hunted: ReadonlyMap<string, number>,
  extracted: ReadonlyMap<string, number>,
): number {
  const shortfalls = [...hunted].map(([key, count]): number => count - (extracted.get(key) ?? 0));
  return shortfalls.reduce((sum, short): number => sum + Math.max(0, short), 0);
}

/**
 * Build the one-line coverage verdict.
 *
 * @param label - Bank + step identity.
 * @param result - Counts for the round.
 * @returns Log message carrying counts only.
 */
function coverageMessage(label: string, result: ICoverageResult): string {
  const detail = `extracted=${String(result.extracted)} hunted=${String(result.hunted)}`;
  if (result.unread === 0) return `coverage ${label}: complete (${detail})`;
  return `coverage ${label}: INCOMPLETE — unread=${String(result.unread)} (${detail})`;
}

/**
 * Emit the coverage verdict. Counts and the caller-supplied label only — row
 * content never reaches the log, per logging-pii-guidlines.md.
 *
 * @param label - Bank + step identity.
 * @param result - Counts for the round.
 * @returns The same counts, so callers can report and return in one step.
 */
function reportCoverage(label: string, result: ICoverageResult): ICoverageResult {
  const message = coverageMessage(label, result);
  const isComplete = result.unread === 0;
  if (isComplete) LOG.debug({ message });
  else LOG.warn({ message });
  return result;
}

/**
 * Compare what a bank shape returned against what its response carried.
 *
 * Reports only; it never appends the missing rows. Hunted rows are found by
 * heuristic, so their provenance and field semantics are unverified —
 * injecting them into user data would trade a visible shortfall for invisible
 * corruption. The correct repair is always to teach the bank shape the
 * container it is missing, which is a reviewed code change.
 *
 * Deliberately has **no kill-switch**, unlike `WINDOW_BACKFILL`. That switch
 * guards an action — extra requests to a provider — which an operator may have
 * a real reason to stop. This is the detection layer, and it mutates nothing:
 * the only thing turning it off can achieve is hiding the shortfall it exists
 * to surface. Its cost is one walk of a body already in memory.
 *
 * @param args - Response body, extracted rows, and log identity.
 * @returns Counts for the round.
 */
export function auditCoverage(args: ICoverageArgs): ICoverageResult {
  const extracted = countsOf(args.extracted, args.isCardIssuer);
  const hunted = huntedCounts(args.body, args.isCardIssuer);
  const unread = unreadCount(hunted, extracted);
  const result = { extracted: totalOf(extracted), hunted: totalOf(hunted), unread };
  return reportCoverage(args.label, result);
}
