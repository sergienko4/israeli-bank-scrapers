/**
 * DASHBOARD phase — generic wait for dashboard readiness after login.
 * Uses mediator.resolveVisible + resolveAndClick with WellKnown indicators.
 * Same flow for ALL banks — no bank-specific code.
 *
 * PRE:    probe dashboard indicators via resolveVisible (30s timeout)
 *         → store which indicator matched in diagnostics
 * ACTION: build API context from network traffic (discovered headers + endpoints)
 * POST:   check changePassword indicators → store dashboard.pageUrl
 */

import { ScraperErrorTypes } from '../../Base/ErrorTypes.js';
import type { IDiscoveredEndpoint, INetworkDiscovery } from '../Mediator/NetworkDiscovery.js';
import {
  PIPELINE_WELL_KNOWN_API,
  PIPELINE_WELL_KNOWN_DASHBOARD,
} from '../Registry/PipelineWellKnown.js';
import type { IFetchStrategy, PostData } from '../Strategy/FetchStrategy.js';
import { some } from '../Types/Option.js';
import type { IPhaseDefinition, IPipelineStep } from '../Types/Phase.js';
import type {
  IApiFetchContext,
  IDashboardState,
  IPipelineContext,
} from '../Types/PipelineContext.js';
import type { Procedure } from '../Types/Procedure.js';
import { fail, succeed } from '../Types/Procedure.js';

/** Timeout for waiting for dashboard indicator (30s for SPA auth flows). */
const DASHBOARD_TIMEOUT = 30000;

// ── PRE: probe dashboard indicators ───────────────────────

/**
 * Execute PRE step: probe for dashboard readiness via resolveVisible.
 * Stores which indicator matched (greeting, balance, last-login) in diagnostics.
 * Best-effort: returns succeed even when no indicator found.
 * @param _ctx - Pipeline context (unused).
 * @param input - Pipeline context with browser + mediator.
 * @returns Updated context with diagnostics.
 */
async function executeDashboardPre(
  _ctx: IPipelineContext,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  if (!input.browser.has) return fail(ScraperErrorTypes.Generic, 'No browser for DASHBOARD PRE');
  if (!input.mediator.has) return fail(ScraperErrorTypes.Generic, 'No mediator for DASHBOARD PRE');
  const mediator = input.mediator.value;
  const result = await mediator
    .resolveVisible(PIPELINE_WELL_KNOWN_DASHBOARD.dashboardIndicator, DASHBOARD_TIMEOUT)
    .catch((): false => false);
  const hasMatch = result && result.found && result.candidate;
  const candidateValue = (hasMatch && result.candidate.value) || '';
  const matchInfo = (hasMatch && `matched: ${candidateValue}`) || 'no indicator';
  const updatedDiag = {
    ...input.diagnostics,
    lastAction: `dashboard-pre (${matchInfo})`,
  };
  return succeed({ ...input, diagnostics: updatedDiag });
}

// ── ACTION: build API context ─────────────────────────────

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
 * @returns API fetch context with discovered endpoints + authenticated fetch.
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

/**
 * Execute ACTION step: build API context from network traffic.
 * @param _ctx - Pipeline context (unused).
 * @param input - Pipeline context with mediator + fetchStrategy.
 * @returns Updated context with api populated, or succeed without api.
 */
async function executeDashboardAction(
  _ctx: IPipelineContext,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  if (!input.mediator.has) {
    return fail(ScraperErrorTypes.Generic, 'No mediator for DASHBOARD');
  }
  if (!input.fetchStrategy.has) {
    return succeed(input);
  }
  const apiCtx = await buildApiContext(input.mediator.value.network, input.fetchStrategy.value);
  return succeed({ ...input, api: some(apiCtx) });
}

// ── POST: changePassword check + store dashboard state ────

/**
 * Execute POST step: check changePassword + store dashboard.pageUrl.
 * @param _ctx - Pipeline context (unused).
 * @param input - Pipeline context with browser + mediator.
 * @returns Updated context with dashboard state, or ChangePassword failure.
 */
async function executeDashboardPost(
  _ctx: IPipelineContext,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  if (!input.browser.has) return fail(ScraperErrorTypes.Generic, 'No browser for DASHBOARD POST');
  if (!input.mediator.has) return fail(ScraperErrorTypes.Generic, 'No mediator for DASHBOARD POST');
  const page = input.browser.value.page;
  const mediator = input.mediator.value;
  const hasChangePass = await mediator
    .resolveAndClick(PIPELINE_WELL_KNOWN_DASHBOARD.changePasswordIndicator)
    .catch((): boolean => false);
  if (hasChangePass) return fail(ScraperErrorTypes.ChangePassword, 'Password change required');
  const dashState: IDashboardState = { isReady: true, pageUrl: page.url() };
  return succeed({ ...input, dashboard: some(dashState) });
}

// ── Step definitions ──────────────────────────────────────

/** DASHBOARD PRE step — probe indicators. */
const DASHBOARD_PRE_STEP: IPipelineStep<IPipelineContext, IPipelineContext> = {
  name: 'dashboard-pre',
  execute: executeDashboardPre,
};

/** DASHBOARD ACTION step — build API context. */
const DASHBOARD_ACTION_STEP: IPipelineStep<IPipelineContext, IPipelineContext> = {
  name: 'dashboard-action',
  execute: executeDashboardAction,
};

/** DASHBOARD POST step — changePassword + store state. */
const DASHBOARD_POST_STEP: IPipelineStep<IPipelineContext, IPipelineContext> = {
  name: 'dashboard-post',
  execute: executeDashboardPost,
};

// ── Legacy monolithic step (backward compat) ──────────────

/**
 * Execute the DASHBOARD phase as a single step (backward compat).
 * @param ctx - Pipeline context.
 * @param input - Pipeline context.
 * @returns Updated context with dashboard state.
 */
async function executeDashboard(
  ctx: IPipelineContext,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  const preResult = await executeDashboardPre(ctx, input);
  if (!preResult.success) return preResult;
  const actionResult = await executeDashboardAction(preResult.value, preResult.value);
  if (!actionResult.success) return actionResult;
  return executeDashboardPost(actionResult.value, actionResult.value);
}

/** DASHBOARD phase step — legacy monolithic. */
const DASHBOARD_STEP: IPipelineStep<IPipelineContext, IPipelineContext> = {
  name: 'dashboard',
  execute: executeDashboard,
};

// ── Phase factory ─────────────────────────────────────────

/**
 * Create the full DASHBOARD phase with PRE/ACTION/POST sub-steps.
 * @returns IPhaseDefinition with pre, action, post.
 */
function createDashboardPhase(): IPhaseDefinition<IPipelineContext, IPipelineContext> {
  return {
    name: 'dashboard',
    pre: some(DASHBOARD_PRE_STEP),
    action: DASHBOARD_ACTION_STEP,
    post: some(DASHBOARD_POST_STEP),
  };
}

export {
  createDashboardPhase,
  DASHBOARD_ACTION_STEP,
  DASHBOARD_POST_STEP,
  DASHBOARD_PRE_STEP,
  DASHBOARD_STEP,
};
export default DASHBOARD_STEP;
