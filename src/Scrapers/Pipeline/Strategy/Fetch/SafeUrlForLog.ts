/**
 * The one URL sanitizer every fetch transport uses for log lines and error
 * messages. Query strings carry session ids, tokens, device ids and PII, so
 * the query is dropped outright; account-bearing path segments (e.g. a bank
 * that names an account in the path, like Discount's Titan reads) are masked
 * to a last-4 hint by {@link redactUrlFull}. A caller that knows an account id
 * hands it in as an explicit value too, so an id whose shape carries no digit
 * run (a valid Titan id like `ACCT_1-a`) is masked as well. What leaves a
 * transport is thus origin plus a route path with any account id redacted —
 * including when an engine exception quotes the request URL inside its own
 * message.
 */

import type { SafeUrlForLog } from '../../Types/Brand.js';
import { mintSafeUrlForLog } from '../../Types/Brand.js';
import { redactAccount, redactUrlFull } from '../../Types/PiiRedactor.js';

/** Stand-in for a URL that cannot be parsed, so nothing raw is echoed. */
const UNPARSEABLE_URL = '<unparseable>';

/** One raw form of a URL that free text may quote, and its replacement. */
interface IUrlForm {
  readonly raw: string;
  readonly safe: string;
}

/**
 * Replace every explicit sensitive value with its last-4 account hint.
 * An account id is a bank-supplied `[\w-]{1,128}` string, so it need not
 * contain a digit run the path heuristic can catch; when the caller knows
 * the id it is removed literally, wherever it sits in the sanitized URL.
 * @param url - Sanitized URL (origin + path).
 * @param values - Sensitive values the caller explicitly identified.
 * @returns The URL with every non-empty value masked.
 */
function scrubKnownValues(url: string, values?: readonly string[]): string {
  if (values === undefined) return url;
  return values.reduce((acc, value): string => {
    if (value.length === 0) return acc;
    const redacted = redactAccount(value);
    const hint = String(redacted);
    return acc.split(value).join(hint);
  }, url);
}

/**
 * Strip query string, fragment and credentials from a URL and mask any
 * account-bearing path segment.
 * @param url - Full URL to sanitize.
 * @param redactUrlValues - Explicit account ids to mask wherever they appear.
 * @returns Origin + path with account ids masked, as a branded SafeUrlForLog.
 */
function safeUrlForLog(url: string, redactUrlValues?: readonly string[]): SafeUrlForLog {
  try {
    const parsed = new URL(url);
    const originPath = `${parsed.origin}${parsed.pathname}`;
    const masked = redactUrlFull(originPath);
    const scrubbed = scrubKnownValues(masked, redactUrlValues);
    return mintSafeUrlForLog(scrubbed);
  } catch {
    return mintSafeUrlForLog(UNPARSEABLE_URL);
  }
}

/**
 * Every raw form of a URL an engine error may quote: as dispatched, as
 * normalised by the URL parser, and its bare query string.
 * @param url - Full URL as dispatched.
 * @param redactUrlValues - Explicit account ids to mask in the replacement.
 * @returns Non-empty forms; whole URLs come before the bare query.
 */
function rawUrlForms(url: string, redactUrlValues?: readonly string[]): readonly IUrlForm[] {
  const safe = safeUrlForLog(url, redactUrlValues);
  const forms: IUrlForm[] = [{ raw: url, safe }];
  if (URL.canParse(url)) {
    const { href, search } = new URL(url);
    forms.push({ raw: href, safe }, { raw: search, safe: '' });
  }
  return forms.filter((form): boolean => form.raw.length > 0);
}

/**
 * Replace every raw form of a URL inside free text with origin + path.
 * @param text - Free text, e.g. a caught exception message.
 * @param url - The URL the text may quote.
 * @param redactUrlValues - Explicit account ids to mask in the replacement.
 * @returns The text with no quoted query string left.
 */
function scrubUrlFromText(text: string, url: string, redactUrlValues?: readonly string[]): string {
  const forms = rawUrlForms(url, redactUrlValues);
  return forms.reduce((acc, form): string => acc.split(form.raw).join(form.safe), text);
}

export default safeUrlForLog;
export { safeUrlForLog, scrubUrlFromText };
