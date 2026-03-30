/**
 * DASHBOARD phase — Hard-Gated Strategy-Driven Pipeline.
 *
 * PRE:    Resolve strategy (BYPASS vs TRIGGER) + extract href via target:'href'.
 * ACTION: BYPASS → build API context. TRIGGER → navigateTo(absoluteUrl) + snap back.
 * POST:   Validate traffic delta. Hard fail if TRIGGER produced 0 (UNPRIMED).
 * SIGNAL: Validate dashboard.has — fail if not ready.
 */

import type { SelectorCandidate } from '../../Base/Config/LoginConfig.js';
import { ScraperErrorTypes } from '../../Base/ErrorTypes.js';
import type { IElementMediator } from '../Mediator/ElementMediator.js';
import type { IDiscoveredEndpoint, INetworkDiscovery } from '../Mediator/NetworkDiscovery.js';
import { PIPELINE_WELL_KNOWN_API, WK } from '../Registry/PipelineWellKnown.js';
import type { IFetchStrategy, PostData } from '../Strategy/FetchStrategy.js';
import { injectDateParams } from '../Strategy/ProxyTemplate.js';
import { BasePhase } from '../Types/BasePhase.js';
import { getDebug } from '../Types/Debug.js';
import { some } from '../Types/Option.js';
import type {
  IApiFetchContext,
  IDashboardState,
  IPipelineContext,
} from '../Types/PipelineContext.js';
import type { Procedure } from '../Types/Procedure.js';
import { fail, succeed } from '../Types/Procedure.js';
import { buildTxnPagePatterns } from '../Types/UrlHelpers.js';

const LOG = getDebug('dashboard-phase');

// ── Constants ────────────────────────────────────────────────────────────────────

/** Timeout for SUCCESS probe (30s for SPA auth flows). */
const DASHBOARD_TIMEOUT = 30000;
/** Timeout for REVEAL probe. */
const REVEAL_TIMEOUT_MS = 15000;
/** Dashboard strategy — resolved in PRE, consumed in ACTION. */
type DashboardStrategyKind = 'BYPASS' | 'TRIGGER';
/** SPA render timeout for href extraction. */
const TRIGGER_RENDER_TIMEOUT_MS = 10000;
// TRIGGER_NETWORK_TIMEOUT_MS removed — proxy warming doesn't navigate.
/** Whether an endpoint has a valid response body. */
type HasBody = boolean;
/** Count of captured transaction endpoints. */
type TxnTrafficCount = number;
/** Whether a filter predicate matches. */
type IsMatch = boolean;
/** Whether a regex pattern matches a URL. */
type PatternMatch = boolean;
/** Extracted href string from DOM or empty. */
type ExtractedHref = string;
/** Resolved absolute URL or empty string. */
type AbsoluteUrl = string;
/** API base URL from config (nullable). */
type ApiBaseUrl = string | null;

// ── Traffic Delta ────────────────────────────────────────────────────────────────

/**
 * Count WK transaction endpoints with response body since a timestamp.
 * @param network - Network discovery with captured traffic.
 * @param sinceMs - Epoch ms (0 = all time).
 * @returns Count of matching endpoints with non-null response body.
 */
function countTxnTraffic(network: INetworkDiscovery, sinceMs: number): TxnTrafficCount {
  const recent = network.getAllEndpoints().filter((ep): IsMatch => ep.timestamp > sinceMs);
  const matched = recent.filter(
    (ep): IsMatch => PIPELINE_WELL_KNOWN_API.transactions.some((p): PatternMatch => p.test(ep.url)),
  );
  return matched.filter((ep): HasBody => ep.responseBody !== undefined && ep.responseBody !== null)
    .length;
}

// ── Strategy Resolution ──────────────────────────────────────────────────────────

/**
 * Resolve dashboard strategy based on existing network traffic.
 * @param network - Network discovery.
 * @returns BYPASS if traffic exists, TRIGGER if not.
 */
function resolveDashboardStrategy(network: INetworkDiscovery): DashboardStrategyKind {
  const existingCount = countTxnTraffic(network, 0);
  return existingCount > 0 ? 'BYPASS' : 'TRIGGER';
}

