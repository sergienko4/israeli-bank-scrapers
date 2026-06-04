import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { type Page, type Request, type Route } from 'playwright-core';

const CURRENT_FILE = fileURLToPath(import.meta.url);
const CURRENT_DIR = path.dirname(CURRENT_FILE);

interface IMockRoute {
  match: string | RegExp;
  method?: 'GET' | 'POST';
  abort?: boolean;
  contentType?: string;
  body?: string | ((request: Request) => string);
  status?: number;
}

/** Options controlling default behaviour of {@link setupRequestInterception}. */
export interface ISetupOptions {
  /**
   * When true, unmatched URLs are aborted with `'failed'` (default: true).
   * Set false ONLY for tests that genuinely need pass-through (rare).
   */
  shouldAbortUnmatched?: boolean;
}

/**
 * Loads a fixture file from the fixtures directory.
 * @param fixturePath - relative path within the fixtures directory
 * @returns the file contents as a string
 */
export function loadFixture(fixturePath: string): string {
  const fullPath = path.resolve(CURRENT_DIR, '..', 'fixtures', fixturePath);
  return fs.readFileSync(fullPath, 'utf-8');
}

/**
 * Find the first matching route for this request.
 * @param routes - registered mock routes (insertion order = priority).
 * @param url - request URL.
 * @param method - request HTTP method.
 * @returns matching route, or `false` when no route matches.
 */
function findMatchingRoute(routes: IMockRoute[], url: string, method: string): IMockRoute | false {
  const found = routes.find(mockRoute => {
    const isUrlMatch =
      mockRoute.match instanceof RegExp ? mockRoute.match.test(url) : url.includes(mockRoute.match);
    const isMethodMatch = !mockRoute.method || mockRoute.method === method;
    return isUrlMatch && isMethodMatch;
  });
  return found ?? false;
}

/**
 * Fulfil a matched route with the configured body + content-type.
 * @param route - Playwright route handle.
 * @param request - Playwright request handle.
 * @param matched - Mock-route descriptor.
 * @returns True after the route has been fulfilled.
 */
async function fulfilMatchedRoute(
  route: Route,
  request: Request,
  matched: IMockRoute,
): Promise<boolean> {
  const body = typeof matched.body === 'function' ? matched.body(request) : matched.body;
  const contentType = matched.contentType ?? 'text/html';
  await route.fulfill({
    status: matched.status ?? 200,
    contentType,
    body,
  });
  return true;
}

/** Bundled args for {@link dispatchRoute}. */
interface IDispatchArgs {
  readonly route: Route;
  readonly request: Request;
  readonly matched: IMockRoute | false;
  readonly shouldAbortUnmatched: boolean;
}

/**
 * Settle an unmatched route: abort with `'failed'` when the
 * catch-all guard is enabled, otherwise pass-through.
 * Extracted from {@link dispatchRoute} to keep that body within the
 * project's ≤10-LoC cap.
 * @param route - Playwright route handle.
 * @param shouldAbortUnmatched - True to abort, false to continue.
 * @returns True after the route is settled.
 */
async function handleUnmatchedRoute(route: Route, shouldAbortUnmatched: boolean): Promise<boolean> {
  if (shouldAbortUnmatched) {
    await route.abort('failed');
    return true;
  }
  await route.continue();
  return true;
}

/**
 * Dispatch a single intercepted request to abort / fulfil / catch-all.
 * @param args - Bundled handler args.
 * @param args.route - Playwright route handle.
 * @param args.request - Playwright request handle.
 * @param args.matched - Mock-route descriptor or `false` when none matched.
 * @param args.shouldAbortUnmatched - True to abort unmatched URLs.
 * @returns True after the route is settled.
 */
async function dispatchRoute(args: IDispatchArgs): Promise<boolean> {
  const { route, request, matched, shouldAbortUnmatched } = args;
  if (matched && matched.abort) {
    await route.abort('failed');
    return true;
  }
  if (matched) return fulfilMatchedRoute(route, request, matched);
  return handleUnmatchedRoute(route, shouldAbortUnmatched);
}

/**
 * Sets up request interception on a Playwright page using mock route definitions.
 * Default catch-all behaviour: unmatched URLs are aborted with `'failed'`.
 * Pass `{ shouldAbortUnmatched: false }` to opt back into `route.continue()`.
 * @param page - the Playwright page to intercept requests on
 * @param routes - array of mock route definitions
 * @param options - optional behaviour overrides
 * @returns promise that resolves when interception is set up
 */
export async function setupRequestInterception(
  page: Page,
  routes: IMockRoute[],
  options: ISetupOptions = {},
): Promise<boolean> {
  const shouldAbortUnmatched = options.shouldAbortUnmatched ?? true;
  await page.route('**/*', async (route: Route, request: Request) => {
    const requestUrl = request.url();
    const requestMethod = request.method();
    const matched = findMatchingRoute(routes, requestUrl, requestMethod);
    await dispatchRoute({ route, request, matched, shouldAbortUnmatched });
  });
  return true;
}
