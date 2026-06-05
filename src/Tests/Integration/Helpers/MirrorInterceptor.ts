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

/** Args bundle for {@link routeHandler} — keeps the handler under cap. */
interface IRouteCtx {
  readonly cachedHtml: string;
  readonly originHost: string;
}

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
 * Decide whether a request should receive the HTML mirror payload.
 * Only same-origin document-class requests qualify; everything else
 * is treated as a subresource and aborted.
 * @param req - Playwright request.
 * @param originHost - Bank origin (scheme + host) the mirror serves.
 * @returns True when the request should be fulfilled with HTML.
 */
function shouldServeHtml(req: Request, originHost: string): boolean {
  const resourceType = req.resourceType();
  if (resourceType !== 'document') return false;
  const url = req.url();
  return url.startsWith(originHost);
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
 * Route handler — fulfills document navigations with cached HTML and
 * aborts every other request so subresources never escape.
 * @param route - Playwright route.
 * @param req - The request being routed.
 * @param ctx - Cached HTML + origin host.
 * @returns True after the route is handled.
 */
async function routeHandler(route: Route, req: Request, ctx: IRouteCtx): Promise<true> {
  if (shouldServeHtml(req, ctx.originHost)) return fulfillHtml(route, ctx.cachedHtml);
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
 * every same-origin document request gets the cached bytes; every
 * subresource is aborted at the network layer.
 * @param args - Install args.
 * @returns Mirror handle (escapes + dispose).
 */
async function installMirror(args: IInstallMirrorArgs): Promise<IMirrorHandle> {
  const cachedHtml = await readStepHtml(args.bankId, args.stepName);
  const originHost = new URL(args.originUrl).origin;
  const ctx: IRouteCtx = { cachedHtml, originHost };
  await args.page.route('**/*', (route: Route, req: Request): Promise<true> => {
    return routeHandler(route, req, ctx);
  });
  return { escapes: [], dispose: makeDispose(args.page) };
}

export type { IInstallMirrorArgs, IMirrorHandle };
export { installMirror };
