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
 *
 * <p>HEBREW-SPECIFIC patterns: Hebrew RTL renders currency AFTER the
 * number (`144.70 ₪`, not `₪144.70`). The personal-greeting block on
 * post-login bank pages renders as `<h1>שלום</h1><p>FULL NAME</p>`,
 * and the last-login timestamp as `<p class="last-login">...DD/MM/YY |
 * HH:MM</p>`. These are explicitly covered here so harvested fixtures
 * never commit a customer's real name, account number, or balance.
 */

/** Replacement string OR replacement function (for patterns whose
 * substitution depends on captured groups in non-trivial ways). */
type PiiReplacement = string | ((match: string, ...groups: string[]) => string);

/** Public regex catalog — exported so tests can assert each pattern
 * fires on a synthetic positive case AND skips a synthetic negative. */
const PII_PATTERNS = {
  recaptchaTokenInput: /(<input[^>]*id="recaptcha-token"[^>]*value=")[^"]+(")/gi,
  recaptchaAnchorInit: /(recaptcha\.anchor\.Main\.init\(\s*)"[^"]+"/g,
  bearerToken: /(Bearer\s+)[\w.~+/=-]{20,}/g,
  jwtToken: /\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}\b/g,
  cookieAuthValue: /((?:Set-Cookie|cookie)[^\n]*?(?:auth|token|session)=)[^;\s"]+/gi,
  hebrewGreetingName: /(>שלום\s*<\/h1>\s*<p[^>]*>)[^<]+(<\/p>)/g,
  hebrewSurnameLiteral: /[REDACTED-HE-SURNAME]/g,
  hebrewGivenNameLiteral: /יוג['׳]ין|יבגניה|יבגני|[REDACTED-HE-NAME]/g,
  englishOperatorName: /\b([REDACTED-USER]|Yevgeny|Eugen|Eugene)\b/gi,
  operatorUsername: /\b([REDACTED-USER]|esergienko|VT75151)\b/g,
  operatorAccountLiteral: /\b[REDACTED-OPER-ACCT]\b/g,
  urlPathAccountId:
    /(\/(?:gatewayAPI|portalserver|api|Titan|Lobby|apollo|retail|retail2|rb)(?:\/[A-Za-z][\w.-]*)+\/)\d{6,12}(?=[/?"]|\\"|$)/g,
  jsonPersonNameField:
    /(\\?"(?:partyFullName|partyFirstName|partyLastName|partyMiddleName|customerName|customerFullName|customerFirstName|customerLastName|userName|userFullName|firstName|lastName|fullName|middleName)\\?"\s*:\s*\\?")[^"\\]+(\\?")/g,
  lastLoginText: /(class="last-login"[^>]*>)[^<]*\d\d?\/\d\d?\/\d{2}[^<]*\d\d?:\d{2}[^<]*(?=<)/g,
  numericBalanceSpan:
    /(<span[^>]*class="[^"]*number-(?:negative|positive|strong|amount|value|balance)[^"]*"[^>]*>\s*)-?\d[\d,]*(?:\.\d+)?(?=\s*<\/span>)/g,
  jsonMonetaryField:
    /("\w*(?:Balance|Amount|Total|Sum|Withdrawal|Deposit)"\s*:\s*)-?\d+(?:\.\d+)?/g,
  ilIban: /\bIL\d{2}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{3,7}\b/g,
  ilBankAccount: /\b\d{2,3}-\d{2,3}-\d{4,7}\b/g,
  israeliId9: /\b\d{9}\b/g,
  israeliPhone: /\b05\d[-\s]?\d{7}\b/g,
  israeliLandline: /\b0[2-589][-\s]?\d{7}\b/g,
  email: /[\w.+-]+@[\w-]+\.[\w.-]+/g,
  ilsAmount: /(₪|NIS|ILS|ש"ח|ש״ח)\s*[-+]?\d[\d,]*(?:\.\d+)?/g,
  ilsAmountSuffix: /-?\d[\d,]*(?:\.\d+)?\s*(₪|NIS|ILS|ש"ח|ש״ח)/g,
} as const;

/** Replacement applied for each pattern key. */
const PII_REPLACEMENTS: Readonly<Record<keyof typeof PII_PATTERNS, PiiReplacement>> = {
  recaptchaTokenInput: '$1REDACTED_RECAPTCHA_TOKEN$2',
  recaptchaAnchorInit: '$1"REDACTED_RECAPTCHA_PAYLOAD"',
  bearerToken: '$1[redacted-bearer]',
  jwtToken: '[redacted-jwt]',
  cookieAuthValue: '$1[redacted-cookie]',
  hebrewGreetingName: '$1[redacted-name]$2',
  hebrewSurnameLiteral: '[redacted-name]',
  hebrewGivenNameLiteral: '[redacted-name]',
  englishOperatorName: '[redacted-name]',
  operatorUsername: '[redacted-username]',
  operatorAccountLiteral: '[redacted-account]',
  urlPathAccountId: '$1[redacted-account]',
  jsonPersonNameField: '$1[redacted-name]$2',
  lastLoginText: '$1[redacted-last-login]',
  numericBalanceSpan: '$1[redacted-amount]',
  /**
   * Function replacement: capture group 1 is the JSON field name + `": "`,
   * we replace the captured raw number with the sentinel `0` so committed
   * fixtures keep parseable JSON while disclosing zero balance.
   *
   * @param _match - The full match (unused; we rebuild from the prefix).
   * @param prefix - The captured field-name + `": "` portion.
   * @returns The prefix followed by the redacted `0` value.
   */
  jsonMonetaryField: (_match: string, prefix: string): string => `${prefix}0`,
  ilIban: '[redacted-iban]',
  ilBankAccount: '[redacted-account]',
  israeliId9: '[redacted-id]',
  israeliPhone: '[redacted-phone]',
  israeliLandline: '[redacted-landline]',
  email: '[redacted-email]',
  ilsAmount: '$1 [redacted-amount]',
  ilsAmountSuffix: '[redacted-amount] $1',
};

/**
 * Apply one pattern → its replacement (string OR function) without
 * widening the TS union to `any`.
 *
 * @param raw - Input string.
 * @param key - Pattern key.
 * @returns String with this single pattern applied.
 */
function applyOnePattern(raw: string, key: keyof typeof PII_PATTERNS): string {
  const pattern = PII_PATTERNS[key];
  const replacement = PII_REPLACEMENTS[key];
  if (typeof replacement === 'function') return raw.replace(pattern, replacement);
  return raw.replace(pattern, replacement);
}

/**
 * Apply every PII pattern to the input string. Order matches
 * {@link PII_PATTERNS} key order (narrowest first).
 *
 * @param raw - Untrusted input (HTML, JSON, or any captured string).
 * @returns Sanitized string safe to commit to the fixture corpus.
 */
function redactPii(raw: string): string {
  const keys = Object.keys(PII_PATTERNS) as readonly (keyof typeof PII_PATTERNS)[];
  return keys.reduce<string>((acc, key) => applyOnePattern(acc, key), raw);
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
