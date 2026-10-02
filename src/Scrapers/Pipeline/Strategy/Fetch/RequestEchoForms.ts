/**
 * What a failed request can be quoted back as. A runtime or a server may
 * echo any secret the request carried — its query, one query value, a
 * credential — in any encoding, and an account number from its path, alone
 * or inside a URL. {@link requestEchoCutsOf} lists each such form with what
 * replaces it, so failure text is cut before any URL in it is shortened: a
 * URL match that ends inside a secret would otherwise split it, leaving the
 * rest of it in place.
 */

import { redactUrlFull } from '../../Types/PiiRedactor.js';

/**
 * What a cut secret becomes until the URLs around it are shortened. A
 * private-use character ends no URL match, so a URL quoting a cut secret is
 * still matched whole.
 */
const ECHO_CUT_MARK = '\uE000';

/** Where a URL's query string or fragment begins. */
const QUERY_START = /[?#]/;

/** Shortest query value treated as a secret; flags and locales stay readable. */
const MIN_SECRET_VALUE_LEN = 8;

/** Shortest credential treated as a secret: every credential is one. */
const MIN_CREDENTIAL_LEN = 0;

/** Shortest form of a secret still cut; shorter runs are too common. */
const MIN_ECHO_FORM_LEN = 3;

/** Separators inside a formatted id path segment, such as a card number. */
const PATH_ID_SEPARATOR = /-/g;

/** One form a request secret may be echoed in, and what replaces it. */
interface IEchoCut {
  readonly form: string;
  readonly replacement: string;
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
 * Percent-decode a URL value, keeping the raw form when it is malformed.
 * @param raw - The value as it appears in the URL.
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
 * Every way a server may echo one value — as sent, decoded, or re-encoded
 * with `+` or `%20` for a space. Secret-ness is decided once for the value,
 * so one secret-sized on the wire is cut in its short decoded form too.
 * @param raw - The value as it appears in the URL.
 * @param minSecretLen - Shortest value that counts as a secret.
 * @returns The value's echo forms, or none for a value too short to be one.
 */
function echoFormsOf(raw: string, minSecretLen: number): readonly string[] {
  const decoded = decodedOrRaw(raw);
  const formEncoded = new URLSearchParams({ v: decoded }).toString().slice(2);
  const percentEncoded = formEncoded.replaceAll('+', '%20');
  const forms = [raw, decoded, formEncoded, percentEncoded];
  const isSecret = forms.some((form): boolean => form.length >= minSecretLen);
  if (!isSecret) return [];
  return forms.filter((form): boolean => form.length >= MIN_ECHO_FORM_LEN);
}

/**
 * Echo forms of one query value, when it is secret-sized.
 * @param raw - The value as it appears on the wire.
 * @returns Its echo forms.
 */
function queryValueForms(raw: string): readonly string[] {
  return echoFormsOf(raw, MIN_SECRET_VALUE_LEN);
}

/**
 * Echo forms of one credential, whatever its length.
 * @param raw - The credential as the parsed URL holds it.
 * @returns Its echo forms.
 */
function credentialForms(raw: string): readonly string[] {
  return echoFormsOf(raw, MIN_CREDENTIAL_LEN);
}

/**
 * A cut that marks where a secret form stood.
 * @param form - One echo form of a secret.
 * @returns The cut replacing it with {@link ECHO_CUT_MARK}.
 */
function markCutOf(form: string): IEchoCut {
  return { form, replacement: ECHO_CUT_MARK };
}

/**
 * Cuts for the request's query: the raw tail dropped whole, each
 * secret-sized value marked in every form. A bare `?` or `#` is no query.
 * @param requestUrl - URL of the request, parseable or not.
 * @returns The query's cuts.
 */
function queryCutsOf(requestUrl: string): readonly IEchoCut[] {
  const tail = rawQueryTail(requestUrl);
  if (tail.length <= 1) return [];
  const [query] = tail.split('#');
  const forms = query.slice(1).split('&').map(pairValue).flatMap(queryValueForms);
  return [{ form: tail, replacement: '' }, ...forms.map(markCutOf)];
}

/**
 * Cuts for the request's user name and password, each marked in every form.
 * @param parsed - The parsed request URL.
 * @returns The credentials' cuts.
 */
function credentialCutsOf(parsed: URL): readonly IEchoCut[] {
  const forms = [parsed.username, parsed.password].flatMap(credentialForms);
  return forms.map(markCutOf);
}

/**
 * Cuts for one path segment: none when it is shown as is, else its forms —
 * with and without separators — each replaced by its mask.
 * @param segment - A raw path segment.
 * @param masked - The same segment as the masked URL shows it.
 * @returns The segment's cuts.
 */
function segmentCutsOf(segment: string, masked: string): readonly IEchoCut[] {
  if (segment === masked) return [];
  const bare = segment.replaceAll(PATH_ID_SEPARATOR, '');
  const forms = new Set([segment, bare]);
  return [...forms].map((form): IEchoCut => ({ form, replacement: masked }));
}

/**
 * Cuts that mask each id-shaped path segment as {@link redactUrlFull} masks
 * it in the request's own URL, so an echo of the path, or of the number
 * alone, shows no more than that URL does.
 * @param parsed - The parsed request URL.
 * @returns The path's cuts.
 */
function pathIdCutsOf(parsed: URL): readonly IEchoCut[] {
  const maskedUrl = redactUrlFull(parsed.href);
  const masked = new URL(maskedUrl).pathname.split('/');
  const segments = parsed.pathname.split('/');
  return segments.flatMap((segment, index): readonly IEchoCut[] =>
    segmentCutsOf(segment, masked[index] ?? segment),
  );
}

/**
 * Cuts only a parseable request URL yields: credentials and path ids.
 * @param requestUrl - URL of the request.
 * @returns The cuts, or none when the URL does not parse.
 */
function parsedUrlCutsOf(requestUrl: string): readonly IEchoCut[] {
  try {
    const parsed = new URL(requestUrl);
    return [...credentialCutsOf(parsed), ...pathIdCutsOf(parsed)];
  } catch {
    return [];
  }
}

/**
 * Every form in which failure text may quote a secret of the request, with
 * what replaces it — longest first, so no shorter form splits a longer one
 * before it is cut.
 * @param requestUrl - URL of the request that failed.
 * @returns The cuts, in the order to apply them.
 */
function requestEchoCutsOf(requestUrl: string): readonly IEchoCut[] {
  const cuts = [...queryCutsOf(requestUrl), ...parsedUrlCutsOf(requestUrl)];
  return cuts.sort((a, b): number => b.form.length - a.form.length);
}

export type { IEchoCut };
export { ECHO_CUT_MARK, requestEchoCutsOf };
