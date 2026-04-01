/**
 * Dashboard navigation — trigger organic dashboard, date filter.
 * API context builder in DashboardApiContext.ts.
 */

import type { SelectorCandidate } from '../../Base/Config/LoginConfig.js';
import type { IElementMediator } from '../Mediator/Elements/ElementMediator.js';
import { WK_DASHBOARD } from '../Registry/WK/DashboardWK.js';
import { getDebug as createLogger } from '../Types/Debug.js';
import type { Procedure } from '../Types/Procedure.js';
import { succeed } from '../Types/Procedure.js';
import { resolveAbsoluteHref } from './DashboardDiscoveryStep.js';
import { extractTransactionHref } from './DashboardHrefExtraction.js';

export { buildApiContext } from './DashboardApiContext.js';

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
  LOG.debug('[FORENSIC] date filter FOUND: %s', dateField.value);
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
  LOG.debug(
    '[FORENSIC] filter trigger: found=%s',
    triggerClick.success && triggerClick.value.found,
  );
  return fillAndApplyFilter(mediator);
}

/**
 * Follow transaction link and apply date filter.
 * @param mediator - Element mediator.
 * @param txnUrl - Transaction page URL.
 * @returns Succeed after forensic navigation.
 */
async function forensicNavigation(
  mediator: IElementMediator,
  txnUrl: string,
): Promise<Procedure<void>> {
  LOG.debug('[ACTION] forensic navigation to %s', txnUrl);
  await safeNavigate(mediator, txnUrl);
  const landed = mediator.getCurrentUrl();
  LOG.debug('[ACTION] forensic landed on %s', landed);
  await triggerDateFilter(mediator);
  return succeed(undefined);
}

/**
 * Trigger organic data loading via dashboard navigation.
 * @param mediator - Element mediator.
 * @param apiBase - API base URL from config.
 * @returns Succeed after navigation.
 */
async function triggerOrganicDashboard(
  mediator: IElementMediator,
  apiBase: string,
): Promise<Procedure<void>> {
  const dashUrl = `${apiBase}/personalarea/dashboard/`;
  LOG.debug('[ACTION] organic navigation to %s', dashUrl);
  await safeNavigate(mediator, dashUrl);
  const landed = mediator.getCurrentUrl();
  LOG.debug('[ACTION] landed on %s', landed);
  const txnHref = await extractTransactionHref(mediator);
  const currentUrl = mediator.getCurrentUrl();
  const txnUrl = resolveAbsoluteHref(txnHref, currentUrl);
  if (!txnUrl) return succeed(undefined);
  return forensicNavigation(mediator, txnUrl);
}

export { triggerOrganicDashboard };
