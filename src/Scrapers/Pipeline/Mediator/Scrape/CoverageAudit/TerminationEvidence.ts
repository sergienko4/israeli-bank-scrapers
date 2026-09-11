/**
 * How much doubt each pagination ending leaves about completeness.
 *
 * `Pagination.ts` deliberately reports how a walk ended and nothing more — it
 * states outright that callers who care about data completeness map its codes
 * into their own vocabulary. This is that mapping, and it lives here rather
 * than there so the paginator keeps knowing nothing about window coverage.
 *
 * <p>One ranking serves both questions asked of an ending: "is this loss?" and
 * "which of two rounds ended worse?". They were once answered by two separate
 * rules, and the rules disagreed — a walk could hold an ending that was not
 * loss while a later round had already proved loss, and the proof was dropped.
 * Deriving both from {@link TERMINATION_DOUBT} makes that disagreement
 * unrepresentable.
 *
 * <p><b>Why `predicateStop` is not loss.</b> The stop predicate is the shape's
 * own rule for "we have enough", and for a window walk it fires only once the
 * rows held already reach past the requested start. Treating it as loss would
 * make `covered` unreachable for every bank that declares one — the best
 * outcome the scrape can produce, permanently downgraded.
 *
 * <p>Nothing is lost by trusting it. A predicate that stopped the walk *before*
 * the window was covered leaves the date audit unsatisfied, and the verdict is
 * then `unproven` on that evidence alone. The date test is the independent
 * guard, so this mapping never has to second-guess a bank's predicate.
 */

import type { PaginationTermination } from '../../../Strategy/Fetch/Pagination.js';
import type { Brand } from '../../../Types/Brand.js';

/** Branded result of {@link isLossyTermination} (Rule #15 — no bare primitive return). */
export type IsLossyTermination = Brand<boolean, 'IsLossyTermination'>;

/** The provider said it was finished — nothing is outstanding. */
const DOUBT_NONE = 0;
/** The shape's own rule ended the walk — no rows are known to be missing. */
const DOUBT_SUFFICIENT = 1;
/** The walk gave up while the provider was still offering — rows may be gone. */
const DOUBT_LOSS = 2;

/**
 * Each ending scored by how much it leaves unproven, low to high.
 *
 * A map rather than a chain of comparisons, so a new termination is added by
 * scoring it here and nothing else has to change.
 */
const TERMINATION_DOUBT: ReadonlyMap<PaginationTermination, number> = new Map<
  PaginationTermination,
  number
>([
  ['exhausted', DOUBT_NONE],
  ['predicateStop', DOUBT_SUFFICIENT],
  ['cursorRepeat', DOUBT_LOSS],
  ['pageCeiling', DOUBT_LOSS],
]);

/**
 * Score one ending, treating anything unscored as loss.
 *
 * An ending nobody has ranked is one this module has not been taught about.
 * Scoring it as loss makes the omission show up as an over-cautious verdict
 * rather than as a silently clean one.
 *
 * @param termination - How the paginated walk ended.
 * @returns Its doubt score.
 */
function doubtOf(termination: PaginationTermination): number {
  return TERMINATION_DOUBT.get(termination) ?? DOUBT_LOSS;
}

/**
 * Whether a walk's ending means rows may be missing.
 *
 * @param termination - How the paginated walk ended.
 * @returns True when the walk may have left rows unseen.
 */
export function isLossyTermination(termination: PaginationTermination): IsLossyTermination {
  const isLossy = doubtOf(termination) >= DOUBT_LOSS;
  return isLossy as IsLossyTermination;
}

/**
 * Fold one round's ending into the walk's, the more doubtful one winning.
 *
 * Each backfill round runs its own paginated walk, so keeping the newest
 * answer would let a clean final round erase an earlier halt. Keeping the
 * *first* non-clean answer has the mirror flaw: an early `predicateStop` is
 * not loss, and holding it would swallow a `cursorRepeat` a later round went
 * on to prove. Ranking by doubt is what avoids both.
 *
 * @param held - Ending the walk already carries.
 * @param incoming - Ending the newest round produced.
 * @returns Whichever of the two leaves more unproven.
 */
export function worseTermination(
  held: PaginationTermination,
  incoming: PaginationTermination,
): PaginationTermination {
  const isIncomingWorse = doubtOf(incoming) > doubtOf(held);
  return isIncomingWorse ? incoming : held;
}

export default isLossyTermination;
