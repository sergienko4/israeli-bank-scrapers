/**
 * The one URL sanitizer every fetch transport uses for log lines and error
 * messages. Query strings carry session ids, tokens, device ids and PII, so
 * only the origin and path ever leave a transport — including when an engine
 * exception quotes the request URL inside its own message.
 */

import type { SafeUrlForLog } from '../../Types/Brand.js';
import { mintSafeUrlForLog } from '../../Types/Brand.js';

/** Stand-in for a URL that cannot be parsed, so nothing raw is echoed. */
const UNPARSEABLE_URL = '<unparseable>';

/** One raw form of a URL that free text may quote, and its replacement. */
interface IUrlForm {
  readonly raw: string;
  readonly safe: string;
}

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
 * Every raw form of a URL an engine error may quote: as dispatched, as
 * normalised by the URL parser, and its bare query string.
 * @param url - Full URL as dispatched.
 * @returns Non-empty forms; whole URLs come before the bare query.
 */
function rawUrlForms(url: string): readonly IUrlForm[] {
  const safe = safeUrlForLog(url);
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
 * @returns The text with no quoted query string left.
 */
function scrubUrlFromText(text: string, url: string): string {
  const forms = rawUrlForms(url);
  return forms.reduce((acc, form): string => acc.split(form.raw).join(form.safe), text);
}

export default safeUrlForLog;
export { safeUrlForLog, scrubUrlFromText };
