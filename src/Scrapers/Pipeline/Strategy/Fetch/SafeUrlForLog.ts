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
import { ECHO_CUT_MARK, type IEchoCut, requestEchoCutsOf } from './RequestEchoForms.js';

/** Failure text with no request query and no URL beyond origin + path. */
type SafeErrorText = Brand<string, 'SafeErrorText'>;

/** Stand-in for a URL that cannot be parsed, so nothing raw is echoed. */
const UNPARSEABLE_URL = '<unparseable>';

/**
 * An absolute http(s) URL quoted in free text. It ends only at a character a
 * URL serializer never leaves raw — whitespace, `"`, `<`, `>` — so an
 * apostrophe in a credential, a path or a query does not split it. Linear,
 * no nested quantifier.
 */
const QUOTED_URL = /https?:\/\/[^\s"<>]+/gi;

/**
 * V8's `JSON.parse` quote of the body it failed on: at most ten characters
 * either side of the error, `...` where it cut, inner quotes unescaped.
 * Bounded, so linear.
 */
const JSON_PARSE_EXCERPT = /(?:\.\.\.)?"[\s\S]{0,20}"(?:\.\.\.)? is not valid JSON/g;

/** What a parser's quote of the body becomes — the verdict without the body. */
const JSON_PARSE_VERDICT = 'body is not valid JSON';

/** What a secret quoted back becomes. */
const REDACTED_VALUE = '<redacted>';

/** A cut mark as a URL serializer percent-encodes it in a path. */
const ENCODED_CUT_MARK = encodeURIComponent(ECHO_CUT_MARK);

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
 * The request URL quoted whole, reduced to what {@link safeUrlForLog} shows.
 * An empty URL is no echo: cutting '' would insert the replacement everywhere.
 * @param requestUrl - URL of the request that failed.
 * @returns The cut, or none for an empty URL.
 */
function wholeUrlCutsOf(requestUrl: string): readonly IEchoCut[] {
  if (requestUrl.length === 0) return [];
  return [{ form: requestUrl, replacement: safeUrlForLog(requestUrl) }];
}

/**
 * Cut every echo of the request from failure text: the URL whole, then each
 * form of each secret it carries, longest first. A replacer function keeps
 * a `$` in a URL literal, where a replacement string would read it as a
 * pattern.
 * @param text - Failure text.
 * @param requestUrl - URL of the request that failed.
 * @returns The text with every request echo cut.
 */
function withoutRequestEchoes(text: string, requestUrl: string): string {
  const cuts = [...wholeUrlCutsOf(requestUrl), ...requestEchoCutsOf(requestUrl)];
  return cuts.reduce(
    (acc, cut): string => acc.replaceAll(cut.form, (): string => cut.replacement),
    text,
  );
}

/**
 * Show every cut mark as {@link REDACTED_VALUE}, raw or as a URL serializer
 * percent-encodes it inside a shortened URL's path.
 * @param text - Text whose secrets are marked.
 * @returns The text with each mark redacted.
 */
function withMarksRedacted(text: string): string {
  const withoutEncoded = text.replaceAll(ENCODED_CUT_MARK, REDACTED_VALUE);
  return withoutEncoded.replaceAll(ECHO_CUT_MARK, REDACTED_VALUE);
}

/**
 * Sanitize failure text a transport did not write itself: an exception
 * message, a parse error or a response-body snippet. Runtimes quote the
 * request in their own words — undici echoes an unparseable or
 * credential-bearing URL in full, V8 quotes the body it failed to parse,
 * servers echo a path or a single parameter — so the parser's body quote is
 * dropped, every echo of the request is cut, and only then is any absolute
 * URL reduced to origin + masked path: a URL match that ends inside a secret
 * would split it before the secret is known.
 * @param text - Text from outside the transport.
 * @param requestUrl - URL of the request that failed.
 * @returns The text with no request query and no full URL.
 */
function safeErrorText(text: string, requestUrl: string): SafeErrorText {
  const withoutBody = text.replaceAll(JSON_PARSE_EXCERPT, JSON_PARSE_VERDICT);
  const withoutRequest = withoutRequestEchoes(withoutBody, requestUrl);
  const withSafeUrls = withoutRequest.replaceAll(QUOTED_URL, (url): string => safeUrlForLog(url));
  return withMarksRedacted(withSafeUrls) as SafeErrorText;
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
