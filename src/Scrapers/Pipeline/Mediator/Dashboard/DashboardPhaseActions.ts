/**
 * DASHBOARD phase Mediator actions — PRE/ACTION/POST/FINAL.
 * Phase orchestrates ONLY. All logic here.
 *
 * PRE:    locate nav link (probe success indicators, resolve strategy)
 * ACTION: click trigger (dispatch BYPASS/TRIGGER/PROXY, build API context)
 * POST:   validate traffic delta (change-password check, traffic gate)
 * FINAL:  collect endpoints + auth → signal to SCRAPE
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import { some } from '../../Types/Option.js';
import type { IDashboardState, IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import {
  buildApiContext,
  extractTransactionHref,
  NO_HREF,
  probeSuccessIndicators,
  resolveAbsoluteHref,
  resolveDashboardStrategy,
  validateTrafficGate,
} from './DashboardDiscovery.js';
import checkChangePassword, { extractAuthFromContext } from './DashboardProbe.js';
import { triggerDashboardUi, triggerProxyDashboard } from './DashboardTrigger.js';

/** Human-readable match summary. */
type MatchInfo = string;
/** Dashboard target URL. */
type TargetUrl = string;

/**
 * PRE: Probe success indicators, resolve strategy, extract target.
 * @param input - Pipeline context with mediator.
 * @returns Updated context with dashboardStrategy in diagnostics.
 */
async function executePreLocateNav(input: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  if (!input.mediator.has) return fail(ScraperErrorTypes.Generic, 'DASHBOARD PRE: no mediator');
  const mediator = input.mediator.value;
  const matchInfo: MatchInfo = await probeSuccessIndicators(mediator);
  const network = mediator.network;
  const dashStrategy = resolveDashboardStrategy(network, input.diagnostics.apiStrategy);
  let targetUrl: TargetUrl = NO_HREF;
  if (dashStrategy === 'TRIGGER') {
    const href = await extractTransactionHref(mediator);
    const pageUrl = mediator.getCurrentUrl();
    targetUrl = resolveAbsoluteHref(href, pageUrl);
  }
  const diag = {
    ...input.diagnostics,
    lastAction: `dashboard-pre (${matchInfo}, strategy=${dashStrategy})`,
    dashboardStrategy: dashStrategy,
    dashboardTargetUrl: targetUrl,
  };
  return succeed({ ...input, diagnostics: diag });
}

/**
 * ACTION: Cache auth, dispatch strategy, build API context.
 * @param input - Pipeline context.
 * @returns Updated context with api populated.
 */
async function executeClickTrigger(input: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  if (!input.mediator.has) return fail(ScraperErrorTypes.Generic, 'DASHBOARD ACTION: no mediator');
  if (!input.fetchStrategy.has) return succeed(input);
  const network = input.mediator.value.network;
  await network.cacheAuthToken();
  const strategy = input.diagnostics.dashboardStrategy ?? 'BYPASS';
  await dispatchStrategy(strategy, input);
  const apiCtx = await buildApiContext(network, input.fetchStrategy.value);
  return succeed({ ...input, api: some(apiCtx) });
}

/**
 * Dispatch strategy handler: BYPASS / TRIGGER / PROXY.
 * @param strategy - Resolved strategy from PRE.
 * @param input - Pipeline context.
 * @returns Procedure result.
 */
async function dispatchStrategy(
  strategy: string,
  input: IPipelineContext,
): Promise<Procedure<boolean>> {
  if (strategy === 'TRIGGER' && input.mediator.has) {
    return triggerDashboardUi(input.mediator.value, input.logger);
  }
  if (strategy === 'PROXY') return dispatchProxyStrategy(input);
  const ok = succeed(true);
  return ok;
}

/**
 * PROXY strategy: activate session + fire dashboard API.
 * @param input - Pipeline context.
 * @returns Procedure result.
 */
/**
 * Activate proxy session if strategy supports it.
 * @param input - Pipeline context.
 * @returns Succeed(true) or failure.
 */
