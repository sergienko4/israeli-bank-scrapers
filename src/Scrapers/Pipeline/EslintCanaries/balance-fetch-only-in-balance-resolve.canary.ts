/**
 * CANARY — H3 (v6): the balance fetch planner is owned by
 * BALANCE-RESOLVE alone. Other phases must not import it.
 *
 * <p>v6 architecture: SCRAPE.post emits the {@link IBalanceFetchTemplate}
 * value via a shared types seam (PipelineContext.ts), but the live
 * planner + fetch loop logic in {@code BalanceFetchPlanner.ts} is
 * consumed ONLY by {@code BalanceResolveActions.ts}. If another phase
 * imports the planner it duplicates balance work and breaks the
 * single-phase-ownership rule from
 * `general-phases-view-guidlines.md`.
 *
 * <p>This file deliberately imports the planner so {@code verify.sh}
 * can confirm `no-restricted-imports` block 8f fires. If the rule
 * degrades, BALANCE-RESOLVE could be silently bypassed by phases
 * that build their own balance plan.
 *
 * <p>Applicable guidelines:
 * <ul>
 *   <li>`general-phases-view-guidlines.md` — "100% separation between
 *       phases and sub-steps".</li>
 *   <li>`design-patterns-guidlines.md` — "Every provider integration
 *       must be isolated behind contracts/interfaces."</li>
 *   <li>`coding-principle-guidlines.md` §5 — SOLID Open/Closed.</li>
 * </ul>
 */

// Deliberate violation — only BalanceResolveActions may import this.
import { buildBalanceFetchPlan } from '../Mediator/BalanceResolve/BalanceFetchPlanner.js';

/**
 * Anchor — keeps the forbidden import live so the lint pass sees it.
 * @returns Always `'canary'`.
 */
function anchor(): string {
  void buildBalanceFetchPlan;
  return 'canary';
}

export { anchor };
