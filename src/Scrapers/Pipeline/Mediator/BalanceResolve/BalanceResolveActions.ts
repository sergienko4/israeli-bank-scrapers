/**
 * BALANCE-RESOLVE phase Mediator — barrel that composes the six
 * responsibility siblings (Pre / Fetch / Dispatch / Extract / Action /
 * Post / Final) into the single import surface consumed by the
 * BalanceResolve phase orchestrator.
 *
 * Phase chain position: SCRAPE → BALANCE-RESOLVE → TERMINATE.
 * Browser banks only; api-direct banks emit ctx.balanceResolution
 * from ApiDirectScrapePhase.final via per-bank shape extractors.
 *
 * v6 — SINGLE-PHASE OWNERSHIP. BALANCE-RESOLVE is the only phase that
 * touches balance:
 *   - .pre   reads SCRAPE-emitted accountIdentities + balanceFetchTemplate,
 *            builds the per-bank-account balanceFetchPlan
 *   - .action loops the plan via api.fetchPost / fetchGet, quarantines
 *            single-fetch failures, extracts per-card balance
 *   - .post  partitions resolved vs missed; hard-fails universal miss
 *   - .final emits final balanceResolution map
 */

export { executeBalanceResolveFinal } from './BalanceResolveActions.Final.js';
export { executeBalanceResolvePost } from './BalanceResolveActions.Post.js';
export { executeBalanceResolvePre } from './BalanceResolveActions.Pre.js';
export { executeBalanceResolveAction } from './BalanceResolveActions.Run.js';