async function activateProxySession(input: IPipelineContext): Promise<Procedure<boolean>> {
  if (!input.fetchStrategy.has) return succeed(false);
  const strategy = input.fetchStrategy.value;
  if (!strategy.activateSession) return succeed(true);
  input.logger.debug({ event: 'proxy-activate', step: 'session-init', result: 'OK' });
  const proxyUrl = input.diagnostics.discoveredProxyUrl;
  const result = await strategy.activateSession(input.credentials, input.config, proxyUrl);
  const tagMap: Record<string, 'OK' | 'FAIL'> = { true: 'OK', false: 'FAIL' };
  const tag = tagMap[String(result.success)];
  input.logger.debug({ event: 'proxy-activate', step: 'session-result', result: tag });
  return result;
}

/**
 * PROXY strategy: activate session + fire dashboard API.
 * @param input - Pipeline context.
 * @returns Procedure result.
 */
async function dispatchProxyStrategy(input: IPipelineContext): Promise<Procedure<boolean>> {
  if (!input.mediator.has || !input.fetchStrategy.has) return succeed(false);
  if (!input.diagnostics.discoveredProxyUrl) return succeed(false);
  const sessionResult = await activateProxySession(input);
  if (!sessionResult.success) return sessionResult;
  return triggerProxyDashboard({
    mediator: input.mediator.value,
    strategy: input.fetchStrategy.value,
    proxyUrl: input.diagnostics.discoveredProxyUrl,
    proxyParams: input.config.auth?.params,
    logger: input.logger,
  });
}

/**
 * POST: Change-password check + traffic gate + build dashboard state.
 * @param input - Pipeline context.
 * @returns Updated context with dashboard state.
 */
async function executeValidateTraffic(
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  if (!input.mediator.has) return fail(ScraperErrorTypes.Generic, 'DASHBOARD POST: no mediator');
  const mediator = input.mediator.value;
  const pwdCheck = await checkChangePassword(mediator);
  if (pwdCheck) return pwdCheck;
  const dashStrategy = input.diagnostics.dashboardStrategy ?? 'BYPASS';
  const isPrimed = validateTrafficGate({
    network: mediator.network,
    dashStrategy,
    hasProxy: false,
    logger: input.logger,
  });
  const pageUrl = mediator.getCurrentUrl();
  /** Strategy lookup: PROXY stays PROXY, all others → DIRECT. */
  const strategyMap: Record<string, 'DIRECT' | 'PROXY'> = {
    PROXY: 'PROXY',
    BYPASS: 'DIRECT',
    TRIGGER: 'DIRECT',
  };
  const strategy = strategyMap[dashStrategy] ?? 'DIRECT';
  input.logger.debug({
    event: 'dashboard-post',
    strategy,
    primed: isPrimed,
    url: maskVisibleText(pageUrl),
  });
  const dashState: IDashboardState = { isReady: true, pageUrl, trafficPrimed: isPrimed };
  return succeed({ ...input, dashboard: some(dashState) });
}

/**
 * FINAL: Collect auth + endpoints → signal to SCRAPE.
 * @param input - Pipeline context.
 * @returns Updated context with auth in diagnostics.
 */
async function executeCollectAndSignal(
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  if (!input.dashboard.has) return fail(ScraperErrorTypes.Generic, 'DASHBOARD FINAL: not ready');
  const dashUrl = input.dashboard.value.pageUrl;
  const discoveredAuth = await extractAuthFromContext(input);
  const diag = { ...input.diagnostics, finalUrl: some(dashUrl), discoveredAuth };
  const hasAuth = Boolean(discoveredAuth);
  input.logger.debug({ event: 'dashboard-auth', authFound: hasAuth });
  return succeed({ ...input, diagnostics: diag });
}

export {
  executeClickTrigger,
  executeCollectAndSignal,
  executePreLocateNav,
  executeValidateTraffic,
};
