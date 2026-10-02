/**
 * The one URL sanitizer every fetch transport uses for log lines and error
 * messages. Query strings carry session ids, tokens, device ids and PII, so
 * only the origin and path ever leave a transport — whether the transport
 * names the URL itself or passes on text that quotes it.
 */

import type { Brand, SafeUrlForLog } from '../../Types/Brand.js';
import { mintSafeUrlForLog } from '../../Types/Brand.js';

/** Failure text with no request query and no URL beyond origin + path. */
type SafeErrorText = Brand<string, 'SafeErrorText'>;

/** Stand-in for a URL that cannot be parsed, so nothing raw is echoed. */
const UNPARSEABLE_URL = '<unparseable>';

/** An absolute http(s) URL quoted in free text; linear, no nested quantifier. */
const QUOTED_URL = /https?:\/\/[^\s"'<>]+/gi;

/** Where a URL's query string or fragment begins. */
const QUERY_START = /[?#]/;

/** Shortest query value treated as a secret; flags and locales stay readable. */
const MIN_SECRET_VALUE_LEN = 8;

/** What a query value quoted back on its own becomes. */
const REDACTED_VALUE = '<redacted>';

/**
 * Strip query string, fragment and credentials from a URL.
 * @param url - Full URL to sanitize.
 * @returns Origin + path only as a branded SafeUrlForLog.
 */
function safeUrlForLog(url: string): SafeUrlForLog {
  try {
    const parsed = new URL(url);
    return mintSafeUrlForLog(`${parsed.origin}${parsed.pathname}`);
  } catch {
    return mintSafeUrlForLog(UNPARSEABLE_URL);
  }
}

/**
 * The raw query string and fragment of a request URL, as the caller wrote it.
 * @param url - Request URL, parseable or not.
 * @returns Everything from the first `?` or `#`, or '' when there is none.
 */
function rawQueryTail(url: string): string {
  const start = url.search(QUERY_START);
  if (start < 0) return '';
  return url.slice(start);
}

/**
 * The value half of one `key=value` query pair.
 * @param pair - One `&`-separated query segment.
 * @returns Everything after the first `=`, or '' for a bare key.
 */
function pairValue(pair: string): string {
  const separator = pair.indexOf('=');
  if (separator < 0) return '';
  return pair.slice(separator + 1);
}

/**
 * Percent-decode a query value, keeping the raw form when it is malformed.
 * @param raw - Query value as it appears on the wire.
 * @returns The decoded value, or the raw one.
 */
function decodedOrRaw(raw: string): string {
  const spaced = raw.replaceAll('+', ' ');
  try {
    return decodeURIComponent(spaced);
  } catch {
    return raw;
  }
}

/**
 * Every query value long enough to be a secret, in wire and decoded form,
 * longest first so no shorter value splits a longer one before it is cut.
 * @param tail - The request's raw query tail.
 * @returns Distinct secret-sized values.
 */
function secretQueryValues(tail: string): readonly string[] {
  const [query] = tail.split('#');
  const pairs = query.slice(1).split('&');
  const raws = pairs.map(pairValue);
  const forms = raws.flatMap((raw): string[] => [raw, decodedOrRaw(raw)]);
  const secretForms = forms.filter((form): boolean => form.length >= MIN_SECRET_VALUE_LEN);
  const secrets = new Set(secretForms);
  return [...secrets].sort((a, b): number => b.length - a.length);
}

/**
 * Cut a request's query wherever failure text quotes it back — whole, or one
 * value at a time as a server error body tends to.
 * @param text - Failure text.
 * @param tail - The request's raw query tail.
 * @returns The text with no query and no secret-sized query value.
 */
function withoutQueryEchoes(text: string, tail: string): string {
  if (tail === '') return text;
  const withoutTail = text.replaceAll(tail, '');
  const secrets = secretQueryValues(tail);
  return secrets.reduce(
    (acc, secret): string => acc.replaceAll(secret, REDACTED_VALUE),
    withoutTail,
  );
}

/**
 * Sanitize failure text a transport did not write itself: an exception
 * message, a parse error or a response-body snippet. Runtimes quote the
 * request in their own words — undici echoes an unparseable URL verbatim and
 * masks only the credentials of one that carries them; servers echo a path or
 * a single parameter — so any absolute URL is first reduced to origin + path,
 * then the request's query is cut wherever it still appears.
 * @param text - Text from outside the transport.
 * @param requestUrl - URL of the request that failed.
 * @returns The text with no request query and no full URL.
 */
function safeErrorText(text: string, requestUrl: string): SafeErrorText {
  const withSafeUrls = text.replaceAll(QUOTED_URL, (quoted): string => safeUrlForLog(quoted));
  const tail = rawQueryTail(requestUrl);
  return withoutQueryEchoes(withSafeUrls, tail) as SafeErrorText;
}

export default safeUrlForLog;
export type { SafeErrorText };
export { safeErrorText, safeUrlForLog };
