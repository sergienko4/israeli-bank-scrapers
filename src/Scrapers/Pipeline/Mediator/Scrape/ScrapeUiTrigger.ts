/**
 * Dashboard trigger — best-effort organic UI click.
 * TRIGGER: Try ONE click, wait 5s for traffic.
 * All HTML resolution via Mediator black box. No proxy strategy
 * after the .ashx removal — every bank goes through the DIRECT path.
 */

import type { SelectorCandidate } from '../../../Base/Config/LoginConfig.js';
import { WK_DASHBOARD } from '../../Registry/WK/DashboardWK.js';
import { PIPELINE_WELL_KNOWN_API } from '../../Registry/WK/ScrapeWK.js';
import type { ScraperLogger } from '../../Types/Debug.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import type { Procedure } from '../../Types/Procedure.js';
import { succeed } from '../../Types/Procedure.js';
import type { IElementMediator } from '../Elements/ElementMediator.js';

/**
 * Slim traffic-hit shape derived from the mediator surface without
 * importing the forbidden `IDiscoveredEndpoint` symbol (R-NET-SCRAPE).
 */
type TrafficHit = Awaited<ReturnType<IElementMediator['network']['waitForTraffic']>>;

/** Best-effort timeout — don't block, traffic captured in LOGIN.POST. */
const TRAFFIC_TIMEOUT = 5000;
/** Timeout for WK element discovery. */
const WK_TIMEOUT = 5000;

/** Combined patterns for traffic-first matching. */
const TXN_PATTERNS: readonly RegExp[] = [
  ...PIPELINE_WELL_KNOWN_API.transactions,
  ...PIPELINE_WELL_KNOWN_API.accounts,
];

/**
 * Try clicking WK candidates via Mediator.
 * @param mediator - Element mediator (black box).
 * @param candidates - WK selector candidates.
 * @returns Clicked label or false.
 */
async function tryWkClick(
  mediator: IElementMediator,
  candidates: readonly SelectorCandidate[],
): Promise<string | false> {
  const result = await mediator.resolveAndClick(candidates, WK_TIMEOUT);
  if (!result.success || !result.value.found) return false;
  return result.value.value;
}

/**
 * Mask + emit the traffic hit when one arrived. Pulled out so {@link waitAndTrace}
 * stays under the per-function LoC budget.
 * @param hit - Traffic capture or false.
 * @param logger - Pipeline logger.
 * @returns Procedure carrying whether a hit was logged.
 */
function logTrafficHit(hit: TrafficHit, logger?: ScraperLogger): Procedure<boolean> {
  if (!hit) return succeed(false);
  logger?.trace({ method: hit.method, url: maskVisibleText(hit.url) });
  return succeed(true);
}

/**
 * Wait for traffic after a click, log result.
 * @param mediator - Element mediator.
 * @param label - Clicked element label.
 * @param logger - Pipeline logger.
 * @returns True if traffic matched.
 */
async function waitAndTrace(
  mediator: IElementMediator,
  label: string,
  logger?: ScraperLogger,
): Promise<boolean> {
  logger?.debug({ message: maskVisibleText(`Clicked '${label}'`) });
  const hit = await mediator.network.waitForTraffic(TXN_PATTERNS, TRAFFIC_TIMEOUT);
  const logged = logTrafficHit(hit, logger);
  return logged.success && logged.value;
}

/**
 * Try one WK selector group, returning a `succeed(true|false)`
 * procedure when the click landed. Returns `false` when no click
 * was made so the orchestrator can fall through to the next group.
 *
 * @param mediator - Element mediator (black box).
 * @param group - Selector candidates to attempt (transactions/menu).
 * @param logger - Pipeline logger.
 * @returns Procedure success, or `false` on no-match.
 */
async function tryWkGroup(
  mediator: IElementMediator,
  group: readonly SelectorCandidate[],
  logger?: ScraperLogger,
): Promise<Procedure<boolean> | false> {
  const label = await tryWkClick(mediator, group);
  if (!label) return false;
  const hasTraffic = await waitAndTrace(mediator, label, logger);
  return succeed(hasTraffic);
}

/** Tier names used by {@link tryWkTier} — keeps the orchestrator declarative. */
const TRIGGER_TIERS = ['TRANSACTIONS', 'MENU_EXPAND'] as const;

/**
 * Try one WK trigger tier; returns success procedure or false.
 * @param mediator - Element mediator (black box).
 * @param tier - Tier key in {@link WK_DASHBOARD}.
 * @param logger - Pipeline logger.
 * @returns Procedure success when the click landed, else false.
 */
function tryWkTier(
  mediator: IElementMediator,
  tier: (typeof TRIGGER_TIERS)[number],
  logger?: ScraperLogger,
): Promise<Procedure<boolean> | false> {
  const group = WK_DASHBOARD[tier] as unknown as readonly SelectorCandidate[];
  return tryWkGroup(mediator, group, logger);
}

/** Bundled args for the recursive tier walker — keeps params ≤ 3. */
interface ITierWalkArgs {
  readonly mediator: IElementMediator;
  readonly logger?: ScraperLogger;
  readonly index: number;
}

/**
 * Walk the trigger tiers sequentially without `await` inside a loop.
 * @param args - Bundled mediator + logger + current tier index.
 * @returns First successful hit, or false when all tiers exhausted.
 */
async function walkTriggerTiers(args: ITierWalkArgs): Promise<Procedure<boolean> | false> {
  if (args.index >= TRIGGER_TIERS.length) return false;
  const tier = TRIGGER_TIERS[args.index];
  const hit = await tryWkTier(args.mediator, tier, args.logger);
  if (hit !== false) return hit;
  return walkTriggerTiers({ ...args, index: args.index + 1 });
}

/**
 * Best-effort TRIGGER: ONE click attempt, short wait, then succeed.
 * @param mediator - Element mediator (black box).
 * @param logger - Pipeline logger.
 * @returns Procedure — always succeeds.
 */
async function triggerDashboardUi(
  mediator: IElementMediator,
  logger?: ScraperLogger,
): Promise<Procedure<boolean>> {
  const hit = await walkTriggerTiers({ mediator, logger, index: 0 });
  if (hit !== false) return hit;
  logger?.debug({ message: 'No UI trigger — traffic from LOGIN' });
  return succeed(false);
}

export default triggerDashboardUi;
export { triggerDashboardUi };
