/**
 * AuthCredentials — token / otp / cookie redactors plus the value-shape
 * sniffers used by the unified {@link Facade.redact} entry point.
 *
 * Phase 6 commit 5: these strategies behave identically to the
 * pre-split exports — `PII_REDACTION=off` still passes the raw value
 * through. The unified `redact()` entry point hard-codes default-deny
 * so the dev-mode bypass cannot escape via the public surface.
 */

import {
  isPiiRedactionDisabled,
  type PiiCategory,
  type PiiClassifierBool,
  type PiiHintString,
  REDACTED_HINT,
} from './Types.js';

/** OTP length range — 4..8 ASCII digits. */
const OTP_MIN_LEN = 4;
const OTP_MAX_LEN = 8;

/** Token-shaped prefix used by value-only classification. */
const TOKEN_VALUE_PREFIX_RE = /^eyJ[\w-]{20,}/;
/** OTP-shaped value: 4..8 ASCII digits, no separators. */
const OTP_VALUE_RE = /^\d{4,8}$/;
/** Cookie-shaped value: NAME=VALUE pair (RFC 6265 cookie-name token). */
const COOKIE_VALUE_RE = /^[a-z][\w.-]*=/i;

export const TOKEN_CATEGORY: PiiCategory = 'token';
export const OTP_CATEGORY: PiiCategory = 'otp';
export const COOKIE_CATEGORY: PiiCategory = 'cookie';

/**
 * Shared full-redact strategy used by both the token and the cookie
 * exports — both opaque secrets, both yield `[REDACTED]` in production.
 * @param value - Raw secret.
 * @returns Stable hint.
 */
function redactOpaqueSecret(value: string): PiiHintString {
  if (isPiiRedactionDisabled) return value as PiiHintString;
  if (value.length === 0) return '' as PiiHintString;
  return REDACTED_HINT as PiiHintString;
}

/**
 * Token / JWT strategy. Always full redact in production.
 * @param value - Raw token.
 * @returns Stable hint.
 */
function redactToken(value: string): PiiHintString {
  return redactOpaqueSecret(value);
}

/**
 * OTP strategy. Returns '[OTP]' for 4..8 digit inputs; default-deny otherwise.
 * @param value - Raw OTP.
 * @returns Stable hint.
 */
function redactOtp(value: string): PiiHintString {
  if (isPiiRedactionDisabled) return value as PiiHintString;
  if (value.length === 0) return '' as PiiHintString;
  if (value.length < OTP_MIN_LEN) return REDACTED_HINT as PiiHintString;
  if (value.length > OTP_MAX_LEN) return REDACTED_HINT as PiiHintString;
  return '[OTP]' as PiiHintString;
}

/**
 * Cookie strategy. Always full redact in production.
 * @param value - Raw cookie string.
 * @returns Stable hint.
 */
function redactCookie(value: string): PiiHintString {
  return redactOpaqueSecret(value);
}

/**
 * Whether a value looks like an opaque bearer/JWT token.
 * @param value - Candidate string.
 * @returns True when the string starts with a JWT-shaped header.
 */
export function looksLikeToken(value: string): PiiClassifierBool {
  return TOKEN_VALUE_PREFIX_RE.test(value) as PiiClassifierBool;
}

/**
 * Whether a value looks like an OTP code.
 * @param value - Candidate string.
 * @returns True when the string is a 4..8 digit run.
 */
export function looksLikeOtp(value: string): PiiClassifierBool {
  return OTP_VALUE_RE.test(value) as PiiClassifierBool;
}

/**
 * Whether a value looks like an HTTP cookie pair.
 * @param value - Candidate string.
 * @returns True when the string is a `NAME=VALUE` pair.
 */
export function looksLikeCookie(value: string): PiiClassifierBool {
  return COOKIE_VALUE_RE.test(value) as PiiClassifierBool;
}

export { redactCookie, redactOtp, redactToken };
