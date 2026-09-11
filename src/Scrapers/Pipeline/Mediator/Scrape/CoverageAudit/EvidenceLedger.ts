/**
 * The account-scoped, append-only record of what the scrape observed going
 * wrong while collecting one account's rows.
 *
 * Five guardrails already run on every page — the extraction audit, the
 * declared-row reconciliation, the mapper's reject count, the paginated walk's
 * own termination, and (where a bank declares one) an ordering guard. Each
 * logs and each is then thrown away, so nothing above the walk can see them.
 * This is the sink they report into.
 *
 * <p><b>Monotonic on purpose.</b> A page is audited many times per account: once
 * per page, again for every backfill round. Keeping the newest answer would let
 * a clean February page erase a January shortfall, and a final `exhausted`
 * erase an earlier halt. A channel that has fired stays fired for the life of
 * the account walk. The ledger can only grow.
 *
 * <p>It records caveat names, never row content — counts and classifications
 * are what the guardrails already log, and nothing here widens that.
 */

import type { WindowCaveat } from '../../../../../WindowCoverage.js';

/**
 * The order caveats are reported in.
 *
 * Fixed rather than insertion-ordered so the same set of observations always
 * produces the same array, whatever sequence the pages arrived in.
 */
const CAVEAT_ORDER: readonly WindowCaveat[] = Object.freeze([
  'paginationStoppedEarly',
  'declaredRowShortfall',
  'declaredRowAuditUnavailable',
  'extractionShortfall',
  'extractionAuditUnavailable',
  'mappingRejectedRows',
  'walkOrderViolated',
]);

/** Where a guardrail reports what it saw, and where the classifier reads it back. */
export interface IEvidenceLedger {
  /**
   * Record that a channel observed loss.
   *
   * @returns True when this was the channel's first report, false when it had
   *          already fired — recording twice is the same as recording once.
   */
  readonly note: (caveat: WindowCaveat) => boolean;
  /**
   * Record a channel only when the condition holds — keeps callers branch-free.
   *
   * @returns Whether the channel stands recorded after the call.
   */
  readonly noteWhen: (caveat: WindowCaveat, condition: boolean) => boolean;
  /** Every channel that fired, in {@link CAVEAT_ORDER}. Empty means all clean. */
  readonly caveats: () => readonly WindowCaveat[];
}

/**
 * Build the recorder half of a ledger over one account's observation set.
 * @param seen - The account's set of fired channels.
 * @returns A recorder reporting whether each call was the channel's first.
 */
function noterFor(seen: Set<WindowCaveat>): (caveat: WindowCaveat) => boolean {
  return (caveat: WindowCaveat): boolean => {
    const isFirst = !seen.has(caveat);
    seen.add(caveat);
    return isFirst;
  };
}

/**
 * Build the guarded recorder, so callers can report a measurement, not a branch.
 * @param seen - The account's set of fired channels.
 * @param note - The unguarded recorder to delegate to.
 * @returns A recorder that only fires when the condition holds.
 */
function conditionalNoterFor(
  seen: Set<WindowCaveat>,
  note: (caveat: WindowCaveat) => boolean,
): (caveat: WindowCaveat, condition: boolean) => boolean {
  return (caveat: WindowCaveat, condition: boolean): boolean => {
    if (condition) note(caveat);
    return seen.has(caveat);
  };
}

/**
 * Build the reader half of a ledger, reporting in the module's fixed order.
 * @param seen - The account's set of fired channels.
 * @returns A reader whose answer does not depend on observation order.
 */
function readerFor(seen: Set<WindowCaveat>): () => readonly WindowCaveat[] {
  return (): readonly WindowCaveat[] => CAVEAT_ORDER.filter((c): boolean => seen.has(c));
}

/**
 * Open a fresh ledger for one account's walk.
 *
 * One per account, never shared: two accounts of the same bank are audited
 * independently and one account's loss must not caveat the other's verdict.
 *
 * @returns A ledger holding no observations yet.
 */
export function makeEvidenceLedger(): IEvidenceLedger {
  const seen = new Set<WindowCaveat>();
  const note = noterFor(seen);
  const noteWhen = conditionalNoterFor(seen, note);
  const caveats = readerFor(seen);
  return { note, noteWhen, caveats };
}

export default makeEvidenceLedger;
