/**
 * Cookie-echo header sentinel — resolves `@cookie:<name>` header values
 * against a cookie jar at dispatch time.
 *
 * Anti-replay banks (e.g. Hapoalim) require a request header whose value
 * is a cookie the SPA set at login: `X-XSRF-TOKEN` must carry the value
 * of the `XSRF-TOKEN` cookie. A hard-model shape cannot read cookies (its
 * `extraHeaders(ctx)` has no page handle), so it declares the header as
 * the sentinel `@cookie:XSRF-TOKEN`; the transport substitutes the live
 * value here, just before dispatch.
 *
 * - `@cookie:<name>` sends the value through the transport's own `loose`
 *   decode: raw in the browser, `decodeCookieLenient` over a session jar.
 * - `@cookie-strict:<name>` always decodes with `decodeCookieStrict`; a
 *   value that does not decode fails the request, naming the cookie only.
 * - `?<fallback>` after the name (which ends at the first `?`) is sent
 *   verbatim, never decoded, when the cookie is missing or empty.
 * - Otherwise a header naming an absent cookie is dropped — upstream
 *   parity: `X-XSRF-TOKEN` is omitted when `XSRF-TOKEN` is missing.
 *
 * The browser resolves against the page's cookies (`substituteCookieHeaders`);
 * the node session transport through a lookup onto its own jar
 * (`substituteCookieHeadersBy`).
 */

import type { Brand } from '../../Types/Brand.js';
import type { Option } from '../../Types/Option.js';
import { isSome, none, some } from '../../Types/Option.js';
import type { Procedure } from '../../Types/Procedure.js';
import { isOk, succeed } from '../../Types/Procedure.js';
import { decodeCookieStrict } from './CookieValueDecode.js';

/** Header-value prefix marking a cookie-echo sentinel. */
export const COOKIE_HEADER_SENTINEL_PREFIX = '@cookie:';

/** Header-value prefix marking a cookie-echo sentinel that decodes strictly. */
export const STRICT_COOKIE_HEADER_SENTINEL_PREFIX = '@cookie-strict:';

/** Ends a sentinel's cookie name; the text after it is the fallback. */
const FALLBACK_SEPARATOR = '?';

/** Minimal cookie record — the subset the resolver reads. */
export interface INamedCookie {
  readonly name: string;
  readonly value: string;
}

/** Live cookie jar: the name/value records the resolver reads. */
export type CookieJar = readonly INamedCookie[];

/** Reads one cookie's stored value by name, or none when the cookie is absent. */
export type CookieLookup = (name: string) => Option<string>;

/** Turns a stored cookie value into the text a `@cookie:` header sends. */
export type CookieDecode = (raw: string) => string;

/** How one transport reads the cookies its sentinels name. */
export interface ICookieReader {
  /** Reads one cookie's stored value. */
  readonly lookup: CookieLookup;
  /** Decodes a `@cookie:` value; `@cookie-strict:` always decodes strictly. */
  readonly loose: CookieDecode;
}

/** One parsed sentinel. */
interface ICookieSentinel {
  readonly name: string;
  readonly isStrict: boolean;
  readonly fallback: Option<string>;
}

/** The sentinel prefixes and whether each decodes strictly. */
const SENTINEL_KINDS = [
  { prefix: STRICT_COOKIE_HEADER_SENTINEL_PREFIX, isStrict: true },
  { prefix: COOKIE_HEADER_SENTINEL_PREFIX, isStrict: false },
] as const;

/** Predicate result: whether a header map carries a cookie-echo sentinel. */
export type HasCookieSentinel = Brand<boolean, 'HasCookieSentinel'>;

/**
 * Split a sentinel body into its cookie name and optional fallback.
 * @param body - Sentinel text after the prefix.
 * @returns The name (up to the first `?`) and the fallback after it.
 */
function splitFallback(body: string): Pick<ICookieSentinel, 'name' | 'fallback'> {
  const at = body.indexOf(FALLBACK_SEPARATOR);
  if (at < 0) return { name: body, fallback: none() };
  const fallbackText = body.slice(at + 1);
  const fallback = some(fallbackText);
  return { name: body.slice(0, at), fallback };
}

/**
 * Parse a header value as a cookie-echo sentinel.
 * @param value - Raw header value.
 * @returns The sentinel, or none for an ordinary value.
 */
function parseCookieSentinel(value: string): Option<ICookieSentinel> {
  const kind = SENTINEL_KINDS.find((k): boolean => value.startsWith(k.prefix));
  if (kind === undefined) return none();
  const body = value.slice(kind.prefix.length);
  const parts = splitFallback(body);
  return some({ ...parts, isStrict: kind.isStrict });
}

/**
 * Whether one header value is a cookie-echo sentinel of either kind.
 * @param value - Raw header value.
 * @returns True for a `@cookie:` or `@cookie-strict:` value.
 */
function isCookieSentinel(value: string): boolean {
  const sentinel = parseCookieSentinel(value);
  return isSome(sentinel);
}

/**
 * Whether any header value is a cookie-echo sentinel. Lets callers skip
 * the (async) cookie read entirely when no substitution is needed.
 * @param headers - Outgoing header map.
 * @returns True when at least one value is a sentinel.
 */
