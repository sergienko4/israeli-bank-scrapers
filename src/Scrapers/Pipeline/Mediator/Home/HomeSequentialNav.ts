/**
 * HOME SEQUENTIAL navigation — menu toggle + child click.
 * Extracted from HomeNavHelpers to respect max-lines.
 * All WK candidates from PRE discovery — zero hardcoded values.
 */

import type { SelectorCandidate } from '../../../Base/Config/LoginConfigTypes.js';
import type { IActionMediator } from '../../Mediator/Elements/ElementMediator.js';
import type { IHomeDiscovery } from '../../Mediator/Home/HomeResolver.js';
import { humanDelay } from '../../Mediator/Timing/TimingActions.js';
import type { ScraperLogger } from '../../Types/Debug.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import type { ContextId } from '../../Types/PipelineContext.js';

/** Predicate result. */
type IsMatch = boolean;
/** Delay for CSS menu dropdown to open after toggle. */
const MENU_SETTLE_MS = 2000;
/** Default contextId for menu child candidates. */
const MAIN_CONTEXT: ContextId = 'main';

/** Short timeout for menu child probing (ms). */
const CHILD_CLICK_TIMEOUT = 2000;

/**
 * Try one menu child candidate via sealed executor.
 * Uses short timeout — submenu probing, not full nav.
 * @param executor - Sealed action mediator.
 * @param candidate - WK candidate.
 * @returns True if clicked.
 */
async function tryOneMenuChild(
  executor: IActionMediator,
  candidate: SelectorCandidate,
): Promise<IsMatch> {
  const selector = `text=${candidate.value}`;
  const clickPromise = executor
    .clickElement({ contextId: MAIN_CONTEXT, selector })
    .then((): true => true)
    .catch((): false => false);
  const timeout = humanDelay(CHILD_CLICK_TIMEOUT, CHILD_CLICK_TIMEOUT).then((): false => false);
  return Promise.race([clickPromise, timeout]);
}

/** Bundled context for reduce chain. */
interface IReduceCtx {
  readonly executor: IActionMediator;
  readonly logger: ScraperLogger;
}

/**
 * Reduce one candidate in the chain.
 * @param ctx - Executor + logger bundle.
 * @param c - WK candidate to try.
 * @param found - Whether a previous candidate already matched.
 * @returns True if this or a previous candidate matched.
 */
async function reduceCandidate(
  ctx: IReduceCtx,
  c: SelectorCandidate,
  found: IsMatch,
): Promise<IsMatch> {
  if (found) return true;
  const didClick = await tryOneMenuChild(ctx.executor, c);
  if (!didClick) return false;
  const masked = maskVisibleText(c.value);
  ctx.logger.debug({ message: `SEQUENTIAL: '${masked}'` });
  return true;
}

/**
 * SEQUENTIAL: try WK menu child candidates after toggle opens.
 * Uses reduce chain (no await-in-loop).
 * @param executor - Sealed action mediator.
 * @param candidates - WK MENU candidates from PRE.
 * @param logger - Pipeline logger.
 * @returns True if any candidate clicked.
 */
async function tryMenuChildren(
  executor: IActionMediator,
  candidates: readonly SelectorCandidate[],
  logger: ScraperLogger,
): Promise<IsMatch> {
  if (candidates.length === 0) return false;
  await humanDelay(MENU_SETTLE_MS, MENU_SETTLE_MS);
  const ctx: IReduceCtx = { executor, logger };
  const seed = Promise.resolve(false as IsMatch);
  return candidates.reduce(
    (prev, c): Promise<IsMatch> =>
      prev.then((found): Promise<IsMatch> => reduceCandidate(ctx, c, found)),
    seed,
  );
}

/**
 * Execute SEQUENTIAL click: menu child from WK candidates.
 * @param executor - Sealed action mediator.
 * @param discovery - Discovery from PRE.
 * @param logger - Pipeline logger.
 * @returns True if menu child was clicked.
 */
async function executeSequentialClick(
  executor: IActionMediator,
  discovery: IHomeDiscovery,
  logger: ScraperLogger,
): Promise<IsMatch> {
  return tryMenuChildren(executor, discovery.menuCandidates, logger);
}

export default executeSequentialClick;
export { executeSequentialClick };