// ── Href Extraction (Triple-Threat) ──────────────────────────────────────────────

/**
 * Build absolute URL from a relative href and the current page URL.
 * @param href - Relative or absolute href.
 * @param pageUrl - Current page URL for base resolution.
 * @returns Absolute URL string, or empty string if malformed.
 */
function resolveAbsoluteHref(href: string, pageUrl: string): AbsoluteUrl {
  if (!href || href.startsWith('#') || href.startsWith('javascript:')) return '';
  try {
    return new URL(href, pageUrl).href;
  } catch {
    return '';
  }
}

/**
 * Augment a candidate with target:'href' for link destination extraction.
 * @param c - Original candidate.
 * @returns New candidate with target:'href'.
 */
function withHrefTarget(c: SelectorCandidate): SelectorCandidate {
  return { ...c, target: 'href' as const };
}

// TXN_PAGE_PATTERNS — built dynamically from config.api.base via buildTxnPagePatterns().

/**
 * Triple-Threat href extraction:
 * Layer 1: ariaLabel candidates (targets real `<a>` tags).
 * Layer 2: all WK candidates with target:'href' (textContent walkUp to `<a>`).
 * Layer 3: collectAllHrefs DOM scan (brute force, bypasses actionability).
 * @param mediator - Element mediator.
 * @returns Extracted href string (empty if not found).
 */
/**
 * Layer 1: ariaLabel-only href extraction — targets real `<a>` tags.
 * @param mediator - Element mediator.
 * @param candidates - Full WK candidate list.
 * @returns Extracted href or empty string.
 */
async function extractHrefLayer1(
  mediator: IElementMediator,
  candidates: readonly SelectorCandidate[],
): Promise<ExtractedHref> {
  const ariaOnly = candidates.filter((c): IsMatch => c.kind === 'ariaLabel');
  if (ariaOnly.length === 0) return '';
  const hrefCandidates = ariaOnly.map(withHrefTarget);
  const ariaRace = await mediator.resolveVisible(hrefCandidates, TRIGGER_RENDER_TIMEOUT_MS);
  const href = ariaRace.found ? ariaRace.value : '';
  LOG.debug('[PRE] L1 ariaLabel: found=%s href="%s"', ariaRace.found, href);
  return href;
}

/**
 * Layer 2: all candidates with href target — textContent walkUp to `<a>`.
 * @param mediator - Element mediator.
 * @param candidates - Full WK candidate list.
 * @returns Extracted href or empty string.
 */
async function extractHrefLayer2(
  mediator: IElementMediator,
  candidates: readonly SelectorCandidate[],
): Promise<ExtractedHref> {
  const hrefCandidates = candidates.map(withHrefTarget);
  const allRace = await mediator.resolveVisible(hrefCandidates, TRIGGER_RENDER_TIMEOUT_MS);
  const href = allRace.found ? allRace.value : '';
  LOG.debug('[PRE] L2 textContent: found=%s href="%s"', allRace.found, href);
  return href;
}

/**
 * Layer 3: brute-force DOM scan — collectAllHrefs for /transactions pattern.
 * Bypasses Playwright actionability checks entirely.
 * @param mediator - Element mediator.
 * @param apiBase - The bank's api.base URL for dynamic pattern generation.
 * @returns Matching href or empty string.
 */
async function extractHrefLayer3(
  mediator: IElementMediator,
  apiBase: ApiBaseUrl,
): Promise<ExtractedHref> {
  const allHrefs = await mediator.collectAllHrefs();
  const patterns = buildTxnPagePatterns(apiBase);
  /**
   * Test if an href matches any WK transaction page pattern.
   * @param h - href to test.
   * @returns True if matches.
   */
  const matchesPattern = (h: string): IsMatch => patterns.some((p): PatternMatch => p.test(h));
  const txnHref = allHrefs.find(matchesPattern);
  const sampleHrefs = allHrefs.slice(0, 10).join(', ');
  LOG.debug(
    '[PRE] L3 DOM scan: match=%s total=%d sample=[%s]',
    txnHref ?? 'none',
    allHrefs.length,
    sampleHrefs,
  );
  return txnHref ?? '';
}

