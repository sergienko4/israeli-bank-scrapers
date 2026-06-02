/**
 * Shared {@link IDashboardTargets} type used by DASHBOARD PRE → ACTION.
 *
 * <p>Co-located with the {@link "./DashboardPhaseActions.targets.js"}
 * resolver: kept in a separate types file so the SEQUENTIAL probe
 * helpers can consume the type without pulling in the resolver
 * (which would create an import cycle).
 */

import type { IResolvedTarget } from '../../Types/PipelineContext.js';

/** Resolved dashboard targets from PRE -- main trigger + optional menu toggle. */
export interface IDashboardTargets {
  /** URL target (from href extraction). */
  readonly hrefTarget: string;
  /** Pre-resolved click target (winner of resolveVisible race) — IDENTITY-based
   *  selector that uniquely targets the winning element (HEAD behaviour).
   *  ACTION clicks this FIRST (no nth) so non-ambiguous banks (Isracard,
   *  Discount, etc.) hit the proven winner directly. */
  readonly clickTarget: IResolvedTarget | false;
  /** Generic-selector fallback string + DOM count, used by ACTION ONLY when
   *  the identity click yields no success signal (Beinleumi pm.mataf vs
   *  pm.q077 case: same aria-label, different element). */
  readonly fallbackSelector: string;
  /** Number of DOM matches for `fallbackSelector` in the winning frame.
   *  ≥1 when clickTarget set; 0 otherwise. ACTION iterates `.nth(0..count-1)`
   *  of fallbackSelector when identity click failed. */
  readonly clickCandidateCount: number;
  /** Pre-resolved menu toggle target for SEQUENTIAL nav. */
  readonly menuTarget: IResolvedTarget | false;
}
