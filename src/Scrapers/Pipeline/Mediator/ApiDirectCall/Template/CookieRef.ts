/**
 * CookieRef — resolves a `cookie.<name>` ref (N12) through the step's jar
 * view: the raw value of the cookie that applies to the step URL, then
 * URL-decoded. A missing cookie fails `miss`; a raw value over 4096 chars or
 * a malformed escape fails `bad`. Neither failure names the value.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { Option } from '../../../Types/Option.js';
import { none } from '../../../Types/Option.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, succeed } from '../../../Types/Procedure.js';
import type { JsonValue } from '../Envelope/JsonPointer.js';

/** The step's jar view: a cookie's raw value for the step URL. */
type CookieLookup = (name: string) => Option<string>;

const MAX_RAW_CHARS = 4096;

/**
 * The view of a scope without a domain jar: no cookies at all.
 * @returns None.
 */
function noCookies(): Option<string> {
  return none();
}

/**
 * URL-decode a raw cookie value.
 * @param raw - Raw jar value.
 * @returns The decoded value, or false when oversized or malformed.
 */
function decodeOrFalse(raw: string): string | false {
  if (raw.length > MAX_RAW_CHARS) return false;
  try {
    return decodeURIComponent(raw);
  } catch {
    return false;
  }
}

/**
 * Resolve a cookie ref.
 * @param name - Cookie name.
 * @param lookup - The step's jar view; none when the scope has no jar.
 * @returns Procedure with the decoded value, or a miss / bad failure.
 */
function resolveCookieRef(name: string, lookup: CookieLookup = noCookies): Procedure<JsonValue> {
  const found = lookup(name);
  if (!found.has) return fail(ScraperErrorTypes.Generic, `ref cookie.${name} miss`);
  const decoded = decodeOrFalse(found.value);
  if (decoded === false) return fail(ScraperErrorTypes.Generic, `ref cookie.${name} bad`);
  return succeed(decoded);
}

export type { CookieLookup };
export { resolveCookieRef };
