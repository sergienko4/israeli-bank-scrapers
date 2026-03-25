/**
 * Header distillation — filters captured request headers to security-relevant ones.
 * Removes browser noise (UA, cookies, sec-*, content negotiation).
 * Keeps auth tokens, XSRF, session IDs, and origin/referer.
 */

/** Header prefixes that are security-relevant (API auth tokens). */
const SECURITY_PREFIXES = ['authorization', 'x-site', 'x-xsrf', 'session'];

/** Header prefixes/keys that are browser noise — filter out. */
const NOISE_KEYS = new Set([
  'cookie',
  'user-agent',
  'host',
  'content-length',
  'content-type',
  'accept',
  'accept-language',
  'accept-encoding',
  'connection',
  'cache-control',
  'pragma',
]);

/** Header prefixes that are browser-generated noise. */
const NOISE_PREFIXES = ['sec-ch', 'sec-fetch', 'upgrade-'];

/** Headers that must always be kept (banking API requirements). */
const ALWAYS_KEEP = new Set(['origin', 'referer']);

/**
 * Check if a header key matches a security prefix.
 * @param key - Header key (lowercase).
 * @returns True if the key is security-relevant.
 */
function isSecurityHeader(key: string): boolean {
  return SECURITY_PREFIXES.some((p): boolean => key.startsWith(p));
}

/**
 * Check if a header key is browser noise.
 * @param key - Header key (lowercase).
 * @returns True if the key should be filtered out.
 */
function isNoiseHeader(key: string): boolean {
  if (NOISE_KEYS.has(key)) return true;
  return NOISE_PREFIXES.some((p): boolean => key.startsWith(p));
}

/**
 * Decide whether a single header should be kept.
 * @param lower - Lowercased header key.
 * @returns True if the header should be kept.
 */
function shouldKeepHeader(lower: string): boolean {
  if (ALWAYS_KEEP.has(lower)) return true;
  if (isNoiseHeader(lower)) return false;
  return isSecurityHeader(lower);
}

/**
 * Distill captured request headers to only security-relevant ones.
 * Removes browser noise (UA, cookies, sec-*, content negotiation).
 * Keeps auth tokens, XSRF, session IDs, and origin/referer.
 * @param headers - Raw captured headers.
 * @returns Filtered headers with only security-relevant entries.
 */
function distillHeaders(headers: Record<string, string>): Record<string, string> {
  const entries = Object.entries(headers);
  const kept = entries.filter(([key]): boolean => {
    const lower = key.toLowerCase();
    return shouldKeepHeader(lower);
  });
  return Object.fromEntries(kept);
}

export default distillHeaders;
export { distillHeaders };
