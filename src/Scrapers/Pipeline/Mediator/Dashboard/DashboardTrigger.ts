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

/** Whether a UI element was found and clicked. */
type DidClick = boolean;
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
): Promise<DidClick> {
  const masked = maskVisibleText(`Clicked '${label}'`);
  logger?.debug({ message: masked });
  const hit = await mediator.network.waitForTraffic(TXN_PATTERNS, TRAFFIC_TIMEOUT);
  if (hit) logger?.trace({ method: hit.method, url: maskVisibleText(hit.url) });
  return Boolean(hit);
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
): Promise<Procedure<DidClick>> {
  const txn = WK_DASHBOARD.TRANSACTIONS as unknown as readonly SelectorCandidate[];
  const txnLabel = await tryWkClick(mediator, txn);
  if (txnLabel) return succeed(await waitAndTrace(mediator, txnLabel, logger));
  const menu = WK_DASHBOARD.MENU_EXPAND as unknown as readonly SelectorCandidate[];
  const menuLabel = await tryWkClick(mediator, menu);
  if (menuLabel) return succeed(await waitAndTrace(mediator, menuLabel, logger));
  logger?.debug({
    message: 'No UI trigger — traffic from LOGIN',
  });
  return succeed(false);
}

export default triggerDashboardUi;
export { triggerDashboardUi };
