/**
 * VisaCal (CAL) registry config — isolated because CAL's post-login journey
 * needs three coordinated guards that would otherwise crowd the registry.
 *
 * <p>CAL's journey spans three origins: a marketing site, an SSO origin, and
 * the SPA that talks to the data API. Two independent faults fall out of that
 * split, and each guard below addresses one:
 *
 * <ul>
 *   <li>NAV — the post-login redirect targets `/dashboard`, which CAL has
 *       served from a stale build whose Angular bootstrap bundles were deleted
 *       by a newer deploy. Those bundle URLs fall through to the SPA catch-all
 *       and return `index.html` as `text/html`; with `nosniff` the browser
 *       must refuse to execute them, so the app never boots and the session is
 *       left half-initialised. Navigating to the site root instead loads the
 *       CURRENT build, which boots and client-routes to the dashboard.</li>
 *   <li>SCOPE — the header bag adopts the first captured request carrying a
 *       wanted header. Unscoped, the marketing site's public widget identifier
 *       wins over the gateway one. Restricting donors to the data-API family
 *       makes a wrong-family donor impossible by construction.</li>
 *   <li>PIN — the gateway identifier is supplied from config and OVERRIDES
 *       discovery. It is compiled into the SPA rather than served, so it never
 *       appears on a request we can harvest; meanwhile sibling services on the
 *       SAME host mint their own variants, which host scoping cannot tell
 *       apart. Letting discovery win therefore guarantees a wrong value.</li>
 * </ul>
 */

import type { IPipelineBankConfig } from './PipelineBankConfigTypes.js';

/** CAL data-API family — the ONLY donor allowed for VisaCal's header bag. */
const CAL_API_HOST = 'api.cal-online.co.il';

/**
 * CAL SPA origin — the document AUTH-DISCOVERY navigates to, and therefore the
 * `Origin` / `Referer` the browser generates for the SPA's own data-API calls.
 * Both are forbidden header names: an in-page `fetch()` cannot set them, so
 * they are correct only because NAV puts us on the right document.
 */
const CAL_SPA_ORIGIN = 'https://digital-web.cal-online.co.il';

/**
 * CAL gateway site identifier, compiled into the SPA as an Angular class field
 * (`Ut.xSiteId`) rather than served, so it cannot be read from any response
 * body. Matches the value the upstream project pins for the same reason.
 */
const CAL_X_SITE_ID = '09031987-273E-2311-906C-8AF85B17C8D9';

/**
 * SPA route AUTH-DISCOVERY navigates to post-login. Deliberately the site
 * ROOT, not `/dashboard`: the root is the route CAL keeps on its current
 * build, and the SPA routes onward to the dashboard client-side.
 */
const CAL_SPA_BOOT_URL = `${CAL_SPA_ORIGIN}/`;

/**
 * Headers the data API requires that the SPA mints rather than serves.
 *
 * <p>`X-Site-Id` only. `Origin` and `Referer` are deliberately NOT pinned:
 * the Fetch spec makes them forbidden header names, so a browser silently
 * discards any attempt to set them. Pinning them would imply a control we do
 * not have; NAV is what actually makes them correct.
 */
const CAL_PINNED_HEADERS = {
  'X-Site-Id': CAL_X_SITE_ID,
} as const;

/**
 * Build the VisaCal registry config — a card-cycle bank whose completed login
 * yields a discovered token, plus the NAV / SCOPE / PIN guards above.
 * @param base - Official website URL for the HOME phase.
 * @returns Registry config for VisaCal.
 */
function calConfig(base: string): IPipelineBankConfig {
  return {
    urls: { base },
    balanceKind: 'card-cycle',
    authStrategyKind: 'token',
    installDiscoveredHeaders: true,
    discoveredHeadersUrlMatch: CAL_API_HOST,
    pinnedDiscoveredHeaders: CAL_PINNED_HEADERS,
    postLoginNav: { url: CAL_SPA_BOOT_URL },
  };
}

export { CAL_API_HOST, CAL_SPA_BOOT_URL, CAL_SPA_ORIGIN, CAL_X_SITE_ID, calConfig };
