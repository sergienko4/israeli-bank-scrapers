/**
 * BIND-API-MEDIATOR auth-prime — install the discovered Authorization for
 * `authStrategyKind === 'token'` browser banks (VisaCal + the FIBI family).
 * Session-cookie banks ride first-party cookies on BrowserFetchStrategy and
 * need no prime.
 *
 * Runs the SAME 5-tier AuthDiscovery orchestrator the generic AUTH-DISCOVERY
 * phase used — response bodies (Tier 2) → page/frame sessionStorage (Tier 3a-c)
 * → request headers (Tier 1) → poll (Tier 4) — over the login-inclusive capture
 * pool + the live login page. The network-trace gate opens at login entry, so
 * the SPA's own login response (which mints the token — e.g. Cal's connect-login
 * `{"token":...}`) is already in the pool, and Tier 2 `discoverFromResponses`
 * reads it. The resolved value already carries its scheme (`CALAuthScheme <jwt>`
 * / `Bearer <jwt>`), so it installs verbatim via `setRawAuth` (never `setBearer`,
 * which would prepend a second scheme). Zero bank coupling.
 */

import type { Page } from 'playwright-core';

import type { IApiMediator } from '../../Mediator/Api/ApiMediator.types.js';
import discoverAuthThreeTier from '../../Mediator/Network/AuthDiscovery/Orchestrator.js';
import type { IDiscoveredEndpoint } from '../../Mediator/Network/Types/Endpoint.js';
import type { IPipelineBankConfig } from '../../Registry/Config/PipelineBankConfigTypes.js';

/** The two token sources the orchestrator reads: login capture pool + live page. */
interface IAuthTokenSource {
  readonly pool: readonly IDiscoveredEndpoint[];
  readonly page: Page;
}

/**
 * Prime the mediator Authorization for `'token'` banks via the 5-tier
 * AuthDiscovery orchestrator (no-op for non-token banks). The captured value
 * already carries its scheme, so it installs verbatim via `setRawAuth`.
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
  if (config.authStrategyKind !== 'token') return false;
  const token = await discoverAuthThreeTier(source.pool, source.page);
  if (!token) return false;
  return mediator.setRawAuth(token);
}

export default primeTokenAuth;
export { primeTokenAuth };