/**
 * Triple-Threat href extraction: ariaLabel → textContent → DOM scan.
 * @param mediator - Element mediator.
 * @param apiBase - The bank's api.base URL for dynamic pattern generation.
 * @returns Extracted href string (empty if not found).
 */
async function extractTransactionHref(
  mediator: IElementMediator,
  apiBase: ApiBaseUrl,
): Promise<ExtractedHref> {
  const candidates = WK.DASHBOARD.TRANSACTIONS as unknown as readonly SelectorCandidate[];
  const l1 = await extractHrefLayer1(mediator, candidates);
  if (l1) return l1;
  const l2 = await extractHrefLayer2(mediator, candidates);
  if (l2) return l2;
  return extractHrefLayer3(mediator, apiBase);
}

// ── Probes ───────────────────────────────────────────────────────────────────────

/**
 * Probe WK.LOGIN.POST.SUCCESS indicators — first visible wins.
 * @param mediator - Active mediator for the current page.
 * @returns Human-readable match summary.
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

// ── LOGIN.SIGNAL — REVEAL ────────────────────────────────────────────────────────

/**
 * Build runtime date candidates for today in multiple formats.
 * @returns SelectorCandidate array with today's date.
 */
function buildDateCandidates(): readonly SelectorCandidate[] {
  const now = new Date();
  const dayNum = now.getDate();
  const monthNum = now.getMonth() + 1;
  const fullYear = now.getFullYear();
  const dd = String(dayNum).padStart(2, '0');
  const d = String(dayNum);
  const mm = String(monthNum).padStart(2, '0');
  const m = String(monthNum);
  const yy = String(fullYear).slice(2);
  const yyyy = String(fullYear);
  const formats = [
    `${dd}.${mm}.${yy}`,
    `${d}.${m}.${yy}`,
    `${dd}.${mm}.${yyyy}`,
    `${dd}/${mm}/${yy}`,
    `${d}/${m}/${yy}`,
    `${dd}/${mm}/${yyyy}`,
    `${dd}-${mm}-${yy}`,
    `${dd}-${mm}-${yyyy}`,
  ];
  return formats.map((f): SelectorCandidate => ({ kind: 'textContent', value: f }));
}

/**
 * LOGIN.SIGNAL — probe WK.DASHBOARD.REVEAL + runtime dates.
 * @param mediator - Active mediator for the current page.
 * @returns Human-readable match summary.
 */
async function probeDashboardReveal(mediator: IElementMediator): Promise<string> {
  const staticCandidates = WK.DASHBOARD.REVEAL as unknown as readonly SelectorCandidate[];
  const dateCandidates = buildDateCandidates();
  const allCandidates = [...staticCandidates, ...dateCandidates];
  const result = await mediator
    .resolveVisible(allCandidates, REVEAL_TIMEOUT_MS)
    .catch((): false => false);
  const hasMatch = result && result.found && result.candidate;
  const candidateValue = (hasMatch && result.candidate.value) || '';
  return (hasMatch && `reveal: ${candidateValue}`) || 'no reveal';
}

// ── API Context Builder ──────────────────────────────────────────────────────────

/**
 * Extract URL from a discovered endpoint, or false.
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
 * @returns Discovered URLs.
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

// ── Session Activation ──────────────────────────────────────────────────────────

/**
 * Try session activation via Strategy hook (e.g., .ashx proxy for Amex).
 * No-op if strategy has no activateSession method.
 * @param ctx - Pipeline context with credentials, config, fetchStrategy.
 * @returns Succeed(void) or fail with activation error message.
 */
async function trySessionActivation(ctx: IPipelineContext): Promise<Procedure<void>> {
  const strategy = ctx.fetchStrategy.has ? ctx.fetchStrategy.value : false;
  if (!strategy || !strategy.activateSession) return succeed(undefined);
  LOG.debug('[DASHBOARD.ACTION] activating session via Strategy hook');
  const activation = await strategy.activateSession(ctx.credentials, ctx.config);
  const msg = activation.success ? 'ok' : activation.errorMessage;
  LOG.debug('[DASHBOARD.ACTION] activation result: success=%s msg=%s', activation.success, msg);
  if (!activation.success) {
    return fail(ScraperErrorTypes.Generic, `Session activation failed: ${msg}`);
  }
  return succeed(undefined);
}

