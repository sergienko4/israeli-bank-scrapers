/**
 * BIND-API-MEDIATOR auth-prime — install the discovered Authorization for
 * `authStrategyKind === 'token'` browser banks (VisaCal + the FIBI family).
 * Session-cookie banks ride first-party cookies on BrowserFetchStrategy and
 * need no prime.
 *
 * Runs the SAME 5-tier AuthDiscovery orchestrator the generic AUTH-DISCOVERY
 * phase used — response bodies (Tier 2) → page/frame sessionStorage (Tier 3a-c)
 * → request headers (Tier 1) → poll (Tier 4) — over the login-inclusive capture
 * pool + the live login page. Banks whose API Bearer is injected by the SPA's
 * own HTTP interceptor (FIBI `appsng` BFF — absent from every login body and any
 * parseable storage shape) declare `authHeaderUrlMatch`; that family-scoped
 * sniff runs FIRST so a wrong-family token is never picked. The network-trace
 * gate opens at login entry, so
 * the SPA's own login response (which mints the token — e.g. Cal's connect-login
 * `{"token":...}`) is already in the pool, and Tier 2 `discoverFromResponses`
 * reads it. The resolved value already carries its scheme (`CALAuthScheme <jwt>`
 * / `Bearer <jwt>`), so it installs verbatim via `setRawAuth` (never `setBearer`,
 * which would prepend a second scheme). Zero bank coupling.
 */

import type { Page } from 'playwright-core';

import type { IApiMediator } from '../../Mediator/Api/ApiMediator.types.js';
import { discoverFromHeaders } from '../../Mediator/Network/AuthDiscovery/HeadersTier.js';
import discoverAuthThreeTier from '../../Mediator/Network/AuthDiscovery/Orchestrator.js';
import buildDiscoveredHeadersFromCapture from '../../Mediator/Network/DiscoveryHeaders/DiscoveryHeaders.js';
import type { IDiscoveredEndpoint } from '../../Mediator/Network/Types/Endpoint.js';
import type { IPipelineBankConfig } from '../../Registry/Config/PipelineBankConfigTypes.js';

/** The two token sources the orchestrator reads: login capture pool + live page. */
interface IAuthTokenSource {
  readonly pool: readonly IDiscoveredEndpoint[];
  readonly page: Page;
}

/**
 * Config-driven auth-header sniff (FIBI `appsng` BFF) — scan the login-inclusive
 * capture pool, scoped to the bank's own SPA endpoint family, for the first
 * request carrying a non-empty auth header. Skips the Bearer-less OAuth
 * code-exchange naturally and never picks a wrong-family token (unlike the
 * generic first-match-across-all-URLs Tier 1). No-op when the bank did not
 * declare `authHeaderUrlMatch`.
 * @param config - Resolved bank config carrying `authHeaderUrlMatch`.
 * @param pool - Login-inclusive capture pool (carries request headers).
 * @returns The sniffed scheme-prefixed token, or false.
 */
function captureAuthHeaderFromPool(
  config: IPipelineBankConfig,
  pool: readonly IDiscoveredEndpoint[],
): string | false {
  const urlMatch = config.authHeaderUrlMatch;
  if (!urlMatch) return false;
  const scoped = pool.filter((ep): boolean => ep.url.includes(urlMatch));
  return discoverFromHeaders(scoped);
}

/**
 * Discover the post-login Authorization for `'token'` banks (no-op for non-token
 * banks). Tries the config-driven `appsng`-family header sniff FIRST (so a
 * wrong-family token is never picked), then falls back to the 5-tier
 * AuthDiscovery orchestrator. The captured value already carries its scheme, so
 * callers install it verbatim.
 * @param config - Resolved bank config carrying `authStrategyKind`.
 * @param source - Login capture pool + live login page.
 * @returns The discovered scheme-prefixed token, or false.
 */
async function discoverAuthToken(
  config: IPipelineBankConfig,
  source: IAuthTokenSource,
): Promise<string | false> {
  if (config.authStrategyKind !== 'token') return false;
  const sniffed = captureAuthHeaderFromPool(config, source.pool);
  if (sniffed) return sniffed;
  return discoverAuthThreeTier(source.pool, source.page);
}

/**
 * Install a discovered token on the mediator verbatim via `setRawAuth` (never
 * `setBearer`, which would prepend a second scheme).
 * @param token - Scheme-prefixed token to install.
 * @param mediator - Browser-page mediator to authorize.
 * @returns True when the mediator accepted the token.
 */
function installAuthToken(token: string, mediator: IApiMediator): boolean {
  return mediator.setRawAuth(token);
}

/**
 * Prime the mediator Authorization for `'token'` banks (no-op otherwise). Thin
 * compose over {@link discoverAuthToken} + {@link installAuthToken}.
 * @param config - Resolved bank config carrying `authStrategyKind`.
 * @param source - Login capture pool + live login page.
 * @param mediator - Browser-page mediator to authorize.
 * @returns True when a token was installed, false otherwise.
 */
async function primeTokenAuth(
  config: IPipelineBankConfig,
  source: IAuthTokenSource,
  mediator: IApiMediator,
): Promise<boolean> {
  const token = await discoverAuthToken(config, source);
  if (!token) return false;
  return installAuthToken(token, mediator);
}

/**
 * Build the discovered-header bag installed on every hard-model call for banks
 * that opt in via `installDiscoveredHeaders`. Reuses the proven generic
 * `buildDiscoveredHeadersFromCapture` (SPA content-negotiation headers +
 * Origin / Referer / X-Site-Id, plus the token as Authorization when found).
 * Returns an empty bag — a transparent pass-through — when not opted in.
 * @param config - Resolved bank config carrying `installDiscoveredHeaders`.
 * @param pool - Login-inclusive capture pool the headers are drawn from.
 * @param token - Discovered token (folded in as Authorization) or false.
 * @returns The header bag, or `{}` when the bank did not opt in.
 */
function buildDiscoveredHeaderBag(
  config: IPipelineBankConfig,
  pool: readonly IDiscoveredEndpoint[],
  token: string | false,
): Record<string, string> {
  if (!config.installDiscoveredHeaders) return {};
  const opts = buildDiscoveredHeadersFromCapture(pool, token);
  return opts.extraHeaders;
}

export default primeTokenAuth;
export { buildDiscoveredHeaderBag, discoverAuthToken, installAuthToken, primeTokenAuth };
