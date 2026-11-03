/**
 * Factory: ApiMediator bound to a LIVE Playwright page.
 *
 * Post-auth hard-model banks reuse the SAME browser page that performed
 * the WAF-bypassing login, so their REST calls inherit the session
 * cookies + TLS/JA3 fingerprint for free (no separate Camoufox session).
 * The transport is {@link BrowserFetchStrategy}; GraphQL is inert for
 * these REST-only banks — the strategy is constructed over the page's
 * origin and never invoked (all calls flow through urlTag → apiPost/apiGet).
 *
 * Why `Reflect.construct(...)`: this module is a DI boundary where a
 * concrete fetch-strategy is injected into the mediator. The project-wide
 * `no-direct-new` rule forbids `new Foo()` in business logic; a factory is
 * the single legitimate construction site. Mirrors ApiMediator.factories.ts.
 */

import type { Page } from 'playwright-core';

import type { CompanyTypes } from '../../../../Definitions.js';
import { createBrowserFetchStrategy } from '../../Strategy/Fetch/BrowserFetchStrategy.js';
import { withDefaultHeaders } from '../../Strategy/Fetch/DefaultHeadersFetchStrategy.js';
import type { IFetchStrategy } from '../../Strategy/Fetch/FetchStrategy.js';
import { GraphQLFetchStrategy } from '../../Strategy/Fetch/GraphQLFetchStrategy.js';
import { createApiMediator } from './ApiMediator.factory.js';
import type { IApiMediator } from './ApiMediator.types.js';

/**
 * Resolve the page's current origin — the inert GraphQL base URL.
 * @param page - Live post-login Playwright page.
 * @returns Origin of the page's current URL.
 */
function pageOrigin(page: Page): string {
  return new URL(page.url()).origin;
}

/**
 * The page-bound fetch transport, carrying the discovered SPA header bag.
 * @param page - Live post-login Playwright page.
 * @param defaultHeaders - Discovered default-header bag (empty ⇒ no wrap).
 * @returns Browser-session fetch strategy.
 */
function pageFetchOf(page: Page, defaultHeaders: Readonly<Record<string, string>>): IFetchStrategy {
  const base = createBrowserFetchStrategy(page);
  return withDefaultHeaders(base, defaultHeaders);
}

/**
 * Build an ApiMediator whose REST transport runs through a live page.
 *
 * When `defaultHeaders` is non-empty the browser fetch strategy is wrapped
 * so every call carries the bank's discovered SPA header bag under its
 * per-call headers (see {@link withDefaultHeaders}); an empty bag is a
 * transparent pass-through, so cookie/token banks are byte-identical.
 * @param bankHint - Target bank (for WK lookups).
 * @param page - Live post-login Playwright page (session cookies attached).
 * @param defaultHeaders - Discovered default-header bag (empty ⇒ no wrap).
 * @returns IApiMediator dispatching through the browser page session.
 */
function createBrowserPageApiMediator(
  bankHint: CompanyTypes,
  page: Page,
  defaultHeaders: Readonly<Record<string, string>> = {},
): IApiMediator {
  const fetch = pageFetchOf(page, defaultHeaders);
  const gql: GraphQLFetchStrategy = Reflect.construct(GraphQLFetchStrategy, [pageOrigin(page)]);
  const mediator = createApiMediator(bankHint, fetch, gql);
  return Object.assign(mediator, { drivesBrowser: true as const });
}

export default createBrowserPageApiMediator;
export { createBrowserPageApiMediator };
