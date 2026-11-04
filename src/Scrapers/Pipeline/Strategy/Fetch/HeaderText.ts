/**
 * Header text — whether a string can travel in an HTTP header field, and
 * whether a cookie can travel in a Cookie header without splitting it.
 * A field value takes tab, 0x20–0x7E and 0x80–0xFF (RFC 9110 §5.5, the set
 * fetch accepts); a cookie name must be an RFC 6265 token, and its value keeps
 * out `;`.
 */

/** A field value: tab, 0x20–0x7E and 0x80–0xFF only, per UTF-16 code unit. */
const FIELD_VALUE = /^[\t\x20-\x7e\x80-\xff]*$/;

/** An RFC 6265 cookie name: one RFC 9110 token. */
const COOKIE_NAME = /^[!#$%&'*+.^`|~\w-]+$/;

/**
 * Whether a string can be sent as an HTTP header field value.
 * @param text - Candidate value.
 * @returns True when every code unit may sit in a field value.
 */
function isHeaderSafe(text: string): boolean {
  return FIELD_VALUE.test(text);
}

/**
 * Whether a cookie can be sent in a Cookie header as `name=value`.
 * @param name - Cookie name.
 * @param value - Cookie value.
 * @returns True for an RFC 6265 token name and a name-plus-value pair that is
 *   header-safe without `;`.
 */
function isSendableCookie(name: string, value: string): boolean {
  if (!COOKIE_NAME.test(name)) return false;
  const pair = `${name}${value}`;
  return isHeaderSafe(pair) && !pair.includes(';');
}

export { isHeaderSafe, isSendableCookie };
