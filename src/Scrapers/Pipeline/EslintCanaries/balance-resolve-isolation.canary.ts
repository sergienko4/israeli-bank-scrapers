/**
 * CANARY — T49: BALANCE-RESOLVE phase MUST NOT depend on SCRAPE internals.
 *
 * <p>The v5 isolation architecture forbids the BALANCE-RESOLVE zone
 * (`src/Scrapers/Pipeline/Phases/BalanceResolve/**` and
 * `src/Scrapers/Pipeline/Mediator/BalanceResolve/BalanceResolveActions.ts`)
 * from importing anything under
 * `src/Scrapers/Pipeline/Strategy/Scrape/**` or
 * `src/Scrapers/Pipeline/Mediator/Scrape/ScrapePhaseActions.ts`.
 * BALANCE-RESOLVE consumes ONLY the typed `scrape.perAccountResponses`
 * field from {@link IPipelineContext}.
 *
 * <p>This file deliberately violates the rule with three forbidden
 * imports so {@code verify.sh} can confirm the
 * `no-restricted-imports` rule fires. If the rule degrades,
 * BALANCE-RESOLVE could quietly couple to SCRAPE internals and the
 * isolation contract from `general-phases-view-guidlines.md` would
 * silently rot.
 *
 * <p>Applicable guidelines:
 * <ul>
 *   <li>`design-patterns-guidlines.md` — "Every provider integration
 *       must be isolated behind contracts/interfaces."</li>
 *   <li>`general-rules-guidlines.md` P2 — "Each phase is a pure
 *       transformation unit."</li>
 *   <li>`coding-principle-guidlines.md` §5 — SOLID Open/Closed.</li>
 * </ul>
 */

// Deliberate violation #1 — BalanceResolve must not pull SCRAPE types.
import type { IAccountAssemblyCtx } from '../Strategy/Scrape/ScrapeTypes.js';
// Deliberate violation #2 — BalanceResolve must not pull SCRAPE per-account helpers.
import { resolveDisplayIdFromCapturedEndpoints } from '../Strategy/Scrape/Account/ScrapeIdExtraction.js';
// Deliberate violation #3 — BalanceResolve mediator must not pull SCRAPE mediator actions.
import { executeMatrixLoop } from '../Mediator/Scrape/ScrapePhaseActions.js';

/**
 * Anchor — keeps the forbidden imports live so the lint pass sees them.
 * @returns Always `'canary'`.
 */
function anchor(): string {
  void resolveDisplayIdFromCapturedEndpoints;
  void executeMatrixLoop;
  return 'canary';
}

export { anchor };
export type { IAccountAssemblyCtx };
