/**
 * AUTH-DISCOVERY phase Mediator — internal helpers.
 *
 * Single-call-site for the auth-token + dashboard-reveal + cookie
 * audit signals. Mission 1 of the CI quality hardening plan.
 *
 * <p>This file is the ONLY production file that wraps
 * `probeDashboardReveal` outside of the Dashboard zone allowlist
 * (DashboardPhaseActions.ts, DashboardProbe.ts, DashboardDiscovery.ts
 * itself). Architecture rule R-AUTH-DISCOVERY-OWN
 * (`LayerSeparationArchitecture.test.ts`) forbids any other phase
 * mediator from importing the helper.
 */

import { PIPELINE_WELL_KNOWN_API } from '../../Registry/WK/ScrapeWK.js';
import type { IFetchOpts } from '../../Strategy/Fetch/FetchStrategy.js';
import { probeDashboardReveal } from '../Dashboard/DashboardDiscovery.js';
import type { ICookieSnapshot, IElementMediator } from '../Elements/ElementMediator.js';
import type { IDiscoveredEndpoint, INetworkDiscovery } from '../Network/NetworkDiscoveryTypes.js';

/** Result of a session-cookie audit at AUTH-DISCOVERY entry. */
interface ISessionCookieAudit {
  readonly count: number;
  readonly names: readonly string[];
}

/** Result of an auth-channel collection — flat record consumed by FINAL. */
interface IAuthChannelCollection {
  readonly authToken: string | false;
  readonly origin: string | false;
  readonly siteId: string | false;
  readonly headers: Readonly<Record<string, string>>;
}

/**
 * Audit session cookies — counts + names, never values.
 * @param mediator - Element mediator with cookie access.
 * @returns Cookie audit record.
 */
async function auditSessionCookies(mediator: IElementMediator): Promise<ISessionCookieAudit> {
  const cookies: readonly ICookieSnapshot[] = await mediator
    .getCookies()
    .catch((): readonly ICookieSnapshot[] => []);
  const names = cookies.map((c): string => c.name);
  return { count: cookies.length, names };
}

/** Empty extraHeaders bag returned when buildDiscoveredHeaders fails. */
const EMPTY_HEADERS: Readonly<Record<string, string>> = {};

/**
 * Narrow the `IFetchOpts | false` return from
 * `network.buildDiscoveredHeaders()` into a flat headers map. Early-
 * returns the empty bag when the call failed (returned `false`).
 *
 * @param fetchOpts - Result from buildDiscoveredHeaders (`false` when
 *   the network surface couldn't build any headers).
 * @returns Headers map (empty when `fetchOpts` was `false`).
 */
function extractHeaders(fetchOpts: IFetchOpts | false): Readonly<Record<string, string>> {
  if (fetchOpts === false) return EMPTY_HEADERS;
  return fetchOpts.extraHeaders;
}

/**
 * Collect the four discovered auth channels from the captured network
 * surface. Each helper returns `string | false` independently; they
 * compose into the slim {@link IAuthChannelCollection} record.
 * @param network - Network discovery surface from the mediator.
 * @returns Collected auth channels.
 */
async function collectAuthChannels(network: INetworkDiscovery): Promise<IAuthChannelCollection> {
  const authToken = await network.discoverAuthToken().catch((): false => false);
  const origin = network.discoverOrigin();
  const siteId = network.discoverSiteId();
  const fetchOpts = await network.buildDiscoveredHeaders().catch((): false => false);
  const headers = extractHeaders(fetchOpts);
  return { authToken, origin, siteId, headers };
}

/**
 * Probe whether the dashboard markers are visible. The single owner
 * of `probeDashboardReveal` outside of the Dashboard zone — see
 * file-level note above.
 * @param mediator - Element mediator.
 * @returns Pair of `dashboardReady` boolean and the raw reveal string
 *   (used only for telemetry).
 */
async function probeDashboardSignal(
  mediator: IElementMediator,
): Promise<{ readonly dashboardReady: boolean; readonly revealString: string }> {
  const revealString = await probeDashboardReveal(mediator);
  const isDashboardReady = revealString !== 'no reveal';
  return { dashboardReady: isDashboardReady, revealString };
}

/**
 * True when the captured endpoint's HTTP status confirms a successful
 * first-party response. `undefined` status (replay/test paths) is
 * treated as corroborating — the endpoint was captured, which is signal
 * enough.
 *
 * @param ep - Captured endpoint to inspect.
 * @returns True when status is absent OR a 2xx (200–299).
 */
function isAuthed2xx(ep: IDiscoveredEndpoint): boolean {
  return ep.status === undefined || (ep.status >= 200 && ep.status <= 299);
}

/**
 * Returns true when the captured network pool contains at least one
 * first-party well-known accounts OR auth API response. An
 * unauthenticated page never triggers the authed data fetch, whereas a
 * same-URL authenticated SPA (e.g. Isracard `/StatusPage`) fires
 * `GetCardList`-class endpoints that appear in the `accounts` bucket.
 * Uses the shared `PIPELINE_WELL_KNOWN_API` OCP registry — zero
 * bank-specific logic.
 *
 * @param network - Network discovery surface from the mediator.
 * @returns True when a corroborating first-party API capture is present.
 */
function hasCapturedAuthApi(network: INetworkDiscovery): boolean {
  const accts = network.discoverByPatterns(PIPELINE_WELL_KNOWN_API.accounts);
  if (accts !== false && isAuthed2xx(accts)) return true;
  const auth = network.discoverByPatterns(PIPELINE_WELL_KNOWN_API.auth);
  return auth !== false && isAuthed2xx(auth);
}

export type { IAuthChannelCollection, ISessionCookieAudit };
export { auditSessionCookies, collectAuthChannels, hasCapturedAuthApi, probeDashboardSignal };
