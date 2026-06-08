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
 * <p>Operator-specific literals (Hebrew surname/given name, English
 * operator name, username, account number) are loaded at module-load
 * time from a gitignored `.pii-secrets.json` file at the repo root.
 * When that file is absent the loader falls back to
 * `.pii-secrets.example.json` (committed, placeholder values) so CI
 * and tests run without operator data on disk.
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

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Custom error thrown when operator-specific PII literals cannot be loaded. */
class PiiSecretsMissingError extends Error {
  /**
   * Create a `PiiSecretsMissingError` with a remediation hint.
   *
   * @param message - Human-readable explanation including the searched path.
   */
  constructor(message: string) {
    super(message);
    this.name = 'PiiSecretsMissingError';
  }
}

/** Operator-specific PII literals loaded from a gitignored JSON file. */
interface IPiiSecrets {
  readonly hebrewSurnameLiteral: string;
  readonly hebrewGivenNameLiterals: readonly string[];
  readonly englishOperatorNames: readonly string[];
  readonly operatorUsernames: readonly string[];
  readonly operatorAccountLiteral: string;
}

/**
 * Escape a literal so it can be embedded inside a `RegExp` source.
 *
 * @param s - Raw literal that may contain regex metacharacters.
 * @returns The same literal with all metacharacters backslash-escaped.
 */
