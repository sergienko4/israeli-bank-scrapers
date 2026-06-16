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

export { resolveAbsoluteHref };
export default resolveAbsoluteHref;
