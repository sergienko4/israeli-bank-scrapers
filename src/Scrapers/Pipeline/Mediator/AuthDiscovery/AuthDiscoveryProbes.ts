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

import type { IFetchOpts } from '../../Strategy/Fetch/FetchStrategy.js';
import { probeDashboardReveal } from '../Dashboard/DashboardDiscovery.js';
import type { ICookieSnapshot, IElementMediator } from '../Elements/ElementMediator.js';
import type { INetworkDiscovery } from '../Network/NetworkDiscoveryTypes.js';

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

export type { IAuthChannelCollection, ISessionCookieAudit };
export { auditSessionCookies, collectAuthChannels, probeDashboardSignal };
