/**
 * MirrorInterceptor — Integration-layer mirror that replays captured
 * HTML at the bank's REAL URL via Playwright `page.route()`. ZERO
 * network bytes leave the test process.
 *
 * <p>Strategy: only the main-document navigation receives the HTML
 * fixture. Every subresource request (scripts, fonts, images, XHR,
 * analytics beacons) is aborted at the network layer — the captured
 * static DOM is sufficient for production resolver chains; runtime
 * SPA hydration is out of scope for integration tests.
 *
 * <p>Fixture bytes are read ONCE per install + cached in-memory so
 * pages that fire hundreds of document-class iframe loads stay flat.
 */

import * as fs from 'node:fs/promises';

import type { Page, Request, Route } from 'playwright-core';

import { resolveFixtureRoot } from './FixturePage.js';
import {
  HOST_AMBIGUOUS,
  type IFrameRouteMaps,
  loadFrameRoutes,
  normalizeFrameUrl,
  safeFrameHost,
} from './MirrorFrameRoutes.js';

const STEP_HTML_STATUS = 200;
const HTML_CONTENT_TYPE = 'text/html; charset=utf-8';

/** Args bundle for installMirror — respects the 3-param ceiling. */
interface IInstallMirrorArgs {
  readonly page: Page;
  readonly bankId: string;
  readonly stepName: string;
  /** Bank URL the pipeline navigates to (intercepted by this mirror). */
  readonly originUrl: string;
}

/** Handle returned by installMirror — mirrors OfflineInterceptor shape. */
interface IMirrorHandle {
  /** Unmatched outbound requests (always [] in current design — kept for parity). */
  readonly escapes: readonly { method: string; url: string }[];
  dispose(): Promise<boolean>;
}

/** Mutable one-shot logger state — kept inside install closure. */
interface IDebugLoggerState {
  servedLogged: boolean;
  abortedLogged: boolean;
}

/** Args bundle for {@link routeHandler} — keeps the handler under cap. */
interface IRouteCtx {
  readonly cachedHtml: string;
  readonly allowedHosts: ReadonlySet<string>;
  readonly frameRoutes: IFrameRouteMaps;
  readonly bankId: string;
  readonly debug: IDebugLoggerState;
}

/** Empty-host sentinel returned by {@link safeHost} for malformed URLs. */
const NO_HOST = '';

/**
 * Swallow a rejected Promise — returns true once settled.
 * @param p - Promise to await.
 * @returns True after settle.
 */
async function swallow(p: Promise<unknown>): Promise<true> {
  try {
    await p;
  } catch {
    // swallow: route.abort/unroute may race with page close
  }
  return true;
}

/**
 * Parse a URL's host, returning {@link NO_HOST} sentinel for malformed URLs.
 * @param url - Candidate URL string.
 * @returns Host portion or empty-string sentinel.
 */
function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return NO_HOST;
  }
}

/**
 * Decide whether a request should receive the HTML mirror payload.
 * Only document-class requests whose host is in the allowed set qualify;
 * everything else is treated as a subresource and aborted.
 * @param req - Playwright request.
 * @param allowedHosts - Set of hosts captured during harvest (origin + step finalUrls).
 * @returns True when the request should be fulfilled with HTML.
 */
function shouldServeHtml(req: Request, allowedHosts: ReadonlySet<string>): boolean {
  if (req.resourceType() !== 'document') return false;
  const requestUrl = req.url();
  const host = safeHost(requestUrl);
  if (host === NO_HOST) return false;
  return allowedHosts.has(host);
}

/**
 * Whether mirror diagnostic logging is enabled.
 * Enabled when MIRROR_DEBUG is set OR when running in CI.
 * @returns True when the mirror should emit first-request diagnostics.
 */
function isDebugEnabled(): boolean {
  if (process.env.MIRROR_DEBUG) return true;
  if (process.env.CI) return true;
  return false;
}

/**
 * Log the first served document URL once per bank install.
 * @param ctx - Route context with debug state + bankId.
 * @param url - URL that the mirror is about to serve.
 * @returns True after the log gate is evaluated.
 */
function logFirstServed(ctx: IRouteCtx, url: string): true {
  if (ctx.debug.servedLogged) return true;
  ctx.debug.servedLogged = true;
  if (!isDebugEnabled()) return true;
  console.log(`[mirror:${ctx.bankId}] first SERVED document → ${url}`);
  return true;
}

