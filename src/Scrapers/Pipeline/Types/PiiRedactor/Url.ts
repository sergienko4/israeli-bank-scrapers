/**
 * Url — URL query / path redactors.
 *
 * `redactUrl` masks values of known-PII query keys; `redactUrlFull`
 * additionally walks the path and applies {@link redactAccount}'s
 * last-4 hint to any `/`-delimited segment that looks like an account
 * or card identifier (≥ 4 digit run).
 *
 * Composes existing strategies; no new redaction logic, just composition.
 */

import { redactAccount } from './Account.js';
import { type CensorFn, createCensorFn } from './Facade.js';
import {
  isPiiRedactionDisabled,
  type PiiCategory,
  type PiiClassifierBool,
  type PiiHintString,
} from './Types.js';

export const URL_CATEGORY: PiiCategory = 'url';

/** URL query keys whose values are PII (redact value, keep key). */
export const PII_QUERY_KEYS: ReadonlySet<string> = new Set([
  'accountId',
  'accountNumber',
  'cardId',
  'cardNumber',
  'cardUniqueId',
  'token',
  'authorization',
  'phoneNumber',
  'firstName',
  'lastName',
  'email',
  'customerId',
  'userId',
]);

/** Path segments shorter than this are safe to leave intact. */
const PATH_SEGMENT_DIGIT_THRESHOLD = 4;

/** Result of attempting to parse a string into a URL. */
interface IUrlParseResult {
  readonly ok: boolean;
  readonly url: URL;
}

/** Sentinel URL used when parsing fails (callers MUST check `ok`). */
const URL_PARSE_SENTINEL: URL = Reflect.construct(URL, ['https://invalid.local/']);

/**
 * Try to construct a URL via Reflect.construct without throwing.
 * @param input - Candidate URL string.
 * @returns Parse result with the URL on success.
 */
function tryParseUrl(input: string): IUrlParseResult {
  try {
    const url: URL = Reflect.construct(URL, [input]);
    return { ok: true, url };
  } catch {
    return { ok: false, url: URL_PARSE_SENTINEL };
  }
}

/**
 * Redact a single PII query key on a parsed URL in place.
 * @param parsed - Parsed URL (mutated).
 * @param key - PII query key to redact.
 * @param censor - Active censor function.
 * @returns True after the key has been processed.
 */
function redactQueryKey(parsed: URL, key: string, censor: CensorFn): true {
  const value = parsed.searchParams.get(key) ?? '';
  const censored = censor(value, [key]);
  parsed.searchParams.set(key, censored);
  return true;
}

/**
 * List the URL's PII-classified query keys without mutating the URL.
 * Extracted from `redactUrl` to keep that function under the 10-line
 * function cap (CLAUDE.md "Max 10 lines per method").
 * @param parsed - Parsed URL.
 * @returns Subset of query keys matching {@link PII_QUERY_KEYS}.
 */
function listPiiQueryKeys(parsed: URL): readonly string[] {
  const allKeys = [...parsed.searchParams.keys()];
  return allKeys.filter((k): PiiClassifierBool => PII_QUERY_KEYS.has(k) as PiiClassifierBool);
}

/**
 * Redact a URL string. Replaces known PII query-key values; leaves
 * host, scheme, and path untouched. Returns input unchanged when
 * unparseable.
 * @param url - Raw URL string.
 * @returns Redacted URL.
 */
function redactUrl(url: string): PiiHintString {
  if (isPiiRedactionDisabled) return url as PiiHintString;
  if (url.length === 0) return '' as PiiHintString;
  const parse = tryParseUrl(url);
  if (!parse.ok) return url as PiiHintString;
  const censor = createCensorFn();
  const piiKeys = listPiiQueryKeys(parse.url);
  for (const key of piiKeys) redactQueryKey(parse.url, key, censor);
  return parse.url.toString() as PiiHintString;
}

/** Separator characters allowed inside formatted ID path segments. */
const PATH_ID_SEPARATOR_RE = /-/g;

/**
 * Predicate for path segments that look like account / card / phone
 * IDs — runs of ≥ 4 digits, optionally with embedded `-` separators
 * (e.g., `4111-1111-1111-1111`). The separators are stripped before
 * the digit-run check so card-formatted identifiers in URL paths are
 * reliably masked. WHATWG URL parsing percent-encodes spaces, so raw
 * spaces never appear here.
 * @param segment - Single path segment.
 * @returns True when the segment is a candidate for last-4 hinting.
 */
function isLikelyIdSegment(segment: string): boolean {
  const normalized = segment.replaceAll(PATH_ID_SEPARATOR_RE, '');
  if (normalized.length < PATH_SEGMENT_DIGIT_THRESHOLD) return false;
  return /^\d+$/.test(normalized);
}

/**
 * Mask a single URL path segment when it looks like an identifier.
 * Strips `-` separators before handing the bare digit run to
 * `redactAccount` so the resulting hint preserves the `***LAST4`
 * shape even for card-formatted identifiers.
 * @param seg - Single path segment.
 * @returns The `***XXXX` hint when the segment looks like an ID,
 *   otherwise the input segment unchanged.
 */
function maskPathSegmentIfId(seg: string): string {
  if (!isLikelyIdSegment(seg)) return seg;
  const normalized = seg.replaceAll(PATH_ID_SEPARATOR_RE, '');
  return redactAccount(normalized);
}

/**
 * Redact a URL fully — `redactUrl` (query) plus per-segment account
 * masking (path).
 * @param url - Raw URL string.
 * @returns Redacted URL with both query and path-segment PII masked.
 */
function redactUrlFull(url: string): PiiHintString {
  if (isPiiRedactionDisabled) return url as PiiHintString;
  const queryRedacted = redactUrl(url);
  const parse = tryParseUrl(queryRedacted);
  if (!parse.ok) return queryRedacted;
  const segments = parse.url.pathname.split('/');
  const masked = segments.map(maskPathSegmentIfId);
  parse.url.pathname = masked.join('/');
  return parse.url.toString() as PiiHintString;
}

export { redactUrl, redactUrlFull };