export function hasCookieSentinel(headers: Readonly<Record<string, string>>): HasCookieSentinel {
  const isPresent = Object.values(headers).some(isCookieSentinel);
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
  const sentinels = entries.filter(([, value]): boolean => isCookieSentinel(value));
  return Object.fromEntries(sentinels);
}

/**
 * Decode a present cookie value the way its sentinel asks.
 * @param sentinel - The parsed sentinel.
 * @param raw - The stored cookie value.
 * @param reader - The transport's cookie reader.
 * @returns The decoded value, or the failure of a strict decode.
 */
function decodeAs(
  sentinel: ICookieSentinel,
  raw: string,
  reader: ICookieReader,
): Procedure<string> {
  if (sentinel.isStrict) return decodeCookieStrict(sentinel.name, raw);
  const loose = reader.loose(raw);
  return succeed(loose);
}

/**
 * The header value a present cookie sends.
 * @param sentinel - The parsed sentinel.
 * @param raw - The stored cookie value.
 * @param reader - The transport's cookie reader.
 * @returns The value to send, or the failure of a strict decode.
 */
function decodeSentinel(
  sentinel: ICookieSentinel,
  raw: string,
  reader: ICookieReader,
): Procedure<Option<string>> {
  const decoded = decodeAs(sentinel, raw, reader);
  if (!isOk(decoded)) return decoded;
  const value = some(decoded.value);
  return succeed(value);
}

/**
 * Resolve one sentinel: the fallback for a missing or empty cookie when one
 * is given, none (drop the header) for a missing cookie, else the decoded
 * value.
 * @param sentinel - The parsed sentinel.
 * @param reader - The transport's cookie reader.
 * @returns The value to send, none to drop the header, or a failure.
 */
function resolveSentinel(
  sentinel: ICookieSentinel,
  reader: ICookieReader,
): Procedure<Option<string>> {
  const raw = reader.lookup(sentinel.name);
  const isEmpty = !isSome(raw) || raw.value === '';
  if (isEmpty && isSome(sentinel.fallback)) return succeed(sentinel.fallback);
  if (!isSome(raw)) return succeed(raw);
  return decodeSentinel(sentinel, raw.value, reader);
}

/**
 * Resolve one header value; a non-sentinel passes through unchanged.
 * @param value - Raw header value (possibly a sentinel).
 * @param reader - The transport's cookie reader.
 * @returns The value to send, none to drop the header, or a failure.
 */
function resolveHeaderValue(value: string, reader: ICookieReader): Procedure<Option<string>> {
  const sentinel = parseCookieSentinel(value);
  const literal = some(value);
  if (!isSome(sentinel)) return succeed(literal);
  return resolveSentinel(sentinel.value, reader);
}

/**
 * Merge one resolved value into a copy of the header map.
 * @param acc - The headers resolved so far.
 * @param entry - The header name and raw value.
 * @param value - The resolved value, or none to drop the header.
 * @returns The extended map, or a success carrying the map unchanged.
 */
function mergedHeader(
  acc: Record<string, string>,
  entry: readonly [string, string],
  value: Option<string>,
): Procedure<Record<string, string>> {
  if (!isSome(value)) return succeed(acc);
  const [key] = entry;
  return succeed({ ...acc, [key]: value.value });
}

/**
 * Add one resolved header to the map built so far.
 * @param acc - The headers resolved so far, or the first failure.
 * @param entry - The header name and raw value.
 * @param reader - The transport's cookie reader.
 * @returns The extended map, the same map for a dropped header, or a failure.
 */
function addResolved(
  acc: Procedure<Record<string, string>>,
  entry: readonly [string, string],
  reader: ICookieReader,
): Procedure<Record<string, string>> {
  if (!isOk(acc)) return acc;
  const resolved = resolveHeaderValue(entry[1], reader);
  if (!isOk(resolved)) return resolved;
  return mergedHeader(acc.value, entry, resolved.value);
}

/**
 * Rebuild a header map with every sentinel resolved through a cookie reader.
 * @param headers - Outgoing header map (may contain sentinels).
 * @param reader - The transport's cookie reader.
 * @returns New header map with sentinels resolved, or the failure that stops
 *   the request before dispatch.
 */
export function substituteCookieHeadersBy(
  headers: Readonly<Record<string, string>>,
  reader: ICookieReader,
): Procedure<Record<string, string>> {
  const start: Procedure<Record<string, string>> = succeed({});
  return Object.entries(headers).reduce(
    (acc, entry): Procedure<Record<string, string>> => addResolved(acc, entry, reader),
    start,
  );
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
 * A `@cookie:` value as stored: the browser sends page cookies raw.
 * @param raw - Stored cookie value.
 * @returns The same value.
 */
function keepRaw(raw: string): string {
  return raw;
}

/**
 * Rebuild a header map with every sentinel resolved against a live jar;
 * `@cookie:` values are sent raw.
 * @param headers - Outgoing header map (may contain sentinels).
 * @param jar - Live cookie jar.
 * @returns New header map with sentinels resolved, or the failure that stops
 *   the request before dispatch.
 */
export function substituteCookieHeaders(
  headers: Readonly<Record<string, string>>,
  jar: CookieJar,
): Procedure<Record<string, string>> {
  const lookup = findInJar.bind(null, jar);
  return substituteCookieHeadersBy(headers, { lookup, loose: keepRaw });
}
