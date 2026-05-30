/**
 * Network DiscoveryHeaders — shared `buildDiscoveredHeaders`
 * implementation used by both the live DiscoveryEngine and the
 * FrozenReplay surface. CR PR #276 #5: the previous duplicate
 * helpers risked drifting out of sync; extracting a single
 * `buildDiscoveredHeadersFromCapture` keeps the auth / Origin /
 * Referer / X-Site-Id layering in one place.
 */

import type { IFetchOpts } from '../../../Strategy/Fetch/FetchStrategy.js';
import { ORIGIN_HEADERS, REFERER_HEADERS, SITE_ID_HEADERS } from '../Indexing/Indexing.js';
import type { IDiscoveredEndpoint } from '../NetworkDiscoveryTypes.js';
import { discoverHeaderValue, extractSpaHeaders, spaHasAny } from '../Scoring/Scoring.js';

/**
 * Apply the Origin header (and Referer fallback) from captured traffic.
 * CR PR #280 #122 fix: prefers the captured Referer over the Origin
 * fallback when both are present.
 * @param spaBase - SPA-extracted header base (mutated).
 * @param captured - Captured endpoints for the header probes.
 * @returns The mutated header object (passed through for chaining).
 */
function setOriginAndReferer(
  spaBase: Record<string, string>,
  captured: readonly IDiscoveredEndpoint[],
): Record<string, string> {
  const origin = discoverHeaderValue(captured, ORIGIN_HEADERS);
  if (origin) spaBase.Origin = origin;
  const referer = discoverHeaderValue(captured, REFERER_HEADERS) || origin;
  if (referer && !spaHasAny(spaBase, REFERER_HEADERS)) spaBase.Referer = referer;
  return spaBase;
}

/**
 * Apply the X-Site-Id fallback from captured traffic.
 * @param spaBase - SPA-extracted header base (mutated).
 * @param captured - Captured endpoints for the header probes.
 * @returns The mutated header object (passed through for chaining).
 */
function setSiteId(
  spaBase: Record<string, string>,
  captured: readonly IDiscoveredEndpoint[],
): Record<string, string> {
  const siteId = discoverHeaderValue(captured, SITE_ID_HEADERS);
  if (siteId && !spaHasAny(spaBase, SITE_ID_HEADERS)) spaBase['X-Site-Id'] = siteId;
  return spaBase;
}

/**
 * Apply the bank-specific Origin / Referer / X-Site-Id fallback
 * layers on top of the SPA-extracted header base, gated by
 * {@link spaHasAny} so duplicate-header rejection (VisaCal 401
 * regression) cannot resurface.
 * @param spaBase - SPA-extracted header base (mutated copy).
 * @param captured - Captured endpoints for the header probes.
 * @returns The mutated header object for chaining.
 */
function applyOriginRefererSiteId(
  spaBase: Record<string, string>,
  captured: readonly IDiscoveredEndpoint[],
): Record<string, string> {
  setOriginAndReferer(spaBase, captured);
  setSiteId(spaBase, captured);
  return spaBase;
}

/**
 * Shared implementation of `buildDiscoveredHeaders`. Captured SPA
 * headers are the SINGLE source of truth (no hardcoded Content-Type,
 * no defaults); bank-specific Origin / Referer / X-Site-Id layers
 * stack on top only when the SPA didn't capture an equivalent value.
 *
 * @param captured - Captured endpoints to draw header values from.
 * @param cachedAuth - Pre-cached / live-discovered auth token (or false).
 * @returns Fetch options carrying the assembled `extraHeaders`.
 */
function buildDiscoveredHeadersFromCapture(
  captured: readonly IDiscoveredEndpoint[],
  cachedAuth: string | false,
): IFetchOpts {
  const spaBase = extractSpaHeaders(captured);
  const extraHeaders: Record<string, string> = { ...spaBase };
  if (cachedAuth) extraHeaders.authorization = cachedAuth;
  applyOriginRefererSiteId(extraHeaders, captured);
  return { extraHeaders };
}

export default buildDiscoveredHeadersFromCapture;
