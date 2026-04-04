/**
 * Dashboard trigger — Best-effort organic UI click + Proxy API trigger.
 * TRIGGER: Try ONE click, wait 5s for traffic.
 * PROXY: Fire WK proxy request via fetchStrategy, capture response.
 * All HTML resolution via Mediator black box. All request names from WK.
 */

import type { SelectorCandidate } from '../../../Base/Config/LoginConfig.js';
import type { IProxyParams } from '../../Registry/Config/PipelineBankConfig.js';
import { WK_DASHBOARD } from '../../Registry/WK/DashboardWK.js';
import { PIPELINE_WELL_KNOWN_API, PIPELINE_WELL_KNOWN_PROXY } from '../../Registry/WK/ScrapeWK.js';
import type { IFetchStrategy } from '../../Strategy/Fetch/FetchStrategy.js';
import type { ScraperLogger } from '../../Types/Debug.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import type { Procedure } from '../../Types/Procedure.js';
import { succeed } from '../../Types/Procedure.js';
import type { IElementMediator } from '../Elements/ElementMediator.js';
import { resolveDateTokens } from './DateResolver.js';

/** Whether a UI element was found and clicked. */
type DidClick = boolean;
/** URL string for proxy endpoints. */
type ProxyEndpointUrl = string;
/** Encoded query parameter string. */
type QueryParam = string;
/** Best-effort timeout — don't block, traffic captured in LOGIN.POST. */
const TRAFFIC_TIMEOUT = 5000;
/** Timeout for WK element discovery. */
const WK_TIMEOUT = 5000;
/** Proxy traffic wait timeout. */
const PROXY_TRAFFIC_TIMEOUT = 10000;

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
  logger?.debug({ event: 'generic-trace', phase: 'DASHBOARD', message: masked });
  const hit = await mediator.network.waitForTraffic(TXN_PATTERNS, TRAFFIC_TIMEOUT);
  if (hit)
    logger?.trace({ event: 'net-capture', method: hit.method, url: maskVisibleText(hit.url) });
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
    event: 'generic-trace',
    phase: 'DASHBOARD',
    message: 'No UI trigger — traffic from LOGIN',
  });
  return succeed(false);
}

/**
 * Build the proxy dashboard URL from WK pattern + resolved config params.
 * @param proxyUrl - Proxy base URL.
 * @param dashboardParams - Resolved dashboard params (e.g. { billingDate: '2026-04-01' }).
 * @returns Full URL with reqName + resolved params.
 */
function buildProxyDashboardUrl(
  proxyUrl: ProxyEndpointUrl,
  dashboardParams: Record<string, QueryParam>,
): ProxyEndpointUrl {
  const pattern = PIPELINE_WELL_KNOWN_API.proxyDashboard[0];
  const reqName = pattern.source.replaceAll('\\', '');
  const base = `${proxyUrl}?reqName=${reqName}&${PIPELINE_WELL_KNOWN_PROXY.queryDefaults}`;
  const extraParams = Object.entries(dashboardParams)
    .map(([k, v]): QueryParam => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  if (!extraParams) return base;
  return `${base}&${extraParams}`;
}

/** Bundled args for proxy dashboard trigger. */
interface IProxyTriggerArgs {
  readonly mediator: IElementMediator;
  readonly strategy: IFetchStrategy;
  readonly proxyUrl: ProxyEndpointUrl;
  readonly proxyParams?: IProxyParams;
  readonly logger?: ScraperLogger;
}

/**
 * PROXY strategy: fire GET via fetchStrategy on the proxy URL.
 * Uses WK.proxyDashboard patterns + config params with DateResolver.
 * Browser session cookies authenticate the request.
 * Network interceptor captures the response for SCRAPE discovery.
 * @param args - Bundled proxy trigger arguments.
 * @returns Procedure succeed(true) if captured, succeed(false) if failed.
 */
async function triggerProxyDashboard(args: IProxyTriggerArgs): Promise<Procedure<DidClick>> {
  const rawParams = args.proxyParams?.dashboard ?? {};
  const resolvedParams = resolveDateTokens(rawParams, new Date());
  const dashUrl = buildProxyDashboardUrl(args.proxyUrl, resolvedParams);
  const log = args.logger;
  log?.debug({ event: 'proxy-fire', url: maskVisibleText(dashUrl) });
  const emptyHeaders = { extraHeaders: {} };
  const result = await args.strategy.fetchGet(dashUrl, emptyHeaders);
  if (!result.success) {
    log?.debug({ event: 'proxy-response', captured: false });
    return succeed(false);
  }
  log?.debug({ event: 'proxy-response', captured: true });
  const hit = await args.mediator.network.waitForTraffic(TXN_PATTERNS, PROXY_TRAFFIC_TIMEOUT);
  if (hit) log?.trace({ event: 'net-capture', method: hit.method, url: maskVisibleText(hit.url) });
  return succeed(true);
}

export default triggerDashboardUi;
export { triggerDashboardUi, triggerProxyDashboard };