function escapeRegexLiteral(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Join several literals into a `RegExp` alternation source.
 *
 * @param items - Literals to alternate (each is escaped before joining).
 * @returns A `|`-separated alternation suitable for `new RegExp(...)`.
 */
function regexAlternation(items: readonly string[]): string {
  const escaped = items.map(escapeRegexLiteral);
  return escaped.join('|');
}

/**
 * Locate the repo root from this file's URL (works under NodeNext ESM).
 *
 * @returns Absolute path to the repository root (4 levels above this file).
 */
function repoRoot(): string {
  const fileUrl = import.meta.url;
  const localPath = fileURLToPath(fileUrl);
  const here = path.dirname(localPath);
  return path.resolve(here, '..', '..', '..', '..');
}

/**
 * Build the error message shown when neither secrets file exists.
 *
 * @param root - Absolute path to the repo root that was searched.
 * @returns Human-readable error message with remediation hint.
 */
function missingSecretsMessage(root: string): string {
  return (
    `[PiiRedactor] Missing both .pii-secrets.json and .pii-secrets.example.json under ${root}. ` +
    'Copy .pii-secrets.example.json to .pii-secrets.json and populate real values, ' +
    'or restore the committed example template. The real file MUST stay gitignored.'
  );
}

/**
 * Pick the first existing secrets file, preferring real over example.
 *
 * @param root - Repo root absolute path.
 * @returns Absolute path to the chosen secrets file.
 * @throws {PiiSecretsMissingError} When neither candidate file exists.
 */
function pickSecretsFile(root: string): string {
  const real = path.join(root, '.pii-secrets.json');
  if (fs.existsSync(real)) return real;
  const example = path.join(root, '.pii-secrets.example.json');
  if (fs.existsSync(example)) return example;
  throw new PiiSecretsMissingError(missingSecretsMessage(root));
}

/**
 * Load PII literals from `.pii-secrets.json` (real values, gitignored)
 * or `.pii-secrets.example.json` (committed fallback with placeholders).
 *
 * @returns Parsed `IPiiSecrets` from the chosen file.
 * @throws {PiiSecretsMissingError} When neither file exists at the repo root.
 */
function loadPiiSecrets(): IPiiSecrets {
  const root = repoRoot();
  const chosen = pickSecretsFile(root);
  const raw = fs.readFileSync(chosen, 'utf8');
  return JSON.parse(raw) as IPiiSecrets;
}

const SECRETS = loadPiiSecrets();

/** Pre-built alternation source for Hebrew given-name literals. */
const HE_GIVEN_NAME_ALT = regexAlternation(SECRETS.hebrewGivenNameLiterals);
/** Pre-built alternation source for English operator-name literals. */
const EN_OPERATOR_NAME_ALT = regexAlternation(SECRETS.englishOperatorNames);
/** Pre-built alternation source for operator-username literals. */
const OPERATOR_USERNAME_ALT = regexAlternation(SECRETS.operatorUsernames);
/** Escaped form of the operator's account-number literal. */
const OPERATOR_ACCOUNT_ESC = escapeRegexLiteral(SECRETS.operatorAccountLiteral);
/** Escaped form of the operator's Hebrew surname literal. */
const HE_SURNAME_ESC = escapeRegexLiteral(SECRETS.hebrewSurnameLiteral);

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
  /** Discount/Telebank session token in marketing-pixel query strings
   *  (`&LSESSIONID=<opaque>`). Must run BEFORE generic id/jwt patterns
   *  so the long token isn't shredded into smaller-pattern matches. */
  lsessionIdParam: /(LSESSIONID=)[^&"'\s>]+/g,
  /** Google-ads conversion-tracking numeric (`&ti=NNNN`). Must run
   *  BEFORE `israeliId9` so the 9-digit tracking ID isn't first
   *  matched as a generic Israeli-ID shape. */
  trackingIdParam: /([?&;])ti=\d{6,}/g,
  /** Microsoft Clarity / Bing UET advertiser tag ID baked into asset
   *  filenames (`..._tag_uet_187049083`, `..._p_action_187049083.js`,
   *  `..._ti_187049083_Ver_...`). The numeric is an advertiser-bound
   *  tracking ID — scrub it from the captured asset path while leaving
   *  the routing context intact. Must precede `israeliId9`. */
  trackingIdInAssetPath: /(_(?:tag_uet|p_action|action_\d+_ti|ti)_)\d{6,}/g,
  hebrewGreetingName: /(>שלום\s*<\/h1>\s*<p[^>]*>)[^<]+(<\/p>)/g,
  hebrewSurnameLiteral: new RegExp(HE_SURNAME_ESC, 'g'),
  hebrewGivenNameLiteral: new RegExp(HE_GIVEN_NAME_ALT, 'g'),
  englishOperatorName: new RegExp(`\\b(${EN_OPERATOR_NAME_ALT})\\b`, 'gi'),
  operatorUsername: new RegExp(`\\b(${OPERATOR_USERNAME_ALT})\\b`, 'g'),
  operatorAccountLiteral: new RegExp(`\\b${OPERATOR_ACCOUNT_ESC}\\b`, 'g'),
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
  /** Sanitize redactor-output `tel:[redacted-id]` (not a valid `tel:`
   *  URI; trips parsers extracting dialable values) into a deterministic
   *  zero-numeric placeholder. Runs LAST to clean up `israeliId9`
   *  outputs that landed inside `tel:` URI hrefs. The all-zeros value
   *  is chosen so it cannot collide with operator-account literals
   *  (e.g. example secrets ship a 9999999999 placeholder). */
  telLinkRedactedIdHref: /\btel:\[redacted-id\]/g,
  /** Repair prettier-corrupted `[redacted - id]` (with spaces) that
   *  arose when prettier reformatted `[redacted-id]` inside `<script>`
   *  array literals as `[<binary-subtraction-expression>]`. Wrap in
   *  quotes so the JS parses (string literal inside the array). Runs
   *  LAST so it only ever fires on prettier-mangled prior output. */
  prettierJsRedactedId: /\[redacted - id\]/g,
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
  lsessionIdParam: '$1REDACTED_SESSION_ID',
  trackingIdParam: '$1ti=REDACTED_TRACKING_ID',
  trackingIdInAssetPath: '$1REDACTED_TRACKING_ID',
  telLinkRedactedIdHref: 'tel:0000000000',
  prettierJsRedactedId: '"[redacted-id]"',
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

/**
 * Read-only exposure of the operator literals loaded from `.pii-secrets.json`
 * (or the example fallback). Test files import this to drive operator-known
 * literal tests at runtime WITHOUT containing the literals in source.
 */
const OPERATOR_LITERALS = {
  hebrewSurname: SECRETS.hebrewSurnameLiteral,
  hebrewGivenName: SECRETS.hebrewGivenNameLiterals[0] ?? '',
  englishOperatorName: SECRETS.englishOperatorNames[0] ?? '',
  operatorUsername: SECRETS.operatorUsernames[0] ?? '',
  operatorAccount: SECRETS.operatorAccountLiteral,
} as const;

export { OPERATOR_LITERALS, PII_PATTERNS, PII_REPLACEMENTS, redactJson, redactPii };
