/**
 * OfflineRouteInterceptor — installs a Playwright page.route('**')
 * handler that serves fixture bytes for matched URLs and FAILS the
 * test for unmatched outbound requests. Enforces Rule #17 "ZERO
 * NETWORK" for mock E2E tests.
 */

import type { Page, Request, Route } from 'playwright-core';

import { findRoute, type IBankFixtures, readFixtureBytes } from './BankFixtureLoader.js';

/** One captured unmatched outbound — reported at test end. */
interface INetworkEscape {
  readonly method: string;
  readonly url: string;
  readonly at: number;
}

/** Handle returned by installOfflineInterceptor. */
interface IOfflineInterceptor {
  readonly escapes: readonly INetworkEscape[];
  dispose(): Promise<boolean>;
}

/** Args bundle for installOfflineInterceptor — respects 3-param ceiling. */
interface IInstallArgs {
  readonly page: Page;
  readonly fixtures: IBankFixtures;
  /** When true, unmatched outbound URLs are aborted (test still records escape). */
  readonly strict?: boolean;
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
    // swallow
  }
  return true;
}

/**
 * Serve the matched fixture via route.fulfill. Falls back to a 404
 * when fixture bytes fail to load.
 * @param route - Playwright route handle.
 * @param fixtures - Compiled bank fixtures.
 * @param request - Request the route is fulfilling.
 * @returns True once handled.
 */
async function serveFixture(
  route: Route,
  fixtures: IBankFixtures,
  request: Request,
): Promise<true> {
  const requestMethod = request.method();
  const requestUrl = request.url();
  const match = findRoute(fixtures, requestMethod, requestUrl);
  if (match === false) {
    const abortPromise = route.abort('failed');
    await swallow(abortPromise);
    return true;
  }
  const bytes = await readFixtureBytes(match).catch((): string => '');
  if (bytes.length === 0) {
    await route.fulfill({ status: 404, contentType: 'text/plain', body: 'fixture read failed' });
    return true;
  }
  await route.fulfill({
    status: match.status,
    contentType: 'text/html; charset=utf-8',
    body: bytes,
  });
  return true;
}

/** Args bundle for handleRoute (respects 3-param ceiling). */
interface IRouteArgs {
  readonly route: Route;
  readonly request: Request;
  readonly fixtures: IBankFixtures;
  readonly escapes: INetworkEscape[];
}

/**
 * Route handler used by installOfflineInterceptor — records escape +
 * delegates to serveFixture.
 * @param handleArgs - Route + request + fixtures + escape log bundle.
 * @returns True after route handled.
 */
async function handleRoute(handleArgs: IRouteArgs): Promise<true> {
  const { route, request, fixtures, escapes } = handleArgs;
  const requestMethod = request.method();
  const requestUrl = request.url();
  const match = findRoute(fixtures, requestMethod, requestUrl);
  if (match === false) {
    escapes.push({ method: requestMethod, url: requestUrl, at: Date.now() });
  }
  await serveFixture(route, fixtures, request);
  return true;
}

/**
 * Install a page-wide route interceptor that serves fixtures. Any
 * outbound that doesn't match a fixture route is recorded on the
 * returned handle (test asserts against `escapes.length === 0`).
 * @param args - Page + fixtures + strict flag.
 * @returns Handle with escapes list + dispose.
 */
async function installOfflineInterceptor(args: IInstallArgs): Promise<IOfflineInterceptor> {
  const escapes: INetworkEscape[] = [];
  await args.page.route('**/*', (route: Route, request: Request): Promise<true> => {
    return handleRoute({ route, request, fixtures: args.fixtures, escapes });
  });
  /**
   * Remove the route handler + clear the escape log.
   * @returns True after teardown.
   */
  const dispose = async (): Promise<boolean> => {
    const unroutePromise = args.page.unroute('**/*');
    await swallow(unroutePromise);
    return true;
  };
  return { escapes, dispose };
}

export type { INetworkEscape, IOfflineInterceptor };
export { installOfflineInterceptor };
export default installOfflineInterceptor;
