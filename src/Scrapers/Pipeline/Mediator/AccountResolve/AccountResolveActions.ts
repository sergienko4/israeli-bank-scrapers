/**
 * ACCOUNT-RESOLVE phase Mediator — barrel that composes the five
 * responsibility siblings (Wait / Failures / Classify / Discovery /
 * Post / Final) into the single import surface consumed by the
 * AccountResolve phase orchestrator.
 *
 * Strict contract: by FINAL exit, every browser bank's
 * `ctx.accountDiscovery` MUST hold at least one id (or POST fails the
 * run loud with `ACCOUNT_RESOLUTION_FAILED`).
 *
 * PURE GENERIC: works for every bank via the existing 3-source
 * predicate (`discoverAccountsInPool`).
 */

export { ACCOUNT_RESOLVE_BUDGET_MS } from '../Timing/TimingConfig.js';
export { executeAccountResolveFinal } from './AccountResolveActions.Final.js';
export { executeAccountResolvePost } from './AccountResolveActions.Post.js';
export {
  executeAccountResolveAction,
  executeAccountResolvePre,
} from './AccountResolveActions.Wait.js';
