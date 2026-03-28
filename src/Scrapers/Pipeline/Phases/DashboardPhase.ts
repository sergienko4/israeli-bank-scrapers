/**
 * DASHBOARD phase — generic wait for dashboard readiness after login.
 *
 * PRE:    probe dashboard indicators via resolveVisible (30s timeout)
 * ACTION: build API context from network traffic
 * POST:   check changePassword indicators → store dashboard.pageUrl
 * FINAL:  default no-op
 */

import type { SelectorCandidate } from '../../Base/Config/LoginConfig.js';
import { ScraperErrorTypes } from '../../Base/ErrorTypes.js';
import type { IElementMediator } from '../Mediator/ElementMediator.js';
import type { IDiscoveredEndpoint, INetworkDiscovery } from '../Mediator/NetworkDiscovery.js';
import { PIPELINE_WELL_KNOWN_API, WK } from '../Registry/PipelineWellKnown.js';
import type { IFetchStrategy, PostData } from '../Strategy/FetchStrategy.js';
import { BasePhase } from '../Types/BasePhase.js';
import { some } from '../Types/Option.js';
import type {
  IApiFetchContext,
  IDashboardState,
  IPipelineContext,
} from '../Types/PipelineContext.js';
import type { Procedure } from '../Types/Procedure.js';
import { fail, succeed } from '../Types/Procedure.js';

/** Timeout for waiting for dashboard indicator (30s for SPA auth flows). */
const DASHBOARD_TIMEOUT = 30000;

/**
 * Probe WK.LOGIN.POST.SUCCESS indicators — first visible wins.
 * @param mediator - Active mediator for the current page.
 * @returns Human-readable match summary for diagnostics.
 */
async function probeSuccessIndicators(mediator: IElementMediator): Promise<string> {
  const successCandidates = WK.LOGIN.POST.SUCCESS as unknown as readonly SelectorCandidate[];
  const result = await mediator
    .resolveVisible(successCandidates, DASHBOARD_TIMEOUT)
    .catch((): false => false);
  const hasMatch = result && result.found && result.candidate;
  const candidateValue = (hasMatch && result.candidate.value) || '';
  return (hasMatch && `matched: ${candidateValue}`) || 'no indicator';
}

/**
 * Extract URL from a discovered endpoint, or false if not found.
 * @param hit - Discovered endpoint or false.
 * @returns URL string or false.
 */
function urlOrFalse(hit: IDiscoveredEndpoint | false): string | false {
  if (!hit) return false;
  return hit.url;
}

/**
 * Discover all endpoint URLs from network traffic.
 * @param network - Network discovery.
 * @returns Discovered URLs (false if not found).
 */
function discoverUrls(
  network: INetworkDiscovery,
): Pick<IApiFetchContext, 'accountsUrl' | 'transactionsUrl' | 'balanceUrl' | 'pendingUrl'> {
  const accountsHit = network.discoverAccountsEndpoint();
  const txnHit = network.discoverTransactionsEndpoint();
  const balanceHit = network.discoverBalanceEndpoint();
  const pendingHit = network.discoverByPatterns(PIPELINE_WELL_KNOWN_API.pending);
  return {
    accountsUrl: urlOrFalse(accountsHit),
    transactionsUrl: urlOrFalse(txnHit),
    balanceUrl: urlOrFalse(balanceHit),
    pendingUrl: urlOrFalse(pendingHit),
  };
}

/**
 * Build auto-discovered API fetch context from network traffic.
 * @param network - Network discovery with captured traffic.
 * @param strategy - Base fetch strategy from INIT.
 * @returns API fetch context with discovered endpoints.
 */
async function buildApiContext(
  network: INetworkDiscovery,
  strategy: IFetchStrategy,
): Promise<IApiFetchContext> {
  const headers = await network.buildDiscoveredHeaders();
  const urls = discoverUrls(network);
  return {
    /**
     * Fetch POST with discovered headers.
     * @param url - Endpoint URL.
     * @param body - POST body.
     * @returns Procedure with response.
     */
    fetchPost: <T>(url: string, body: PostData): Promise<Procedure<T>> =>
      strategy.fetchPost<T>(url, body, headers),
    /**
     * Fetch GET with discovered headers.
     * @param url - Endpoint URL.
     * @returns Procedure with response.
     */
    fetchGet: <T>(url: string): Promise<Procedure<T>> => strategy.fetchGet<T>(url, headers),
    ...urls,
  };
}

/** DASHBOARD phase — BasePhase with PRE/ACTION/POST. */
class DashboardPhase extends BasePhase {
  public readonly name = 'dashboard' as const;

  /**
   * PRE: probe dashboard indicators and store match in diagnostics.
   * @param _ctx - Pipeline context (unused).
   * @param input - Pipeline context with mediator.
   * @returns Updated context with lastAction diagnostic.
   */
  public async pre(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    if (!input.browser.has) return fail(ScraperErrorTypes.Generic, 'No browser for DASHBOARD PRE');
    if (!input.mediator.has)
      return fail(ScraperErrorTypes.Generic, 'No mediator for DASHBOARD PRE');
    const matchInfo = await probeSuccessIndicators(input.mediator.value);
    const updatedDiag = { ...input.diagnostics, lastAction: `dashboard-pre (${matchInfo})` };
    return succeed({ ...input, diagnostics: updatedDiag });
  }

  /**
   * ACTION: build API context from network traffic.
   * @param _ctx - Pipeline context (unused).
   * @param input - Pipeline context with mediator + fetchStrategy.
   * @returns Updated context with api populated.
   */
  public async action(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    if (!input.mediator.has) return fail(ScraperErrorTypes.Generic, 'No mediator for DASHBOARD');
    if (!input.fetchStrategy.has) return succeed(input);
    const apiCtx = await buildApiContext(input.mediator.value.network, input.fetchStrategy.value);
    return succeed({ ...input, api: some(apiCtx) });
  }

  /**
   * POST: check changePassword + store dashboard state.
   * @param _ctx - Pipeline context (unused).
   * @param input - Pipeline context with browser + mediator.
   * @returns Updated context or ChangePassword failure.
   */
  public async post(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    if (!input.browser.has) return fail(ScraperErrorTypes.Generic, 'No browser for DASHBOARD POST');
    if (!input.mediator.has)
      return fail(ScraperErrorTypes.Generic, 'No mediator for DASHBOARD POST');
    const page = input.browser.value.page;
    const mediator = input.mediator.value;
    const changePassResult = await mediator.resolveAndClick(WK.DASHBOARD.CHANGE_PWD);
    if (!changePassResult.success) return changePassResult;
    if (changePassResult.value.found)
      return fail(ScraperErrorTypes.ChangePassword, 'Password change required');
    const dashState: IDashboardState = { isReady: true, pageUrl: page.url() };
    return succeed({ ...input, dashboard: some(dashState) });
  }
}

/**
 * Create the DASHBOARD phase instance.
 * @returns DashboardPhase.
 */
function createDashboardPhase(): DashboardPhase {
  return new DashboardPhase();
}

export { createDashboardPhase, DashboardPhase };
