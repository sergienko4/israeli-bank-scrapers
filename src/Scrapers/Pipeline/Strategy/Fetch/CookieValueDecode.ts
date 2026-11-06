/**
 * Cookie value decode — how a stored cookie value echoed into a request
 * header is URI-decoded. A value decodes when every escape is well formed
 * and the decoded text can travel in a header field (`isHeaderSafe`). The
 * lenient form sends any other value raw; the strict form fails, naming the
 * cookie only. Cookie values are never logged.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { Option } from '../../Types/Option.js';
import { isSome, none, some } from '../../Types/Option.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import { isHeaderSafe } from './HeaderText.js';

/**
 * URI-decode a cookie value that a header can carry once decoded.
 * @param raw - Stored cookie value.
 * @returns The decoded value, or none for a malformed escape or a decoded
 *   value no header can hold.
 */
function decodedForHeader(raw: string): Option<string> {
  try {
    const decoded = decodeURIComponent(raw);
    return isHeaderSafe(decoded) ? some(decoded) : none();
  } catch {
    return none();
  }
}

/**
 * Decode a cookie value, keeping it raw when it does not decode.
 * @param raw - Stored cookie value.
 * @returns The decoded value, or the raw value.
 */
function decodeCookieLenient(raw: string): string {
  const decoded = decodedForHeader(raw);
  return isSome(decoded) ? decoded.value : raw;
}

/**
 * Decode a cookie value, failing when it does not decode.
 * @param name - Cookie name, the only text the failure names.
 * @param raw - Stored cookie value.
 * @returns The decoded value, or a `Generic` failure that stops the request.
 */
function decodeCookieStrict(name: string, raw: string): Procedure<string> {
  const decoded = decodedForHeader(raw);
  if (isSome(decoded)) return succeed(decoded.value);
  return fail(ScraperErrorTypes.Generic, `cookie ${name} undecodable`);
}

export default decodeCookieStrict;
export { decodeCookieLenient, decodeCookieStrict };
