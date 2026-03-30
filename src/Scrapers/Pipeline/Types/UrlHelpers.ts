/**
 * URL utility helpers — dynamic pattern generation from config.
 * Generic for ALL banks — derives data-domain patterns from config.api.base.
 */

import { WK } from '../Registry/PipelineWellKnown.js';

/** Escaped hostname string for use in RegExp. */
type EscapedHost = string;
/** Whether the hostname prefix was replaced by the regex. */
type WasReplaced = boolean;
/** API base URL from config (nullable). */
type ApiBaseUrl = string | null;

/**
 * Escape special regex characters in a hostname string.
 * @param host - Raw hostname (e.g., 'web.americanexpress.co.il').
 * @returns Escaped hostname safe for RegExp constructor.
 */
function escapeHostForRegex(host: EscapedHost): EscapedHost {
  return host.replace(/\./g, '\\.');
}

/**
 * Derive the web-domain hostname from an api.base URL.
 * Swaps known prefixes (he., digital.) to 'web.'.
 * @param apiBase - The bank's api.base URL.
 * @returns Escaped web hostname or false if no swap was possible.
 */
function deriveWebHostname(apiBase: ApiBaseUrl): EscapedHost | false {
  if (!apiBase) return false;
  const url = new URL(apiBase);
  const webHostname = url.hostname.replace(/^(?:he|digital)\./, 'web.');
  const wasReplaced: WasReplaced = webHostname !== url.hostname;
  if (!wasReplaced) return false;
  return escapeHostForRegex(webHostname);
}

/**
 * Build dynamic transaction page patterns from config.api.base.
 * Derives the data-domain hostname by swapping the first subdomain to 'web.'.
 * Falls back to WK base patterns when api.base is null or unparseable.
 * @param apiBase - The bank's api.base URL (e.g., 'https://he.americanexpress.co.il').
 * @returns Regex array: WK base patterns + dynamic data-domain pattern.
 */
function buildTxnPagePatterns(apiBase: ApiBaseUrl): readonly RegExp[] {
  const escaped = safeDerive(apiBase);
  if (!escaped) return WK.DASHBOARD.TXN_PAGE_PATTERNS;
  const dynamic = new RegExp(`${escaped}.*\\/transactions`, 'i');
  return [...WK.DASHBOARD.TXN_PAGE_PATTERNS, dynamic];
}

/**
 * Safe wrapper for deriveWebHostname — catches URL parse errors.
 * @param apiBase - API base URL or null.
 * @returns Escaped web hostname or false on any failure.
 */
function safeDerive(apiBase: ApiBaseUrl): EscapedHost | false {
  try {
    return deriveWebHostname(apiBase);
  } catch {
    return false;
  }
}

export default buildTxnPagePatterns;
export { buildTxnPagePatterns };
