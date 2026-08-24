/**
 * Discovered-header donor policy — pool scoping + pinned fallbacks.
 *
 * <p>Why this exists: {@link buildDiscoveredHeadersFromCapture} adopts the
 * FIRST captured request carrying a wanted header, with no host scoping. A
 * bank whose login journey spans several origins (a marketing site, an SSO
 * origin and the SPA) can therefore donate a header minted for a DIFFERENT
 * service. The API gateway then rejects the call with an opaque 5xx that
 * reads like an expired session, so the failure is diagnosed as an auth
 * problem and the real cause — a wrong-family header — stays invisible.
 *
 * <p>Two independent guards close that hole, both declared as bank config so
 * shared orchestration keeps zero bank coupling:
 * <ul>
 *   <li>SCOPE — restrict the donor pool to the bank's own data-API family, so
 *       a wrong-FAMILY donor is impossible by construction. Scoping is by
 *       hostname, so it cannot separate sibling services sharing one host —
 *       that residual gap is what PIN closes.</li>
 *   <li>PIN — declare the known-correct value. Pins OVERRIDE discovery,
 *       because a header the SPA compiles in rather than serves is never
 *       harvestable, so any discovered value for it belongs to another
 *       service.</li>
 * </ul>
 *
 * <p>Mirrors the family-scoped `authHeaderUrlMatch` sniff already applied to
 * the Authorization header — the same rule, extended to the negotiation
 * headers that ride alongside it.
 */

import { getDebug } from '../../../Logging/Debug.js';
import type { IDiscoveredEndpoint } from '../NetworkDiscoveryTypes.js';

const LOG = getDebug(import.meta.url);

/**
 * Test whether a captured URL's host belongs to the declared API family.
 *
 * <p>Compares the parsed hostname rather than searching the raw URL text. A
 * substring test would accept `https://evil.example/?next=api.bank.co.il` and
 * `https://api.bank.co.il.attacker.test/` — exactly the wrong-family donors
 * this scoping exists to exclude. A leading-dot suffix still matches, so a
 * declared apex domain covers its own subdomains.
 * @param url - Captured request URL.
 * @param host - Declared data-API host or apex domain.
 * @returns True when the URL's host is in the family.
 */
function isHostInFamily(url: string, host: string): boolean {
  try {
    const name = new URL(url).hostname.toLowerCase();
    const want = host.toLowerCase();
    return name === want || name.endsWith(`.${want}`);
  } catch {
    return false;
  }
}

/**
 * Restrict the header-donor pool to the bank's own data-API family.
 *
 * <p>Absent `urlMatch` the pool passes through unchanged, so every bank that
 * has not opted in keeps its existing behaviour byte-for-byte.
 * @param pool - Login-inclusive capture pool.
 * @param urlMatch - Host identifying the bank's data-API family.
 * @returns The scoped pool, or the original pool when no match is declared.
 */
function scopeHeaderDonorPool(
  pool: readonly IDiscoveredEndpoint[],
  urlMatch?: string,
): readonly IDiscoveredEndpoint[] {
  if (!urlMatch) return pool;
  return pool.filter((ep): boolean => isHostInFamily(ep.url, urlMatch));
}

/**
 * Find the bag key matching a header name in any case.
 * @param bag - Assembled header bag.
 * @param name - Header name to look for (any case).
 * @returns The matching key, or an empty string when absent.
 */
function findHeaderKey(bag: Readonly<Record<string, string>>, name: string): string {
  const lower = name.toLowerCase();
  return Object.keys(bag).find((k): boolean => k.toLowerCase() === lower) ?? '';
}

/**
 * Case-insensitive presence check for a header name in an assembled bag.
 *
 * <p>Header names reach the bag in whatever case the SPA emitted them, so a
 * pin for `X-Site-Id` must not double-write an existing `x-site-id`.
 * @param bag - Assembled header bag.
 * @param name - Header name to look for (any case).
 * @returns True when any case-variant of `name` is already present.
 */
function hasHeaderName(bag: Readonly<Record<string, string>>, name: string): boolean {
  return findHeaderKey(bag, name) !== '';
}

/**
 * Emit the PII-free breadcrumb naming which headers a pin displaced.
 *
 * <p>Discovery having produced a value for a PINNED header is the
 * early-warning signal that the host serves a sibling service minting its own
 * variant of that identifier — the exact condition host scoping cannot see.
 * Header NAMES only; values are bank-issued identifiers.
 * @param names - Header names whose discovered value the pin replaced.
 * @returns True when a breadcrumb was emitted.
 */
function logPinnedOverride(names: readonly string[]): boolean {
  if (names.length === 0) return false;
  const list = names.join(', ');
  LOG.warn({ message: `discovered-header pin overrode a discovered value: ${list}` });
  return true;
}

/**
 * Select the pinned names that displaced a non-blank discovered value.
 *
 * <p>Reported for diagnosis only — the pin is applied either way. A blank
 * discovered value is not counted: it carries no competing identifier, so
 * overwriting it is an ordinary gap-fill rather than a service mismatch.
 * @param bag - Assembled header bag.
 * @param pinned - Configured header name → value map.
 * @returns Names whose discovered value was non-blank before pinning.
 */
function selectOverriddenPins(
  bag: Readonly<Record<string, string>>,
  pinned?: Readonly<Record<string, string>>,
): readonly string[] {
  const names = Object.keys(pinned ?? {});
  return names.filter((name): boolean => {
    const key = findHeaderKey(bag, name);
    return key !== '' && bag[key].trim() !== '';
  });
}

/**
 * Write a pinned header, replacing any blank case-variant already present.
 *
 * <p>Writing `X-Site-Id` while a blank `x-site-id` remains would send BOTH
 * spellings, letting the blank one win at the gateway.
 */
/**
 * Write a pinned header into the bag's existing spelling when one is present.
 *
 * <p>Writing `X-Site-Id` while a blank `x-site-id` remains would send BOTH
 * spellings, letting the blank one win at the gateway. Reusing the discovered
 * key keeps exactly one spelling and preserves the casing the bank itself
 * emitted.
 * @param bag - Assembled header bag (mutated).
 * @param name - Pinned header name.
 * @param value - Pinned header value.
 * @returns True once the pin is written.
 */
function writePin(bag: Record<string, string>, name: string, value: string): boolean {
  const existing = findHeaderKey(bag, name);
  const key = existing === '' ? name : existing;
  bag[key] = value;
  return true;
}

/**
 * Apply configured header values, overriding whatever discovery produced.
 *
 * <p>A pin is an explicit declaration that the correct value is already known,
 * so it WINS; discovery is the fallback for headers nobody pinned. The reverse
 * rule — discovery wins, pin fills gaps — cannot work for an identifier the
 * SPA compiles in rather than serves: the value is never present on any
 * request we can harvest, while sibling services on the SAME host mint their
 * own variants that host scoping cannot tell apart. Under that rule the
 * gateway receives a well-formed identifier belonging to another service and
 * answers 5xx, which reads like an expired session.
 * @param bag - Assembled header bag (mutated).
 * @param pinned - Configured header name → value map, or undefined.
 * @returns The mutated bag.
 */
function applyPinnedHeaders(
  bag: Record<string, string>,
  pinned?: Readonly<Record<string, string>>,
): Record<string, string> {
  const overridden = selectOverriddenPins(bag, pinned);
  for (const [name, value] of Object.entries(pinned ?? {})) writePin(bag, name, value);
  logPinnedOverride(overridden);
  return bag;
}

export { applyPinnedHeaders, hasHeaderName, scopeHeaderDonorPool };
