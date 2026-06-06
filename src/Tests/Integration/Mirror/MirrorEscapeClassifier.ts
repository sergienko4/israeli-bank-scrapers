/**
 * Classify a request the mirror simulator did NOT match as one of:
 *
 *   - `fatal` — application-layer document/XHR that should have
 *     a manifest entry. Tests fail when `fatalEscapes > 0`.
 *   - `benign` — known non-essential subresource (favicons,
 *     analytics beacons, font CDNs). Aborted silently.
 *   - `noise` — browser-internal probes (DevTools, OCSP, etc.).
 *     Aborted silently.
 *
 * Design rationale (Phase 11 rubber-duck cycle 2 finding C):
 * failing on EVERY unmatched request creates noisy tests; only fatal
 * escapes should fail. The classifier table is data-driven so adding a
 * new analytics domain is a one-line allow-list entry.
 *
 * @see ./MirrorSimulator.ts
 */

import type { MirrorResourceType } from './MirrorManifest.js';

/** Escape category — drives whether the test fails. */
type EscapeKind = 'fatal' | 'benign' | 'noise';

/** Request fields the classifier evaluates. */
interface IClassifyArgs {
  readonly method: string;
  readonly url: string;
  readonly resourceType: MirrorResourceType;
}

/**
 * Hostname suffixes that are ALWAYS benign regardless of resource type.
 * Source: analytics + CDN domains observed during PR #310 mirror sweeps.
 */
const BENIGN_HOST_SUFFIXES = [
  'google-analytics.com',
  'googletagmanager.com',
  'doubleclick.net',
  'facebook.com',
  'facebook.net',
  'hotjar.com',
  'newrelic.com',
  'datadoghq.com',
  'cloudflareinsights.com',
  'sentry.io',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
] as const;

/**
 * URL path patterns that are ALWAYS noise (browser-issued, not by the
 * scraper code). Matched as substring.
 */
const NOISE_URL_PATTERNS = [
  '/favicon.ico',
  '/.well-known/',
  '/safe-browsing/',
  'data:',
  'chrome-extension://',
] as const;

/** Resource types whose unmatched requests are always benign. */
const BENIGN_RESOURCE_TYPES: ReadonlySet<MirrorResourceType> = new Set<MirrorResourceType>([
  'image',
  'font',
  'stylesheet',
  'media',
]);

/**
 * Returns true when `host` matches any benign-suffix entry. The
 * comparison is case-insensitive suffix-only so subdomains are covered.
 *
 * @param host - Lower-cased URL host.
 * @returns True when the host should be treated as benign.
 */
function hasBenignHostSuffix(host: string): boolean {
  for (const suffix of BENIGN_HOST_SUFFIXES) {
    if (host.endsWith(suffix)) return true;
  }
  return false;
}

/**
 * Returns true when the URL contains any well-known noise substring.
 *
 * @param url - The raw URL string.
 * @returns True when the URL should be treated as browser noise.
 */
function isNoiseUrl(url: string): boolean {
  for (const pattern of NOISE_URL_PATTERNS) {
    if (url.includes(pattern)) return true;
  }
  return false;
}

/**
 * Safe URL parse — returns the empty string when `url` is malformed
 * (e.g. `about:blank`, `data:`). Empty host means "treat as
 * noise" downstream.
 *
 * @param url - Raw URL string.
 * @returns Lower-cased host or empty string.
 */
function parseHostSafe(url: string): string {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Classify one unmatched request. Order: noise URL patterns -> benign
 * resource type -> benign host suffix -> fatal.
 *
 * @param args - Method + url + resource type.
 * @returns The escape category.
 */
function classifyEscape(args: IClassifyArgs): EscapeKind {
  if (isNoiseUrl(args.url)) return 'noise';
  if (BENIGN_RESOURCE_TYPES.has(args.resourceType)) return 'benign';
  const host = parseHostSafe(args.url);
  if (host === '') return 'noise';
  if (hasBenignHostSuffix(host)) return 'benign';
  return 'fatal';
}

export type { EscapeKind, IClassifyArgs };
export { BENIGN_HOST_SUFFIXES, BENIGN_RESOURCE_TYPES, classifyEscape, NOISE_URL_PATTERNS };
