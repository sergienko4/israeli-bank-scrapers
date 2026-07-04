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
import { BANCS_ACCOUNT_URL, isBancsAuthResponse } from '../Scrape/Bancs/BancsAuthResponse.js';

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
 * Stricter 2xx check for the BaNCS reveal-missing corroboration path: the
 * status MUST be an explicit 2xx. Unlike {@link isAuthed2xx}, an absent
 * status does NOT pass — so a status-less capture cannot corroborate a
 * REVEAL-missing login (defense-in-depth, S-3). Genuine BaNCS `/account`
 * responses always carry an explicit 200, so this never rejects a real
 * authed capture.
 *
 * @param ep - Captured endpoint to inspect.
 * @returns True only when status is a defined 2xx (200–299).
 */
function isExplicit2xx(ep: IDiscoveredEndpoint): boolean {
  return ep.status !== undefined && ep.status >= 200 && ep.status <= 299;
}

/**
 * Returns true when the captured network pool contains at least one
 * first-party well-known account-data API response (the `accounts`
 * bucket: `GetCardList`, `userAccountsData`, `accountSummary`, …). Uses
 * the shared `PIPELINE_WELL_KNOWN_API` OCP registry — no bank-specific
 * logic.
 *
 * @param network - Network discovery surface from the mediator.
 * @returns True when a corroborating well-known account-data capture exists.
 */
function hasWellKnownAuthApi(network: INetworkDiscovery): boolean {
  return PIPELINE_WELL_KNOWN_API.accounts.some((pattern): boolean =>
    network.findEndpoints(pattern).some(isAuthed2xx),
  );
}

/**
 * Returns true when the pool contains an authed BaNCS account-data
 * response. TCS BaNCS multiplexes every resource through the SAME
 * `…/BaNCSDigitalApp/account` URL, so it matches no well-known `accounts`
 * pattern (the Gap L blind spot). {@link isBancsAuthResponse} recognizes
 * it by JSON + `Payload.DataEntity[]` envelope shape, paired here with an
 * EXPLICIT 2xx check ({@link isExplicit2xx}) — so the HTML Imperva
 * interstitial (served 200) AND a status-less capture can never corroborate.
 * Default-deny for every non-BaNCS pool.
 *
 * @param network - Network discovery surface from the mediator.
 * @returns True when an authed BaNCS account-data capture is present.
 */
function hasBancsAuthApi(network: INetworkDiscovery): boolean {
  return network
    .findEndpoints(BANCS_ACCOUNT_URL)
    .some((ep): boolean => isExplicit2xx(ep) && isBancsAuthResponse(ep));
}

/**
 * Returns true when the captured network pool corroborates that an
 * authenticated first-party data fetch occurred — via a well-known
 * `accounts` capture OR a shape-recognized BaNCS `/account` envelope. An
 * unauthenticated page never triggers the authed data fetch, whereas a
 * same-URL authenticated SPA (e.g. Isracard `/StatusPage`) does. The
 * `auth` bucket is deliberately excluded: those are credentials-
 * submission endpoints that fire DURING login, so a capture proves login
 * was attempted — not that the dashboard was reached.
 *
 * @param network - Network discovery surface from the mediator.
 * @returns True when a corroborating first-party account-data capture is present.
 *   Scans EVERY capture matching each pattern (not just the first), so an
 *   early non-2xx (e.g. a 401 that preceded the authed retry) cannot mask
 *   a later 200 on the same URL.
 */
function hasCapturedAuthApi(network: INetworkDiscovery): boolean {
  return hasWellKnownAuthApi(network) || hasBancsAuthApi(network);
}

export type { IAuthChannelCollection, ISessionCookieAudit };
export { auditSessionCookies, collectAuthChannels, hasCapturedAuthApi, probeDashboardSignal };
