import fs from 'fs';
import path from 'path';
import { type Page, type Request, type Route } from 'playwright';

import type { FoundResult } from '../../../Interfaces/Common/FoundResult';
import type { IDoneResult } from '../../../Interfaces/Common/StepResult';

interface IMockRoute {
  match: string | RegExp;
  method?: 'GET' | 'POST';
  abort?: boolean;
  contentType?: string;
  body?: string | ((request: Request) => string);
  status?: number;
}

/**
 * Reads a fixture file from the fixtures directory relative to this helper.
 *
 * @param fixturePath - relative path within the fixtures directory
 * @returns the file contents as a UTF-8 string
 */
export function loadFixture(fixturePath: string): string {
  const absolutePath = path.resolve(__dirname, '..', 'fixtures', fixturePath);
  return fs.readFileSync(absolutePath, 'utf-8');
}

/**
 * Finds the first route in the list that matches the given URL and HTTP method.
 *
 * @param url - the request URL to match against
 * @param method - the HTTP method of the request
 * @param routes - the list of mock routes to search
 * @returns a FoundResult wrapping the matched IMockRoute, or isFound:false if none matches
 */
function findMatchingRoute(
  url: string,
  method: string,
  routes: IMockRoute[],
): FoundResult<IMockRoute> {
  const found = routes.find(mockRoute => {
    const isUrlMatch =
      mockRoute.match instanceof RegExp ? mockRoute.match.test(url) : url.includes(mockRoute.match);
    const isMethodMatch = !mockRoute.method || mockRoute.method === method;
    return isUrlMatch && isMethodMatch;
  });
  return found ? { isFound: true, value: found } : { isFound: false };
}

/**
 * Fulfills or aborts a Playwright route according to the mock route configuration.
 *
 * @param route - the Playwright Route to respond to
 * @param request - the intercepted Request object
 * @param mockRoute - the mock configuration describing how to respond
 * @returns a resolved IDoneResult after the route is handled
 */
async function handleMockRoute(
  route: Route,
  request: Request,
  mockRoute: IMockRoute,
): Promise<IDoneResult> {
  if (mockRoute.abort) {
    await route.abort('failed');
    return { done: true };
  }
  const body = typeof mockRoute.body === 'function' ? mockRoute.body(request) : mockRoute.body;
  await route.fulfill({
    status: mockRoute.status ?? 200,
    contentType: mockRoute.contentType ?? 'text/plain',
    body,
  });
  return { done: true };
}

/**
 * Attaches route interception to the given page, responding with mock fixtures or aborting.
 *
 * @param page - the Playwright page to intercept requests on
 * @param routes - the list of mock routes to match against incoming requests
 * @returns a resolved IDoneResult after route interception is attached
 */
export async function setupRequestInterception(
  page: Page,
  routes: IMockRoute[],
): Promise<IDoneResult> {
  await page.route(
    '**/*',
    /**
     * Handles each intercepted request by matching it against the mock route list.
     *
     * @param route - the Playwright Route to respond to
     * @param request - the intercepted Request object
     */
    async (route: Route, request: Request) => {
      const url = request.url();
      const method = request.method();
      const matched = findMatchingRoute(url, method, routes);

      if (matched.isFound) {
        await handleMockRoute(route, request, matched.value);
        return;
      }

      await route.continue();
    },
  );
  return { done: true };
}
