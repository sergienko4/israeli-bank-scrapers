/**
 * Winner-label helpers for DASHBOARD PRE diagnostics logging.
 *
 * <p>Co-located sibling of {@link "./DashboardPhaseActions.js"} —
 * builds the human-readable "WINNER: ..." line that PRE emits after
 * resolving its target bundle. Split out so the parent file stays
 * under the LoC cap.
 */

import { maskVisibleText } from '../../Types/LogEvent.js';
import type { IPipelineContext, IResolvedTarget } from '../../Types/PipelineContext.js';
import type { IDashboardTargets } from './DashboardPhaseActions.targets.types.js';

/** Sentinel label emitted when no PRE-resolved target was found. */
const NO_WINNER_LABEL = 'WINNER: NONE — no target resolved';

/**
 * Convert the click-at sentinel (`number | false`) to a numeric value
 * suitable for logging. Returns 0 when no click was dispatched.
 * @param clickAt - The raw click-at value.
 * @returns Click timestamp in ms, or 0 when absent.
 */
function clickAtForLog(clickAt: number | false): number {
  if (clickAt === false) return 0;
  return clickAt;
}

/**
 * Build the winner label for an identity click target.
 * @param clickTarget - PRE-resolved click target.
 * @param count - Generic-selector DOM match count.
 * @returns Human-readable WINNER line.
 */
function winnerLabelClick(clickTarget: IResolvedTarget, count: number): string {
  const { kind, candidateValue, contextId } = clickTarget;
  const head = `WINNER: ${kind}="${candidateValue}" @ ${contextId}`;
  return `${head} (x${String(count)} DOM matches)`;
}

/**
 * Build the winner label for a menu-toggle target.
 * @param menuTarget - PRE-resolved menu target.
 * @returns Human-readable WINNER line.
 */
function winnerLabelMenu(menuTarget: IResolvedTarget): string {
  const { kind, candidateValue, contextId } = menuTarget;
  return `WINNER (menu): ${kind}="${candidateValue}" @ ${contextId}`;
}

/**
 * Build the winner label for an href target.
 * @param hrefTarget - Resolved href URL.
 * @returns Human-readable WINNER line.
 */
function winnerLabelHref(hrefTarget: string): string {
  return `WINNER (href): ${maskVisibleText(hrefTarget)}`;
}

/**
 * Build the winner-target label from the PRE-resolved targets bundle.
 * Picks the first present target in click → menu → href priority order.
 * @param targets - Resolved dashboard targets.
 * @returns Label string (NO_WINNER_LABEL when nothing matched).
 */
function buildWinnerLabel(targets: IDashboardTargets): string {
  const { clickTarget, menuTarget, hrefTarget, clickCandidateCount } = targets;
  if (clickTarget) return winnerLabelClick(clickTarget, clickCandidateCount);
  if (menuTarget) return winnerLabelMenu(menuTarget);
  if (hrefTarget) return winnerLabelHref(hrefTarget);
  return NO_WINNER_LABEL;
}

/**
 * Log the winning dashboard target for diagnostics.
 * @param input - Pipeline context with logger.
 * @param targets - Resolved targets.
 * @returns Description of the winning target.
 */
function logWinningTarget(input: IPipelineContext, targets: IDashboardTargets): string {
  const label = buildWinnerLabel(targets);
  input.logger.debug({ message: label });
  return label;
}

export { buildWinnerLabel, clickAtForLog, logWinningTarget, NO_WINNER_LABEL };