/**
 * Log the first aborted document/iframe URL once per bank install.
 * Helps diagnose host-allowlist gaps when CI navigations hang.
 * @param ctx - Route context with debug state + bankId.
 * @param req - The request being aborted.
 * @returns True after the log gate is evaluated.
 */
function logFirstAborted(ctx: IRouteCtx, req: Request): true {
  if (ctx.debug.abortedLogged) return true;
  if (req.resourceType() !== 'document') return true;
  ctx.debug.abortedLogged = true;
  if (!isDebugEnabled()) return true;
  const url = req.url();
  console.log(`[mirror:${ctx.bankId}] first ABORTED document → ${url}`);
  return true;
}

/**
 * Fulfill the route with the cached HTML payload.
 * @param route - Playwright route.
 * @param cachedHtml - The cached HTML body to serve.
 * @returns True after fulfillment.
 */
async function fulfillHtml(route: Route, cachedHtml: string): Promise<true> {
  await route.fulfill({
    status: STEP_HTML_STATUS,
    contentType: HTML_CONTENT_TYPE,
    body: cachedHtml,
  });
  return true;
}

/**
 * Sentinel returned by {@link tryServeFrame} when no frame body matched
 * the request URL. Empty string is unique vs every captured HTML body
 * (which is always non-empty after harvest validation).
 */
const NO_FRAME_BODY = '' as const;

/**
 * Host-fallback lookup for {@link tryServeFrame}. Returns the captured
 * body when exactly one frame on that host was harvested; otherwise the
 * {@link NO_FRAME_BODY} sentinel. Extracted so {@link tryServeFrame}
 * stays under the 10-line cap (per CLAUDE.md).
 * @param host - Host portion of the request URL (or empty-string sentinel).
 * @param frameRoutes - The URL + host route maps.
 * @returns Captured frame body or {@link NO_FRAME_BODY}.
 */
function tryHostFallback(host: string, frameRoutes: IFrameRouteMaps): string {
  if (host === '') return NO_FRAME_BODY;
  const byHost = frameRoutes.byHost.get(host);
  if (byHost === undefined || byHost === HOST_AMBIGUOUS) return NO_FRAME_BODY;
  return byHost;
}

/**
 * Try to serve a captured iframe HTML body. Two-tier match:
 *   1. exact origin+pathname match (preferred)
 *   2. host fallback when the harvest URL drifted (SPA replaced
 *      the initial iframe src with a deeper route, e.g. visaCal
 *      connect.cal-online.co.il/index.html → /regular-login)
 * Returns the body when matched, {@link NO_FRAME_BODY} sentinel when
 * no row matched.
 * @param req - Playwright request.
 * @param ctx - Route context with the URL + host route maps.
 * @returns Captured frame body or {@link NO_FRAME_BODY}.
 */
function tryServeFrame(req: Request, ctx: IRouteCtx): string {
  if (req.resourceType() !== 'document') return NO_FRAME_BODY;
  const url = req.url();
  const normalizedUrl = normalizeFrameUrl(url);
  const exact = ctx.frameRoutes.byUrl.get(normalizedUrl);
  if (exact !== undefined) return exact;
  const host = safeFrameHost(url);
  return tryHostFallback(host, ctx.frameRoutes);
}

/**
 * Route handler — fulfills document navigations with cached HTML and
 * aborts every other request so subresources never escape. Main-document
 * navigation gets priority (origin/captured-step host matches). When that
 * misses, captured iframe URLs from the loginStep `frames.json` (if any)
 * are served as fallback so cross-origin iframe forms (e.g. visaCal
 * regular-login, AMEX SSO) become driveable for the production resolver
 * chains. Everything else is aborted at the network layer.
 * @param route - Playwright route.
 * @param req - The request being routed.
 * @param ctx - Cached HTML + allowed hosts + frame routes + debug state.
 * @returns True after the route is handled.
 */
async function routeHandler(route: Route, req: Request, ctx: IRouteCtx): Promise<true> {
  if (shouldServeHtml(req, ctx.allowedHosts)) {
    const reqUrl = req.url();
    logFirstServed(ctx, reqUrl);
    return fulfillHtml(route, ctx.cachedHtml);
  }
  const frameBody = tryServeFrame(req, ctx);
  if (frameBody !== NO_FRAME_BODY) {
    const reqUrl = req.url();
    logFirstServed(ctx, reqUrl);
    return fulfillHtml(route, frameBody);
  }
  logFirstAborted(ctx, req);
  const abortPromise = route.abort('blockedbyclient');
  await swallow(abortPromise);
  return true;
}