// ── Trigger Navigation ───────────────────────────────────────────────────────────

/**
 * Warm the proxy session by fetching the first WK proxy accounts reqName via .ashx.
 * Generic: uses WK proxy registry, not hardcoded reqNames.
 * @param ctx - Pipeline context with fetchStrategy and config.
 * @returns Succeed(void) or fail if proxy fetch failed.
 */
async function warmProxySession(ctx: IPipelineContext): Promise<Procedure<void>> {
  if (!ctx.fetchStrategy.has) return succeed(undefined);
  const strategy = ctx.fetchStrategy.value;
  if (!strategy.proxyGet) return succeed(undefined);
  const proxyGetFn = strategy.proxyGet.bind(strategy);
  const reqName = PIPELINE_WELL_KNOWN_API.proxy.accounts[0];
  if (!reqName) return succeed(undefined);
  const templateParams = { actionCode: '0', billingDate: '', format: 'Json' };
  const now = new Date();
  const injected = injectDateParams(templateParams, now);
  const paramStr = JSON.stringify(injected);
  LOG.debug('[DASHBOARD.ACTION] proxy warming: reqName=%s params=%s', reqName, paramStr);
  const result = await proxyGetFn(ctx.config, reqName, injected);
  LOG.debug('[DASHBOARD.ACTION] proxy warming result: success=%s', result.success);
  return succeed(undefined);
}

/**
 * Execute TRIGGER: activate session via .ashx, then warm proxy with DashboardMonth.
 * No Double-Jump — all data stays on the he. domain via proxy handler.
 * @param _mediator - Element mediator (unused — proxy-only, no navigation).
 * @param ctx - Pipeline context with credentials, config, fetchStrategy.
 * @returns Succeed(void) or fail if session activation was rejected.
 */
async function executeTriggerNavigation(
  _mediator: IElementMediator,
  ctx: IPipelineContext,
): Promise<Procedure<void>> {
  const activationResult = await trySessionActivation(ctx);
  if (!activationResult.success) return activationResult;
  return warmProxySession(ctx);
}

// Double-Jump removed — replaced by proxy warming in Phase 15.

/**
 * Validate the traffic hard-gate: TRIGGER must capture transaction traffic.
 * Proxy-based banks skip this check — their data comes in SCRAPE phase.
 * @param input - Pipeline context.
 * @param mediator - Element mediator with network discovery.
 * @returns Succeed(void) or fail if UNPRIMED.
 */
function validateTrafficGate(input: IPipelineContext, mediator: IElementMediator): Procedure<void> {
  const isTrigger = input.diagnostics.dashboardStrategy === 'TRIGGER';
  const hasProxy: IsMatch = input.fetchStrategy.has && 'proxyGet' in input.fetchStrategy.value;
  const trafficCount = isTrigger ? countTxnTraffic(mediator.network, 0) : -1;
  const stratLabel = isTrigger ? 'TRIGGER' : 'BYPASS';
  const countStr = String(trafficCount);
  LOG.debug(
    '[DASHBOARD.POST] strategy=%s trafficCount=%s hasProxy=%s',
    stratLabel,
    countStr,
    hasProxy,
  );
  if (isTrigger && trafficCount === 0 && !hasProxy) {
    return fail(ScraperErrorTypes.Generic, 'DASHBOARD UNPRIMED: no transaction API captured');
  }
  return succeed(undefined);
}

// ── Phase Class ──────────────────────────────────────────────────────────────────

/** DASHBOARD phase — Hard-Gated with BYPASS/TRIGGER strategy. */
class DashboardPhase extends BasePhase {
  public readonly name = 'dashboard' as const;

