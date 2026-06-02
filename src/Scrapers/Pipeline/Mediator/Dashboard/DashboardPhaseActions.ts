/**
 * DASHBOARD phase Mediator actions -- PRE/ACTION/POST/FINAL.
 *
 * <p>Slim barrel — re-exports the 10 public functions from the
 * co-located `.ts` sibling files that hold the actual implementations.
 * Phase orchestrates ONLY. All logic lives in the siblings.
 *
 * <ul>
 *   <li>PRE     → {@link "./DashboardPhaseActions.pre.js"}</li>
 *   <li>ACTION  → {@link "./DashboardPhaseActions.action.js"}</li>
 *   <li>POST    → {@link "./DashboardPhaseActions.post.js"}</li>
 *   <li>FINAL   → {@link "./DashboardPhaseActions.final.js"}</li>
 *   <li>TARGETS → {@link "./DashboardPhaseActions.targets.js"}</li>
 *   <li>SEQ NAV → {@link "./DashboardPhaseActions.sequential.js"}</li>
 *   <li>MENU/HR → {@link "./DashboardPhaseActions.menu.js"}</li>
 *   <li>WINNERS → {@link "./DashboardPhaseActions.winners.js"}</li>
 *   <li>COMMITS → {@link "./DashboardPhaseActions.final.commit.js"}</li>
 * </ul>
 */

export { executeDashboardNavigationSealed } from './DashboardPhaseActions.action.js';
export { executeCollectAndSignal } from './DashboardPhaseActions.final.js';
export { executeValidateTraffic } from './DashboardPhaseActions.post.js';
export { executePreLocateNav } from './DashboardPhaseActions.pre.js';
export {
  buildDropdownToggleSelector,
  findDropdownToggleCandidate,
  findFirstChildInDom,
  safeProbeDropdownToggleCount,
  safeProbeExactTextCount,
  tryDashboardSequentialNav,
} from './DashboardPhaseActions.sequential.js';
