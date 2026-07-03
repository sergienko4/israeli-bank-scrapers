/**
 * BIND-API-MEDIATOR auth-prime — install the discovered Bearer/JWT for
 * `authStrategyKind === 'token'` browser banks (e.g. VisaCal). Session-cookie
 * banks ride first-party cookies on BrowserFetchStrategy and need no prime.
 *
 * Reuses the proven page-only AuthDiscovery tiers (sessionStorage → poll) so
 * the token key + scheme (Cal's `CALAuthScheme <jwt>`) stay single-sourced in
 * Tokens.ts. The resolved value is the FULL Authorization header value, so it
 * is installed verbatim via `setRawAuth` (never `setBearer`, which would
 * prepend a second scheme). Zero bank coupling.
 */

import type { Page } from 'playwright-core';

import type { IApiMediator } from '../../Mediator/Api/ApiMediator.types.js';
import { pollForAuthModule } from '../../Mediator/Network/AuthDiscovery/PollTier.js';
import { discoverFromStorage } from '../../Mediator/Network/AuthDiscovery/StorageMain.js';
import type { IPipelineBankConfig } from '../../Registry/Config/PipelineBankConfigTypes.js';

/**
 * Resolve the post-login token from the live page: sessionStorage first, then
 * poll the auth-module across frames. Both tiers need only the page.
 * @param page - Live login page.
 * @returns Full Authorization header value, or false when none is present.
 */
async function resolvePageToken(page: Page): Promise<string | false> {
  const fromStorage = await discoverFromStorage(page);
  if (fromStorage) return fromStorage;
  return pollForAuthModule(page);
}

/**
 * Prime the mediator's Authorization for `'token'` banks (no-op otherwise).
 * @param config - Resolved bank config carrying `authStrategyKind`.
 * @param page - Live login page the token is read from.
 * @param mediator - Browser-page mediator to authorize.
 * @returns True when a token was installed, false otherwise.
 */
async function primeTokenAuth(
  config: IPipelineBankConfig,
  page: Page,
  mediator: IApiMediator,
): Promise<boolean> {
  if (config.authStrategyKind !== 'token') return false;
  const token = await resolvePageToken(page);
  if (!token) return false;
  return mediator.setRawAuth(token);
}

export default primeTokenAuth;
export { primeTokenAuth };