  /**
   * PRE: Resolve strategy + extract href for TRIGGER.
   * @param _ctx - Pipeline context (unused).
   * @param input - Pipeline context with mediator.
   * @returns Updated context with strategy + targetUrl in diagnostics.
   */
  public async pre(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    if (!input.browser.has) return fail(ScraperErrorTypes.Generic, 'No browser for DASHBOARD PRE');
    if (!input.mediator.has)
      return fail(ScraperErrorTypes.Generic, 'No mediator for DASHBOARD PRE');
    const mediator = input.mediator.value;
    const matchInfo = await probeSuccessIndicators(mediator);
    const dashStrategy = resolveDashboardStrategy(mediator.network);
    let targetUrl = '';
    if (dashStrategy === 'TRIGGER') {
      const apiBase = input.config.api.base;
      const href = await extractTransactionHref(mediator, apiBase);
      const pageUrl = mediator.getCurrentUrl();
      targetUrl = resolveAbsoluteHref(href, pageUrl);
    }
    LOG.debug('[DASHBOARD.PRE] strategy=%s targetUrl=%s (%s)', dashStrategy, targetUrl, matchInfo);
    const updatedDiag = {
      ...input.diagnostics,
      lastAction: `dashboard-pre (${matchInfo}, strategy=${dashStrategy})`,
      dashboardStrategy: dashStrategy,
      dashboardTargetUrl: targetUrl,
    };
    return succeed({ ...input, diagnostics: updatedDiag });
  }

  /**
   * ACTION: Execute strategy then build API context.
   * TRIGGER: navigateTo(targetUrl) + snap back. BYPASS: build context directly.
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
    const mediator = input.mediator.value;
    const isTrigger = input.diagnostics.dashboardStrategy === 'TRIGGER';
    const targetUrl = input.diagnostics.dashboardTargetUrl ?? '';
    const triggerResult =
      isTrigger && targetUrl ? await executeTriggerNavigation(mediator, input) : succeed(undefined);
    if (!triggerResult.success) return triggerResult;
    if (isTrigger && !targetUrl) {
      LOG.debug('[DASHBOARD.ACTION] TRIGGER but no targetUrl — POST will validate');
    }
    const apiCtx = await buildApiContext(mediator.network, input.fetchStrategy.value);
    return succeed({ ...input, api: some(apiCtx) });
  }

  /**
   * POST: Validate traffic + change-password + store dashboard state.
   * Hard fail if TRIGGER produced 0 transaction traffic (UNPRIMED).
   * @param _ctx - Pipeline context (unused).
   * @param input - Pipeline context with browser + mediator.
   * @returns Updated context or hard failure.
   */
  public async post(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    if (!input.mediator.has)
      return fail(ScraperErrorTypes.Generic, 'No mediator for DASHBOARD POST');
    const mediator = input.mediator.value;
    // Change-password check
    const changePassResult = await mediator.resolveAndClick(WK.DASHBOARD.CHANGE_PWD);
    if (!changePassResult.success) return changePassResult;
    if (changePassResult.value.found)
      return fail(ScraperErrorTypes.ChangePassword, 'Password change required');
    const gateResult = validateTrafficGate(input, mediator);
    if (!gateResult.success) return gateResult;
    const dashState: IDashboardState = { isReady: true, pageUrl: mediator.getCurrentUrl() };
    return succeed({ ...input, dashboard: some(dashState) });
  }

  /**
   * SIGNAL: Validate PRIMED state — dashboard ready + finalUrl stamped.
   * @param _ctx - Pipeline context (unused).
   * @param input - Pipeline context with dashboard state.
   * @returns Succeed with finalUrl, fail if not ready.
   */
  public final(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    if (!input.dashboard.has) {
      const err = fail(ScraperErrorTypes.Generic, 'DASHBOARD SIGNAL: not ready');
      return Promise.resolve(err);
    }
    const dashUrl = input.dashboard.value.pageUrl;
    const updatedDiag = { ...input.diagnostics, finalUrl: some(dashUrl) };
    const result = succeed({ ...input, diagnostics: updatedDiag });
    return Promise.resolve(result);
  }
}

/**
 * Create the DASHBOARD phase instance.
 * @returns DashboardPhase.
 */
function createDashboardPhase(): DashboardPhase {
  return new DashboardPhase();
}

export { createDashboardPhase, DashboardPhase, probeDashboardReveal };
