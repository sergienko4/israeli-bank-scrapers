/**
 * DASHBOARD PRE log helpers — target-description chain + summary line
 * builder used by {@link "./DashboardPhaseActions.pre.js"}.
 *
 * <p>Co-located sibling. Split out so the parent PRE file stays under
 * the LoC cap.
 */

import { maskVisibleText } from '../../Types/LogEvent.js';
import type { IResolvedTarget } from '../../Types/PipelineContext.js';
import type { IDashboardTargets } from './DashboardPhaseActions.targets.types.js';

/** Side-effect bundle from PRE's mediator priming (carried into the log). */
interface IPreSummaryPriming {
  readonly hasExistingTraffic: boolean;
  readonly hasAuth: boolean;
}

/**
 * Build the click-target description fragment of {@link describeTargets}.
 * @param target - Resolved click target.
 * @param count - Generic-selector match count.
 * @returns Human-readable target line.
 */
function describeClickTarget(target: IResolvedTarget, count: number): string {
  const n = String(count);
  return `target=${target.contextId} > ${maskVisibleText(target.selector)} (DOM matches=${n})`;
}

/**
 * Build the menu-target description fragment of {@link describeTargets}.
 * @param menuTarget - Resolved menu target.
 * @returns Human-readable menu line.
 */
function describeMenuTarget(menuTarget: IResolvedTarget): string {
  return `menu=${menuTarget.contextId} > ${maskVisibleText(menuTarget.selector)}`;
}

/**
 * Build human-readable target description for HANDOFF log.
 * @param targets - Resolved dashboard targets.
 * @returns Description string.
 */
function describeTargets(targets: IDashboardTargets): string {
  const { clickTarget, menuTarget, hrefTarget, clickCandidateCount } = targets;
  if (clickTarget) return describeClickTarget(clickTarget, clickCandidateCount);
  if (menuTarget) return describeMenuTarget(menuTarget);
  if (hrefTarget) return `href=${maskVisibleText(hrefTarget)}`;
  return 'target=NONE';
}

/**
 * Build the PRE summary message from a resolved targets bundle and the
 * priming auth/traffic bits.
 * @param targets - Resolved dashboard targets.
 * @param priming - Priming bundle (auth + existing-traffic flags).
 * @returns Human-readable PRE summary line.
 */
function buildPreSummary(targets: IDashboardTargets, priming: IPreSummaryPriming): string {
  const targetDesc = describeTargets(targets);
  const hasAuth = String(priming.hasAuth);
  const traffic = String(priming.hasExistingTraffic);
  return `PRE: ${targetDesc}, auth=${hasAuth}, traffic=${traffic}`;
}

export type { IPreSummaryPriming };
export { buildPreSummary, describeTargets };
export default buildPreSummary;
