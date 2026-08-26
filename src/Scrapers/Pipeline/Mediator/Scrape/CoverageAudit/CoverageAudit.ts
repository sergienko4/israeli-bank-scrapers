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
import { huntTransactionGroups, type TxnGroup } from '../FieldHunt/TxnHunt.js';
import { maxMerge, tallyBy } from '../Multiset.js';
import { autoMapTransaction } from '../TxnMapper/TxnMapper.js';

const LOG = getDebug(import.meta.url);

/** Outcome of one reconciliation round. Counts only — never row content. */
export interface ICoverageResult {
  /** Transaction copies the bank shape returned. */
  readonly extracted: number;
  /** Transaction copies discoverable in the body that the mapper could read. */
  readonly hunted: number;
  /** Hunted copies the shape did not return. Above zero means loss. */
  readonly unread: number;
  /**
   * True when the round had nothing comparable to check against — see
   * {@link isUnaudited}. A `false` here is what lets `unread === 0` mean "the
   * comparison ran and found no shortfall" rather than "the comparison was
   * empty". It does not certify that the comparison was exhaustive: only a
   * total absence of comparable rows is detected, not a partial one.
   */
  readonly unaudited: boolean;
}

/** Whether a hunted row belongs to the account being audited. */
export type OwnsRow = (row: object) => boolean;

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
  /**
   * Narrows hunted rows to the account being audited. Omit when the response
   * is already per-account — only merged-response banks need it.
   */
  readonly ownsRow?: OwnsRow;
}

/**
 * Default ownership: a per-account response carries this account's rows only.
 * @returns Always true — every hunted row counts for the account being audited.
 */
export const OWNS_EVERY_ROW: OwnsRow = (): boolean => true;

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
 * will happily return schema descriptors or summary blocks. Dropping what the
 * mapper cannot read is what keeps the guardrail quiet on healthy banks.
 *
 * This is a comparability filter, not a ruling on what counts as a transaction.
 * A genuine charge written in the provider's own vocabulary is dropped here
 * too — which is the blind round {@link isUnaudited} exists to surface.
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
 * Every transaction the response carries **for this account**, counted once per
 * genuine copy.
 *
 * Hunts the whole body first and narrows afterwards, rather than auditing a
 * pre-filtered slice: a container the shape never reads is still discovered, so
 * the guardrail keeps its teeth on merged-response banks instead of being
 * quietly switched off for them.
 *
 * Merges the containers by largest count rather than by sum: a transaction
 * cross-listed in a summary container and a detail container is one
 * transaction, and summing would accuse a correct shape of losing a row that
 * never existed. Multiplicity inside a single container, by contrast, is real.
 *
 * @param body - Raw response body for the round.
 * @param ownsRow - Ownership test for the account under audit.
 * @param isCardIssuer - Card-issuer hint for key derivation.
 * @returns Mapped key to the number of genuine copies.
 */
function huntedCounts(body: object, ownsRow: OwnsRow, isCardIssuer?: boolean): Map<string, number> {
  const groups = huntTransactionGroups(body as ApiRecord);
  const owned = groups.map((group): TxnGroup => group.filter(ownsRow));
  const perContainer = owned.map((g): Map<string, number> => countsOf(g, isCardIssuer));
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
 * Whether the round compared against nothing at all.
 *
 * An empty hunt set makes {@link unreadCount} fold to zero, which reads exactly
 * like a clean reconciliation and is the one verdict this module must never
 * emit on faith. It means the hunter produced no comparable transaction from a
 * body the shape did read rows out of — either because it recognised nothing,
 * or because every row it found was rejected by the mapper as unreadable.
 *
 * Measured live on PayBox, whose extractor canonicalises rows before returning
 * them: every extracted row mapped, every hunted row was rejected as unmappable
 * because the raw response names its fields `ts` and `amt`, and the round
 * reported `complete (extracted=43 hunted=0)`. A shape in that state can drop a
 * whole container and still read green, which is the defect this module exists
 * to catch.
 *
 * Counts the rows the shape **returned**, not the mappable subset of them. A
 * shape that hands back rows still in the provider's vocabulary empties both
 * sides of the comparison, and keying off the mapped total would then read that
 * round as an empty response — the identical false green by a second route.
 * A genuinely empty response returns no rows at all, so it still reads
 * `complete` — the correct answer for a period with no activity.
 *
 * Detects total failure only. A round that hunted three comparable rows out of
 * forty is not flagged, so a false verdict is not the same as a proven one:
 * `unaudited === false` means the comparison ran, not that it was exhaustive.
 *
 * @param hunted - Comparable transaction copies recovered from the body.
 * @param returned - Rows the shape handed back, before the comparability filter.
 * @returns True when rows were returned but none were comparable.
 */
function isUnaudited(hunted: number, returned: number): boolean {
  return hunted === 0 && returned > 0;
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
  if (result.unaudited)
    return `coverage ${label}: UNAUDITED — no comparable hunted rows (${detail})`;
  if (result.unread === 0) return `coverage ${label}: complete (${detail})`;
  return `coverage ${label}: INCOMPLETE — unread=${String(result.unread)} (${detail})`;
}

/**
 * Emit the coverage verdict. Counts and the caller-supplied label only — row
 * content never reaches the log, per logging-pii-guidlines.md.
 *
 * An unaudited round warns alongside a genuine shortfall, because both leave an
 * operator in the same position: this page's coverage is not known to be good.
 *
 * @param label - Bank + step identity.
 * @param result - Counts for the round.
 * @returns The same counts, so callers can report and return in one step.
 */
function reportCoverage(label: string, result: ICoverageResult): ICoverageResult {
  const message = coverageMessage(label, result);
  const isReconciled = result.unread === 0 && !result.unaudited;
  if (isReconciled) LOG.debug({ message });
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
  const ownsRow = args.ownsRow ?? OWNS_EVERY_ROW;
  const { body, isCardIssuer } = args;
  const hunted = huntedCounts(body, ownsRow, isCardIssuer);
  const totals = { extracted: totalOf(extracted), hunted: totalOf(hunted) };
  const unread = unreadCount(hunted, extracted);
  const isBlind = isUnaudited(totals.hunted, args.extracted.length);
  return reportCoverage(args.label, { ...totals, unread, unaudited: isBlind });
}
