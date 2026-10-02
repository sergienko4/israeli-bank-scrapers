/**
 * The one URL sanitizer every fetch transport uses for log lines and error
 * messages. Query strings carry session ids, tokens, device ids and PII, and a
 * path can carry an account or card number, so only the origin and the path —
 * id-shaped segments masked to their last four digits — ever leave a
 * transport, whether the transport names the URL itself or passes on text
 * that quotes it.
 */

import type { Brand, SafeUrlForLog } from '../../Types/Brand.js';
import { mintSafeUrlForLog } from '../../Types/Brand.js';
import { caughtMessageOf } from '../../Types/ErrorUtils.js';
import { redactUrlFull } from '../../Types/PiiRedactor.js';

/** Failure text with no request query and no URL beyond origin + path. */
type SafeErrorText = Brand<string, 'SafeErrorText'>;

/** Stand-in for a URL that cannot be parsed, so nothing raw is echoed. */
const UNPARSEABLE_URL = '<unparseable>';

/** An absolute http(s) URL quoted in free text; linear, no nested quantifier. */
const QUOTED_URL = /https?:\/\/[^\s"'<>]+/gi;

/** Where a URL's query string or fragment begins. */
const QUERY_START = /[?#]/;

/**
 * V8's `JSON.parse` quote of the body it failed on: at most ten characters
 * either side of the error, `...` where it cut, inner quotes unescaped.
 * Bounded, so linear.
 */
const JSON_PARSE_EXCERPT = /(?:\.\.\.)?"[\s\S]{0,20}"(?:\.\.\.)? is not valid JSON/g;

/** What a parser's quote of the body becomes — the verdict without the body. */
const JSON_PARSE_VERDICT = 'body is not valid JSON';

/** Shortest query value treated as a secret; flags and locales stay readable. */
const MIN_SECRET_VALUE_LEN = 8;

/** Shortest form of a secret value still cut; shorter runs are too common. */
const MIN_ECHO_FORM_LEN = 3;

/** What a query value quoted back on its own becomes. */
const REDACTED_VALUE = '<redacted>';

/** How much of an error response body a failure message carries. */
const ERROR_BODY_SNIPPET_LEN = 120;

/**
 * Strip query string, fragment and credentials from a URL, and mask the
 * id-shaped segments of its path.
 * @param url - Full URL to sanitize.
 * @returns Origin + masked path only as a branded SafeUrlForLog.
 */
function safeUrlForLog(url: string): SafeUrlForLog {
  try {
    const parsed = new URL(url);
    const maskedPath = redactUrlFull(`${parsed.origin}${parsed.pathname}`);
    return mintSafeUrlForLog(maskedPath);
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
 * Every way a server may echo one query value — as sent, decoded, or
 * re-encoded with `+` or `%20` for a space. Secret-ness is decided once for
 * the value, so one secret-sized on the wire is cut in its short decoded form
 * too.
 * @param raw - Query value as it appears on the wire.
 * @returns The value's echo forms, or none for a short flag.
 */
function echoFormsOf(raw: string): readonly string[] {
  const decoded = decodedOrRaw(raw);
  const formEncoded = new URLSearchParams({ v: decoded }).toString().slice(2);
  const percentEncoded = formEncoded.replaceAll('+', '%20');
  const forms = [raw, decoded, formEncoded, percentEncoded];
  const isSecret = forms.some((form): boolean => form.length >= MIN_SECRET_VALUE_LEN);
  if (!isSecret) return [];
  return forms.filter((form): boolean => form.length >= MIN_ECHO_FORM_LEN);
}

/**
 * Every echo form of every secret-sized query value, longest first so no
 * shorter form splits a longer one before it is cut.
 * @param tail - The request's raw query tail.
 * @returns Distinct echo forms.
 */
function secretEchoForms(tail: string): readonly string[] {
  const [query] = tail.split('#');
  const pairs = query.slice(1).split('&');
  const forms = pairs.map(pairValue).flatMap(echoFormsOf);
  const distinct = new Set(forms);
  return [...distinct].sort((a, b): number => b.length - a.length);
}

/**
 * Cut a request's query wherever failure text quotes it back — whole, or one
 * value at a time as a server error body tends to. A bare `?` or `#` is no
 * query, so it is never cut.
 * @param text - Failure text.
 * @param tail - The request's raw query tail.
 * @returns The text with no query and no secret-sized query value.
 */
function withoutQueryEchoes(text: string, tail: string): string {
  if (tail.length <= 1) return text;
  const withoutTail = text.replaceAll(tail, '');
  const forms = secretEchoForms(tail);
  return forms.reduce((acc, form): string => acc.replaceAll(form, REDACTED_VALUE), withoutTail);
}

/**
 * Sanitize failure text a transport did not write itself: an exception
 * message, a parse error or a response-body snippet. Runtimes quote the
 * request in their own words — undici echoes an unparseable or
 * credential-bearing URL in full, V8 quotes the body it failed to parse,
 * servers echo a path or a single parameter — so the parser's body quote is
 * dropped, any absolute URL is reduced to origin + masked path, then the
 * request's query is cut wherever it still appears.
 * @param text - Text from outside the transport.
 * @param requestUrl - URL of the request that failed.
 * @returns The text with no request query and no full URL.
 */
function safeErrorText(text: string, requestUrl: string): SafeErrorText {
  const withoutBody = text.replaceAll(JSON_PARSE_EXCERPT, JSON_PARSE_VERDICT);
  const withSafeUrls = withoutBody.replaceAll(QUOTED_URL, (url): string => safeUrlForLog(url));
  const tail = rawQueryTail(requestUrl);
  return withoutQueryEchoes(withSafeUrls, tail) as SafeErrorText;
}

/**
 * Sanitize whatever a transport caught, as {@link safeErrorText} does.
 * @param error - The caught value.
 * @param requestUrl - URL of the request that failed.
 * @returns The caught message with no request query and no full URL.
 */
function safeFailureText(error: unknown, requestUrl: string): SafeErrorText {
  const message = caughtMessageOf(error);
  return safeErrorText(message, requestUrl);
}

/**
 * Sanitize the head of an error body for a failure message. The whole body is
 * cleaned before it is cut: a cut made first can split a secret so no rule
 * knows the half left behind, and cleaning both lengthens and shortens text,
 * so no margin counted around an earlier cut stays sound. It runs on failure
 * paths only, over a body already in memory.
 * @param text - The response body.
 * @param requestUrl - URL of the request that failed.
 * @returns At most {@link ERROR_BODY_SNIPPET_LEN} characters of clean body.
 */
function safeErrorSnippet(text: string, requestUrl: string): SafeErrorText {
  const cleaned = safeErrorText(text, requestUrl);
  return cleaned.slice(0, ERROR_BODY_SNIPPET_LEN) as SafeErrorText;
}

export default safeUrlForLog;
export type { SafeErrorText };
export { ERROR_BODY_SNIPPET_LEN, safeErrorSnippet, safeErrorText, safeFailureText, safeUrlForLog };
