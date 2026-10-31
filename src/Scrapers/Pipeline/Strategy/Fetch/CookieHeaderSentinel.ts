/**
 * Cookie-echo header sentinel — resolves `@cookie:<name>` header values
 * against the live page cookie jar at dispatch time.
 *
 * Anti-replay banks (e.g. Hapoalim) require a request header whose value
 * is a cookie the SPA set at login: `X-XSRF-TOKEN` must carry the value
 * of the `XSRF-TOKEN` cookie. A hard-model shape cannot read cookies (its
 * `extraHeaders(ctx)` has no page handle), so it declares the header as
 * the sentinel `@cookie:XSRF-TOKEN`; the browser fetch strategy
 * substitutes the live value here, just before dispatch.
 *
 * A header naming an absent cookie is dropped — upstream parity: the
 * `X-XSRF-TOKEN` header is omitted when the `XSRF-TOKEN` cookie is missing.
 * The node session transport resolves the same sentinel through a lookup
 * onto its own jar (`substituteCookieHeadersBy`).
 */

import type { Brand } from '../../Types/Brand.js';
import type { Option } from '../../Types/Option.js';
import { isSome, none, some } from '../../Types/Option.js';

/** Header-value prefix marking a cookie-echo sentinel. */
export const COOKIE_HEADER_SENTINEL_PREFIX = '@cookie:';

/** Minimal cookie record — the subset the resolver reads. */
export interface INamedCookie {
  readonly name: string;
  readonly value: string;
}

/** Live cookie jar (subset of Playwright `BrowserContext.cookies()`). */
export type CookieJar = readonly INamedCookie[];

/** Reads one cookie's value by name, or none when the cookie is absent. */
export type CookieLookup = (name: string) => Option<string>;

/** Predicate result: whether a header map carries a cookie-echo sentinel. */
export type HasCookieSentinel = Brand<boolean, 'HasCookieSentinel'>;

/**
 * Whether any header value is a cookie-echo sentinel. Lets callers skip
 * the (async) cookie read entirely when no substitution is needed.
 * @param headers - Outgoing header map.
 * @returns True when at least one value starts with the sentinel prefix.
 */
export function hasCookieSentinel(headers: Readonly<Record<string, string>>): HasCookieSentinel {
  const isPresent = Object.values(headers).some((v): boolean =>
    v.startsWith(COOKIE_HEADER_SENTINEL_PREFIX),
  );
  return isPresent as HasCookieSentinel;
}

/**
 * The headers whose value is a cookie-echo sentinel.
 * @param headers - Outgoing header map.
 * @returns The sentinel headers only.
 */
export function cookieSentinelHeaders(
  headers: Readonly<Record<string, string>>,
): Record<string, string> {
  const entries = Object.entries(headers);
  const sentinels = entries.filter(([, value]): boolean =>
    value.startsWith(COOKIE_HEADER_SENTINEL_PREFIX),
  );
  return Object.fromEntries(sentinels);
}

/**
 * Resolve one header value: pass through non-sentinels unchanged;
 * substitute the named cookie's value; return `false` to drop the header
 * when the cookie is absent.
 * @param value - Raw header value (possibly a sentinel).
 * @param lookup - Reads one cookie by name.
 * @returns Resolved value, or `false` to signal "drop this header".
 */
function resolveHeaderValue(value: string, lookup: CookieLookup): string | false {
  if (!value.startsWith(COOKIE_HEADER_SENTINEL_PREFIX)) return value;
  const name = value.slice(COOKIE_HEADER_SENTINEL_PREFIX.length);
  const hit = lookup(name);
  return isSome(hit) ? hit.value : false;
}

/**
 * Rebuild a header map with every `@cookie:<name>` sentinel resolved
 * through a cookie lookup; headers whose cookie is absent are dropped.
 * @param headers - Outgoing header map (may contain sentinels).
 * @param lookup - Reads one cookie by name.
 * @returns New header map with sentinels resolved.
 */
export function substituteCookieHeadersBy(
  headers: Readonly<Record<string, string>>,
  lookup: CookieLookup,
): Record<string, string> {
  const pairs = Object.keys(headers).map((key): readonly [string, string | false] => [
    key,
    resolveHeaderValue(headers[key], lookup),
  ]);
  const kept = pairs.filter((p): p is readonly [string, string] => p[1] !== false);
  return Object.fromEntries(kept);
}

/**
 * The first cookie of a live jar with this name.
 * @param jar - Live cookie jar.
 * @param name - Cookie name.
 * @returns Its value, or none when the jar has no such cookie.
 */
function findInJar(jar: CookieJar, name: string): Option<string> {
  const hit = jar.find((c): boolean => c.name === name);
  if (hit === undefined) return none();
  return some(hit.value);
}

/**
 * Rebuild a header map with every `@cookie:<name>` sentinel resolved
 * against the jar; headers whose cookie is absent are dropped.
 * @param headers - Outgoing header map (may contain sentinels).
 * @param jar - Live cookie jar.
 * @returns New header map with sentinels resolved.
 */
export function substituteCookieHeaders(
  headers: Readonly<Record<string, string>>,
  jar: CookieJar,
): Record<string, string> {
  const lookup = findInJar.bind(null, jar);
  return substituteCookieHeadersBy(headers, lookup);
}
