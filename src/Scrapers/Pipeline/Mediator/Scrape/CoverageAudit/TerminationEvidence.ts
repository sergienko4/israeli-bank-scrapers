/**
 * Which pagination terminations count as evidence of loss.
 *
 * `Pagination.ts` deliberately reports how a walk ended and nothing more — it
 * states outright that callers who care about data completeness map its codes
 * into their own vocabulary. This is that mapping, and it lives here rather
 * than there so the paginator keeps knowing nothing about window coverage.
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

/**
 * Terminations that leave rows the walk never saw.
 *
 * `exhausted` is the provider saying it was finished and `predicateStop` is the
 * shape saying it had enough. The two here are neither: the walk gave up on its
 * own terms while the provider was still offering more.
 */
const LOSSY_TERMINATIONS: ReadonlySet<PaginationTermination> = new Set<PaginationTermination>([
  'cursorRepeat',
  'pageCeiling',
]);

/**
 * Whether a walk's ending means rows may be missing.
 *
 * @param termination - How the paginated walk ended.
 * @returns True when the walk may have left rows unseen.
 */
export function isLossyTermination(termination: PaginationTermination): IsLossyTermination {
  const isLossy = LOSSY_TERMINATIONS.has(termination);
  return isLossy as IsLossyTermination;
}

export default isLossyTermination;