/**
 * Read the captured step HTML for a bank.
 * @param bankId - Bank recipe id.
 * @param stepName - Step name (matches `<step>.html` filename).
 * @returns UTF-8 HTML content.
 */
async function readStepHtml(bankId: string, stepName: string): Promise<string> {
  const root = resolveFixtureRoot(bankId);
  return fs.readFile(`${root}/${stepName}.html`, 'utf8');
}

/** Captured step manifest entry — shape mirrors HarvestBankHtml emit. */
interface ICapturedStep {
  readonly name: string;
  readonly finalUrl: string;
}

/** Shared empty-steps singleton — avoids per-call array allocation. */
const NO_CAPTURED_STEPS: readonly ICapturedStep[] = Object.freeze([]);

/**
 * Type guard: narrow unknown to a valid ICapturedStep entry.
 * @param value - Candidate value from the parsed manifest array.
 * @returns True when value has the expected name + finalUrl strings.
 */
function isCapturedStep(value: unknown): value is ICapturedStep {
  if (value === null) return false;
  if (typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.finalUrl === 'string' && typeof candidate.name === 'string';
}

/**
 * Read steps.json for a bank, returning [] when missing or malformed.
 * Captured at harvest time; used to allow redirect-chain hosts.
 * @param bankId - Bank recipe id.
 * @returns Array of captured-step manifests.
 */
async function readCapturedSteps(bankId: string): Promise<readonly ICapturedStep[]> {
  const root = resolveFixtureRoot(bankId);
  try {
    const raw = await fs.readFile(`${root}/steps.json`, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return NO_CAPTURED_STEPS;
    return parsed.filter(isCapturedStep);
  } catch {
    return NO_CAPTURED_STEPS;
  }
}

/**
 * Add a URL's host to the allowed-hosts set, skipping malformed URLs.
 * @param hosts - Mutable hosts set being built.
 * @param url - URL whose host should be allowed.
 * @returns True after the add gate is evaluated.
 */
function addUrlHost(hosts: Set<string>, url: string): true {
  const host = safeHost(url);
  if (host !== NO_HOST) hosts.add(host);
  return true;
}

/**
 * Build the set of hosts the mirror will serve. Includes the install
 * originUrl host plus every captured-step finalUrl host. This tolerates
 * redirect chains (e.g. amex digital→he) without leaking real network.
 * @param originUrl - Bank URL the test pipeline navigates to.
 * @param bankId - Bank recipe id.
 * @returns Immutable host-allowlist.
 */
async function buildAllowedHosts(originUrl: string, bankId: string): Promise<ReadonlySet<string>> {
  const hosts = new Set<string>();
  addUrlHost(hosts, originUrl);
  const captured = await readCapturedSteps(bankId);
  for (const step of captured) addUrlHost(hosts, step.finalUrl);
  return hosts;
}

/**
 * Build the dispose callback that unroutes the mirror on teardown.
 * @param page - Playwright page the mirror is installed on.
 * @returns Async dispose returning true after teardown.
 */
function makeDispose(page: Page): () => Promise<boolean> {
  return async (): Promise<boolean> => {
    const unroutePromise = page.unroute('**/*');
    await swallow(unroutePromise);
    return true;
  };
}

/**
 * Install the mirror on the page. The HTML fixture is cached once;
 * every document request whose host is allow-listed gets the cached
 * bytes; every other request is aborted at the network layer.
 * Diagnostic logs identify host-allowlist gaps in CI runs.
 * @param args - Install args.
 * @returns Mirror handle (escapes + dispose).
 */
async function installMirror(args: IInstallMirrorArgs): Promise<IMirrorHandle> {
  const cachedHtml = await readStepHtml(args.bankId, args.stepName);
  const allowedHosts = await buildAllowedHosts(args.originUrl, args.bankId);
  const frameRoutes = await loadFrameRoutes(args.bankId, args.stepName);
  const debug: IDebugLoggerState = { servedLogged: false, abortedLogged: false };
  const ctx: IRouteCtx = { cachedHtml, allowedHosts, frameRoutes, bankId: args.bankId, debug };
  await args.page.route('**/*', (route: Route, req: Request): Promise<true> => {
    return routeHandler(route, req, ctx);
  });
  return { escapes: [], dispose: makeDispose(args.page) };
}

export type { IInstallMirrorArgs, IMirrorHandle };
export { installMirror };
