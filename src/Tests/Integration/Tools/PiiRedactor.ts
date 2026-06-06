/**
 * PII redaction for harvested bank fixtures.
 *
 * <p>Single source of truth for the patterns the harvester applies
 * BEFORE writing any HTML/JSON to disk. Extracted from
 * {@link HarvestBankHtml} so post-login network responses + pre-login
 * page DOM go through the same scrubber.
 *
 * <p>Patterns are ordered: narrower rules MUST come first so a broad
 * rule (e.g. 9-digit Israeli ID) does not pre-empt a tighter match
 * (e.g. session token embedded inside a script payload).
 *
 * <p>reCAPTCHA tokens are short-lived secrets bound to the captured
 * IP — scrubbed at write time so re-harvest stays automatic and never
 * commits a working anchor token. Currency amounts (₪/NIS) are
 * redacted from JSON/HTML so committed fixtures never reveal account
 * balances even by accident.
 */

/** Public regex catalog — exported so tests can assert each pattern
 * fires on a synthetic positive case AND skips a synthetic negative. */
const PII_PATTERNS = {
  israeliId9: /\b\d{9}\b/g,
  israeliPhone: /\b05\d[-\s]?\d{7}\b/g,
  email: /[\w.+-]+@[\w-]+\.[\w.-]+/g,
  recaptchaTokenInput: /(<input[^>]*id="recaptcha-token"[^>]*value=")[^"]+(")/gi,
  recaptchaAnchorInit: /(recaptcha\.anchor\.Main\.init\(\s*)"[^"]+"/g,
  ilsAmount: /(₪|NIS|ILS|ש"ח|ש״ח)\s*[-+]?\d[\d,]*(?:\.\d+)?/g,
  bearerToken: /(Bearer\s+)[\w.~+/=-]{20,}/g,
  jwtToken: /\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}\b/g,
  cookieAuthValue: /((?:Set-Cookie|cookie)[^\n]*?(?:auth|token|session)=)[^;\s"]+/gi,
  ilIban: /\bIL\d{2}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{3,7}\b/g,
} as const;

/** Replacement applied for each pattern key. */
const PII_REPLACEMENTS: Readonly<Record<keyof typeof PII_PATTERNS, string>> = {
  israeliId9: '[redacted-id]',
  israeliPhone: '[redacted-phone]',
  email: '[redacted-email]',
  recaptchaTokenInput: '$1REDACTED_RECAPTCHA_TOKEN$2',
  recaptchaAnchorInit: '$1"REDACTED_RECAPTCHA_PAYLOAD"',
  ilsAmount: '$1 [redacted-amount]',
  bearerToken: '$1[redacted-bearer]',
  jwtToken: '[redacted-jwt]',
  cookieAuthValue: '$1[redacted-cookie]',
  ilIban: '[redacted-iban]',
};

/**
 * Apply every PII pattern to the input string. Order matches
 * {@link PII_PATTERNS} key order (narrowest first).
 *
 * @param raw - Untrusted input (HTML, JSON, or any captured string).
 * @returns Sanitized string safe to commit to the fixture corpus.
 */
function redactPii(raw: string): string {
  const keys = Object.keys(PII_PATTERNS) as readonly (keyof typeof PII_PATTERNS)[];
  return keys.reduce((acc, key) => acc.replace(PII_PATTERNS[key], PII_REPLACEMENTS[key]), raw);
}

/**
 * Pretty-print a JSON value through the PII redactor. Centralises the
 * "parse → stringify → redact → return" pipe used by the network
 * recorder so JSON bodies never leak credentials/balances/tokens.
 *
 * @param value - Parsed JSON value (object/array/primitive).
 * @returns Two-space-indented JSON with PII patterns redacted.
 */
function redactJson(value: unknown): string {
  const serialized = JSON.stringify(value, null, 2) as string | undefined;
  const safe = serialized ?? 'null';
  return redactPii(safe);
}

export type PiiPatternKey = keyof typeof PII_PATTERNS;
export { PII_PATTERNS, PII_REPLACEMENTS, redactJson, redactPii };
