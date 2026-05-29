/**
 * Network Scoring / ConfigUrlMatcher — shared "config-like endpoint"
 * predicate used by both the SPA Tier-3 referer discovery
 * ({@link ./SpaDiscovery.js}) and the API-origin Tier-1 config-body
 * scan ({@link ./ApiOriginDiscovery.js}). Extracted per CR PR #276
 * post-review-fix so the two discovery tiers cannot drift on the
 * config-segment heuristic, and the literal segment names live in
 * named constants per the guidelines ban on inline magic strings.
 */

/** URL segment indicating a bank "client config" endpoint. */
const CONFIG_SEGMENT = 'config' as const;

/** URL segment indicating a bank "client settings" endpoint. */
const SETTINGS_SEGMENT = 'settings' as const;

/**
 * True when the URL contains a `config` or `settings` segment.
 * Both SPA Tier-3 and API-origin Tier-1 use this predicate to find
 * the bank's JSON config endpoint whose body lists API URLs.
 * @param url - Captured endpoint URL.
 * @returns True when the URL includes a config-like segment.
 */
function isConfigOrSettingsUrl(url: string): boolean {
  return url.includes(CONFIG_SEGMENT) || url.includes(SETTINGS_SEGMENT);
}

export { CONFIG_SEGMENT, isConfigOrSettingsUrl, SETTINGS_SEGMENT };
