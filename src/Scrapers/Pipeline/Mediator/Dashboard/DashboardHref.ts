/**
 * Dashboard href resolution — absolute-URL building with unsafe-scheme
 * rejection. Extracted from DashboardDiscovery.ts so DashboardNavigation
 * can import it without a back-edge, breaking their import cycle.
 */

/** Lowercased URL schemes rejected by `resolveAbsoluteHref` —
 *  `javascript:` / `data:` / `vbscript:` / `file:` / `ws[s]:` are unsafe
 *  or unsupported targets for a dashboard navigation step (CodeQL
 *  js/incomplete-url-substring-sanitization). */
const REJECTED_HREF_SCHEMES: readonly string[] = [
  'javascript:',
  'data:',
  'vbscript:',
  'file:',
  'ws:',
  'wss:',
];

/**
 * Test whether an href starts with a rejected URL scheme. Case-insensitive
 * because the WHATWG URL parser also normalises scheme to lower-case.
 * @param href - Trimmed href string.
 * @returns True iff href begins with any rejected scheme.
 */
function startsWithRejectedScheme(href: string): boolean {
  const lower = href.toLowerCase().trim();
  return REJECTED_HREF_SCHEMES.some((scheme): boolean => lower.startsWith(scheme));
}

/**
 * Build absolute URL from a relative href.
 * @param href - Relative or absolute href.
 * @param pageUrl - Current page URL for resolution.
 * @returns Absolute URL string, or empty if malformed.
 */
function resolveAbsoluteHref(href: string, pageUrl: string): string {
  if (!href || href.startsWith('#') || startsWithRejectedScheme(href)) return '';
  try {
    return new URL(href, pageUrl).href;
  } catch {
    return '';
  }
}

/**
 * Accept absHref only when it shares the page's origin; reject cross-origin.
 * @param absHref - Absolute href (may be empty).
 * @param pageUrl - Current page URL used as the trusted-origin anchor.
 * @returns absHref when same-origin, else empty string.
 */
function sameOriginOrEmpty(absHref: string, pageUrl: string): string {
  if (!absHref) return '';
  try {
    return new URL(absHref).origin === new URL(pageUrl).origin ? absHref : '';
  } catch {
    return '';
  }
}

/**
 * Resolve a raw href to an absolute URL, then enforce same-origin.
 * Combines unsafe-scheme rejection (via {@link resolveAbsoluteHref}) with
 * cross-origin rejection so callers get a safe, same-origin URL or empty.
 *
 * @param rawHref - Relative or absolute href from DOM extraction.
 * @param pageUrl - Current page URL as the resolution base and origin anchor.
 * @returns Absolute same-origin URL, or empty string when unsafe or cross-origin.
 */
function resolveHrefFromRaw(rawHref: string, pageUrl: string): string {
  const absHref = resolveAbsoluteHref(rawHref, pageUrl);
  return sameOriginOrEmpty(absHref, pageUrl);
}

export { resolveAbsoluteHref, resolveHrefFromRaw };
export default resolveAbsoluteHref;
