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
 */

import type { Brand } from '../../Types/Brand.js';

/** Header-value prefix marking a cookie-echo sentinel. */
export const COOKIE_HEADER_SENTINEL_PREFIX = '@cookie:';

/** Minimal cookie record — the subset the resolver reads. */
export interface INamedCookie {
  readonly name: string;
  readonly value: string;
}

/** Live cookie jar (subset of Playwright `BrowserContext.cookies()`). */
export type CookieJar = readonly INamedCookie[];

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
 * Resolve one header value: pass through non-sentinels unchanged;
 * substitute the named cookie's value; return `false` to drop the header
 * when the cookie is absent.
 * @param value - Raw header value (possibly a sentinel).
 * @param jar - Live cookie jar.
 * @returns Resolved value, or `false` to signal "drop this header".
 */
function resolveHeaderValue(value: string, jar: CookieJar): string | false {
  if (!value.startsWith(COOKIE_HEADER_SENTINEL_PREFIX)) return value;
  const name = value.slice(COOKIE_HEADER_SENTINEL_PREFIX.length);
  const hit = jar.find((c): boolean => c.name === name);
  return hit ? hit.value : false;
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
  const pairs = Object.keys(headers).map((key): readonly [string, string | false] => [
    key,
    resolveHeaderValue(headers[key], jar),
  ]);
  const kept = pairs.filter((p): p is readonly [string, string] => p[1] !== false);
  return Object.fromEntries(kept);
}
