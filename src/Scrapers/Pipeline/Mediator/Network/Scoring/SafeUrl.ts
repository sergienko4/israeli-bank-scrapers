/**
 * Network Scoring / SafeUrl — single source of truth for guarded URL
 * parsing. CR PR #276 #9: malformed referer / CORS / config bodies
 * sent by banks were throwing unguarded `new URL()` calls and
 * crashing the discovery tier. Every tier helper now routes through
 * {@link safeParseWindowUrl}.
 */

/**
 * Safely parse a URL string. Returns `false` on any parse error so
 * the caller can fall through without try/catch noise.
 * @param input - Candidate URL.
 * @returns Parsed `URL` or `false` on malformed input.
 */
function safeParseWindowUrl(input: string): URL | false {
  try {
    return new URL(input);
  } catch {
    return false;
  }
}

export default safeParseWindowUrl;
