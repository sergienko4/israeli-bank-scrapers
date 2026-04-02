/**
 * Dashboard trigger — two-step UI click via WK selectors.
 * Step A: try direct WK_DASHBOARD.TRANSACTIONS click
 * Step B: expand WK_DASHBOARD.MENU_EXPAND, then retry TRANSACTIONS
 * All HTML resolution via Mediator black box.
 */

import type { SelectorCandidate } from '../../../Base/Config/LoginConfig.js';
import { WK_DASHBOARD } from '../../Registry/WK/DashboardWK.js';
import type { Procedure } from '../../Types/Procedure.js';
import { succeed } from '../../Types/Procedure.js';
import type { IElementMediator } from '../Elements/ElementMediator.js';

/** Whether a UI element was found and clicked. */
type DidClick = boolean;
/** Network idle timeout for post-click settle. */
const IDLE_TIMEOUT = 15000;
/** Timeout for WK element discovery on SPA dashboards. */
const WK_TIMEOUT = 10000;

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
 * Try direct click on WK_DASHBOARD.TRANSACTIONS.
 * @param mediator - Element mediator.
 * @returns Clicked label or false.
 */
async function tryDirectTxnClick(mediator: IElementMediator): Promise<string | false> {
  const candidates = WK_DASHBOARD.TRANSACTIONS as unknown as readonly SelectorCandidate[];
  const label = await tryWkClick(mediator, candidates);
  if (!label) return false;
  process.stderr.write(`[DASHBOARD.ACTION] Clicked '${label}' directly\n`);
  await mediator.waitForNetworkIdle(IDLE_TIMEOUT).catch((): false => false);
  return label;
}

/**
 * Try expanding collapsed menu via WK_DASHBOARD.MENU_EXPAND.
 * @param mediator - Element mediator.
 * @returns Menu label or false.
 */
async function tryExpandMenu(mediator: IElementMediator): Promise<string | false> {
  const candidates = WK_DASHBOARD.MENU_EXPAND as unknown as readonly SelectorCandidate[];
  const label = await tryWkClick(mediator, candidates);
  if (!label) return false;
  process.stderr.write(`[DASHBOARD.ACTION] Expanded '${label}' → retrying\n`);
  await mediator.waitForNetworkIdle(5000).catch((): false => false);
  return label;
}

/**
 * Click transaction link after menu expansion.
 * @param mediator - Element mediator.
 * @returns True if clicked.
 */
async function clickTxnAfterExpand(mediator: IElementMediator): Promise<DidClick> {
  const candidates = WK_DASHBOARD.TRANSACTIONS as unknown as readonly SelectorCandidate[];
  const label = await tryWkClick(mediator, candidates);
  if (!label) return false;
  process.stderr.write(`[DASHBOARD.ACTION] Clicked '${label}' after expand\n`);
  await mediator.waitForNetworkIdle(IDLE_TIMEOUT).catch((): false => false);
  return true;
}

/**
 * Two-step UI trigger: direct click → expand menu → retry.
 * @param mediator - Element mediator (black box).
 * @returns Procedure — true if transaction nav was clicked.
 */
export default async function triggerDashboardUi(
  mediator: IElementMediator,
): Promise<Procedure<DidClick>> {
  const didDirect = await tryDirectTxnClick(mediator);
  if (didDirect) return succeed(true);
  const didExpand = await tryExpandMenu(mediator);
  if (!didExpand) {
    process.stderr.write('[DASHBOARD.ACTION] No menu or txn link found\n');
    return succeed(false);
  }
  const didClick = await clickTxnAfterExpand(mediator);
  return succeed(didClick);
}

export { triggerDashboardUi };
