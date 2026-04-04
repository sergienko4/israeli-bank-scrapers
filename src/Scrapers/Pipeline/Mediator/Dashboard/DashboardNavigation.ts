/**
 * Dashboard navigation — trigger organic dashboard, date filter.
 * API context builder in DashboardApiContext.ts.
 */

import type { SelectorCandidate } from '../../../Base/Config/LoginConfig.js';
import { WK_DASHBOARD } from '../../Registry/WK/DashboardWK.js';
import { getDebug as createLogger } from '../../Types/Debug.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import type { Procedure } from '../../Types/Procedure.js';
import { succeed } from '../../Types/Procedure.js';
import type { IElementMediator } from '../Elements/ElementMediator.js';
import { resolveAbsoluteHref } from './DashboardDiscovery.js';
import { extractTransactionHref } from './DashboardHrefExtraction.js';

export { buildApiContext } from '../Dashboard/DashboardApiContext.js';

const LOG = createLogger('dashboard-nav');
const ORGANIC_IDLE_MS = 15000;
const DATE_FILTER_TIMEOUT_MS = 5000;

/**
 * Safely navigate and wait for idle.
 * @param mediator - Element mediator.
 * @param url - Target URL.
 * @returns True after navigation.
 */
async function safeNavigate(mediator: IElementMediator, url: string): Promise<boolean> {
  await mediator.navigateTo(url).catch((): false => false);
  await mediator.waitForNetworkIdle(ORGANIC_IDLE_MS).catch((): false => false);
  return true;
}

/**
 * Try to fill date and click apply after filter panel opened.
 * @param mediator - Element mediator.
 * @returns Succeed after apply or skip.
 */
async function fillAndApplyFilter(mediator: IElementMediator): Promise<Procedure<void>> {
  const dateFrom = WK_DASHBOARD.DATE_FROM as unknown as readonly SelectorCandidate[];
  const dateField = await mediator.resolveVisible(dateFrom, DATE_FILTER_TIMEOUT_MS);
  if (!dateField.found) return succeed(undefined);
  LOG.debug({
    event: 'generic-trace',
    phase: 'dashboard',
    message: `date filter FOUND: ${maskVisibleText(dateField.value)}`,
  });
  await mediator.resolveField('dateFrom', dateFrom).catch((): false => false);
  const applyBtn = WK_DASHBOARD.FILTER_APPLY as unknown as readonly SelectorCandidate[];
  await mediator.resolveAndClick(applyBtn);
  await mediator.waitForNetworkIdle(ORGANIC_IDLE_MS).catch((): false => false);
  return succeed(undefined);
}

/**
 * Open filter panel and apply date filter.
 * @param mediator - Element mediator.
 * @returns Succeed after filter or skip.
 */
async function triggerDateFilter(mediator: IElementMediator): Promise<Procedure<void>> {
  const filterTrigger = WK_DASHBOARD.FILTER_TRIGGER as unknown as readonly SelectorCandidate[];
  const triggerClick = await mediator.resolveAndClick(filterTrigger);
  LOG.debug({
    event: 'generic-trace',
    phase: 'dashboard',
    message: `filter trigger: found=${String(triggerClick.success && triggerClick.value.found)}`,
  });
  return fillAndApplyFilter(mediator);
}

/**
 * Trigger organic data loading via dashboard navigation.
 * Uses discovered targetUrl from DOM — zero hardcoded paths.
 * @param mediator - Element mediator.
 * @param targetUrl - Dashboard target URL discovered by PRE from DOM.
 * @returns Succeed after navigation.
 */
/**
 * Fallback: extract transaction href from current page DOM.
 * @param mediator - Element mediator.
 * @returns Resolved absolute URL or empty.
 */
async function extractFallbackUrl(mediator: IElementMediator): Promise<string> {
  LOG.debug({
    event: 'generic-trace',
    phase: 'dashboard',
    message: 'no target URL — extracting from current page',
  });
  const txnHref = await extractTransactionHref(mediator);
  const currentUrl = mediator.getCurrentUrl();
  return resolveAbsoluteHref(txnHref, currentUrl);
}

/**
 * Trigger organic data loading via dashboard navigation.
 * Uses discovered targetUrl from DOM — zero hardcoded paths.
 * @param mediator - Element mediator.
 * @param targetUrl - Dashboard target URL discovered by PRE from DOM.
 * @returns Succeed after navigation.
 */
async function triggerOrganicDashboard(
  mediator: IElementMediator,
  targetUrl: string,
): Promise<Procedure<void>> {
  const resolvedUrl = targetUrl || (await extractFallbackUrl(mediator));
  if (!resolvedUrl) return succeed(undefined);
  LOG.debug({
    event: 'navigation',
    phase: 'dashboard',
    url: maskVisibleText(resolvedUrl),
    didNavigate: true,
  });
  await safeNavigate(mediator, resolvedUrl);
  const landed = mediator.getCurrentUrl();
  LOG.debug({
    event: 'navigation',
    phase: 'dashboard',
    url: maskVisibleText(landed),
    didNavigate: true,
  });
  return triggerDateFilter(mediator);
}

export { triggerOrganicDashboard };
