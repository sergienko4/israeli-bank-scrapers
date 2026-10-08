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

import { Buffer } from 'node:buffer';
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

/** The exact transliterated Hebrew money keys Mizrahi returns: balances
 *  (`Yitra*`, `itra*`, `Remain`), amounts (`schum1`-`3`, `MC0xSchum*EZ`) and
 *  credit lines (`misgeret*`). Their `*Date`, `*Hour` and `*Specified`
 *  siblings are not money, so no wildcard is used. */
const TRANSLIT_MONEY_KEYS = String.raw`Yitra(?:Adkanit(?:LeloChekim)?|LeloChekim|Pahak)?|itra(?:Lelo_shekim)?|[Mm]isgeret(?:_kolel|_zmani|Peiloot)?|schum[1-3]|Remain|MC\d{2}(?:Ofi)?(?:Schum\d?|Yitra)EZ`;
/** A JSON key from {@link TRANSLIT_MONEY_KEYS} up to its value (quotes may be NDJSON-escaped). */
const TRANSLIT_MONEY_KEY_PREFIX = String.raw`"(?:${TRANSLIT_MONEY_KEYS})\\?"\s*:\s*`;
/** One IPv4 octet, 0-255. */
const IPV4_OCTET = String.raw`(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)`;
/** A dotted IPv4 address whose every octet is in range. */
const IPV4 = String.raw`${IPV4_OCTET}(?:\.${IPV4_OCTET}){3}`;
/** The whole base64-decoded Radware bot token: `<uuid>$<IPv4>`. Radware's
 *  UUID is not strict hex, so its groups accept any letter. */
const DECODED_EMBEDDED_IP = new RegExp(
  String.raw`^[\da-z]{8}(?:-[\da-z]{4}){3}-[\da-z]{12}\$${IPV4}$`,
  'i',
);
/** The exact Mizrahi attribute names that mark an element as a rendered
 *  amount; each use adds an attribute-name boundary after it. */
const SKY_CURRENCY_ATTR = String.raw`\s(?:sky-currency|sky-on-currency-change)`;
/** A plain rendered amount (`-120.5`, `1,234`). */
const PLAIN_AMOUNT = String.raw`-?\d[\d,]*(?:\.\d+)?`;
/** The all-zero GUID that stands in for a redacted server GUID. */
const ZERO_GUID = '00000000-0000-0000-0000-000000000000';
/** JSON keys whose string value is a person's name. */
const PERSON_NAME_KEYS = String.raw`partyFullName|partyFirstName|partyLastName|partyMiddleName|customerName|customerFullName|customerFirstName|customerLastName|userName|userFullName|firstName|lastName|fullName|middleName|FirstName|LastName|BankerName`;
/** Whole token values that are not secrets: any redactor placeholder, or
 *  the corpus's one synthetic session token. */
const TOKEN_PLACEHOLDER_VALUES = String.raw`\[redacted-[a-z-]+\]|FIXTURE-MAX-SESSION-A`;

/**
 * Whether a base64 run decodes to a payload that carries an IPv4 address
 * (Radware's `__uzdbm_*` bot token is `base64(<uuid>$<IPv4>)`).
 *
 * @param b64 - Candidate base64 run.
 * @returns True when the decoded bytes are exactly `<uuid>$<IPv4>`.
 */
function decodesToEmbeddedIp(b64: string): boolean {
  const decoded = Buffer.from(b64, 'base64').toString('latin1');
  return DECODED_EMBEDDED_IP.test(decoded);
}

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
  /** Radware bot-manager token whose base64 payload embeds the client's
   *  IPv4 (`__uzdbm_2 = '<base64(uuid$ip)>'`). Only a whole run of the
   *  token's encoded length is decoded, so long assets are never touched.
   *  Runs before the digit patterns so no 9-digit rule shreds it first. */
  base64EmbeddedIp: /(?<![\da-z+/])[\da-z+/]{56,76}={0,2}(?![\da-z+/=])/gi,
  /** IPv4 in a client-address field (`var client_ip = '<ip>'`,
   *  `"clientIp": "<ip>"`, `x-forwarded-for`). */
  clientIpField: new RegExp(
    String.raw`(?<=\b(?:client_?ip|remote_?addr|ip_?address|user_?ip|x-forwarded-for|x-real-ip)\\?["']?\s*[:=]\s*\\?["'])${IPV4}(?=\\?["'])`,
    'gi',
  ),
  /** Radware per-session UUID (`var __uzdbm_1 = '<uuid>'`) that links the
   *  pre- and post-login pages of one capture. */
  radwareSessionUuid:
    /(?<=var __uzdbm_\d+\s*=\s*')[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=')/gi,
  /** ASP.NET anti-forgery token in a hidden input, in either attribute
   *  order, with single, double or NDJSON-escaped quotes. */
  requestVerificationToken:
    /(?<=name=\\?["']__RequestVerificationToken\\?["'][^>]*?value=\\?["'])[^"'\\]+(?=\\?["'])|(?<=value=\\?["'])[^"'\\]+(?=\\?["'][^>]*?name=\\?["']__RequestVerificationToken\\?["'])/gi,
  /** JSON `<prefix>Token` string fields (`xsrfToken`) holding a live value
   *  of 12+ chars. Only a whole {@link TOKEN_PLACEHOLDER_VALUES} value is
   *  left alone, never a value that merely starts like one. */
  jsonTokenField: new RegExp(
    String.raw`(?<="\w+Token\\?"\s*:\s*\\?")(?!(?:${TOKEN_PLACEHOLDER_VALUES})\\?")[^"\\]{12,}(?=\\?")`,
    'g',
  ),
  /** Mizrahi `get428Index` paging GUID — a server session handle. */
  jsonActionGuid:
    /(?<="actionGUID\\?"\s*:\s*\\?")[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
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
  /** Microsoft Clarity / Bing UET session-instance UUID embedded in
   *  BAT beacon asset filenames as `_mid_<uuid>_`. Captures the
   *  `_mid_` prefix so it can be re-emitted unchanged while the UUID
   *  body is replaced. Must precede `israeliId9`. */
  trackingMidInAssetPath: /(_mid_)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
  /** Microsoft Clarity / Bing UET per-session hex blob embedded in
   *  BAT beacon asset filenames as `_sid_<hex>` (15+ hex chars,
   *  trailing). Captures the `_sid_` prefix; the hex body is
   *  replaced with a stable placeholder. Must precede `israeliId9`. */
  trackingSidInAssetPath: /(_sid_)[0-9a-f]{15,}/gi,
  hebrewGreetingName: /(>שלום\s*<\/h1>\s*<p[^>]*>)[^<]+(<\/p>)/g,
  hebrewSurnameLiteral: new RegExp(HE_SURNAME_ESC, 'g'),
  hebrewGivenNameLiteral: new RegExp(HE_GIVEN_NAME_ALT, 'g'),
  englishOperatorName: new RegExp(`\\b(${EN_OPERATOR_NAME_ALT})\\b`, 'gi'),
  operatorUsername: new RegExp(`\\b(${OPERATOR_USERNAME_ALT})\\b`, 'g'),
  operatorAccountLiteral: new RegExp(`\\b${OPERATOR_ACCOUNT_ESC}\\b`, 'g'),
  urlPathAccountId:
    /(\/(?:gatewayAPI|portalserver|api|Titan|Lobby|apollo|retail|retail2|rb)(?:\/[A-Za-z][\w.-]*)+\/)\d{6,12}(?=[/?"]|\\"|$)/g,
  jsonPersonNameField: new RegExp(
    String.raw`(\\?"(?:${PERSON_NAME_KEYS})\\?"\s*:\s*\\?")[^"\\]+(\\?")`,
    'g',
  ),
  /** Opaque per-user identifiers in JSON string fields (Mizrahi `logon`
   *  and `LoginUser`: `UserId`, `UserIdentifier`, `ClientGWIdentifier`,
   *  `anonymousID`). `\\?"` tolerates NDJSON-escaped quotes. */
  jsonOpaqueUserIdField:
    /(\\?"(?:UserId|Username|UserIdentifier|ClientGWIdentifier|anonymousID)\\?"\s*:\s*\\?")[^"\\]+(\\?")/g,
  /** Glassbox session-replay user id stamped on the Angular shell
   *  (`data.glassbox-id="<id>"`) — a stable per-user identifier. */
  glassboxUserIdAttr: /(data[.-]glassbox-id=")[^"]+(")/g,
  /** Account number embedded in permission role names
   *  (`AC_<account>_FUNDS_ACTIVITY`). The literal account pattern cannot
   *  match here because `\b` never fires between `_` and a digit. */
  roleEmbeddedAccount: /(\bAC_)\d{5,}(?=_)/g,
  lastLoginText: /(class="last-login"[^>]*>)[^<]*\d\d?\/\d\d?\/\d{2}[^<]*\d\d?:\d{2}[^<]*(?=<)/g,
  /** Last-login timestamp after its Hebrew label (`כניסתך האחרונה לשירות:`
   *  or `ביקורך האחרון`), possibly inside nested tags: `DD/MM/YYYY , HH:MM`. */
  hebrewLastLoginLabel:
    /((?:כניסתך האחרונה|ביקורך האחרון)[^<]*?(?:<[^>]*>\s*)*)\d{1,2}\/\d{1,2}\/\d{2,4}[\s,|]*\d{1,2}:\d{2}/g,
  /** JSON last-visit timestamps (Mizrahi logon `LastTimeVisited`,
   *  `_LastTime*`, account `TaarichPeulaAhrona`). */
  jsonLastLoginField:
    /(?<="(?:LastTimeVisited|TaarichPeulaAhrona|_LastTime\w*)\\?"\s*:\s*\\?")(?!\[redacted-last-login\]\\?")[^"\\]+(?=\\?")/g,
  numericBalanceSpan:
    /(<span[^>]*class="[^"]*number-(?:negative|positive|strong|amount|value|balance)[^"]*"[^>]*>\s*)-?\d[\d,]*(?:\.\d+)?(?=\s*<\/span>)/g,
  /** Mizrahi Angular amount text: the rendered number inside an element
   *  carrying a `miz-numeric-*` attribute (may open with U+202A). */
  mizNumericText: /(?<=miz-numeric-[\w-]+="[^"]*"[^>]*>\s*\u202A?)-?\d[\d,]*(?:\.\d+)?/g,
  /** Mizrahi rendered amount attributes (`miz-numeric-colorup="150"`). */
  mizNumericAttr: /(?<=\smiz-numeric-[\w-]+=")-?\d[\d,]*(?:\.\d+)?(?=")/g,
  /** Mizrahi rendered `currency="<amount>"` attribute, only on the element
   *  that also carries `sky-currency` or `sky-on-currency-change`, before
   *  or after it (one linear alternative per order). */
  currencyAmountAttr: new RegExp(
    String.raw`(?<=${SKY_CURRENCY_ATTR}(?=[\s=/])[^>]*\scurrency=")${PLAIN_AMOUNT}(?=")|(?<=\scurrency=")${PLAIN_AMOUNT}(?="[^>]*${SKY_CURRENCY_ATTR}[\s=>/])`,
    'g',
  ),
  /** Mizrahi rendered transaction reference (the `MC02AsmEZ` table cell). */
  mizrahiReferenceCell: /(?<=isCloseToZero\(dataItem\.MC\d{2}AsmEZ\)"[^>]*>\s*)\d+/g,
  jsonMonetaryField:
    /(\\?"\w*(?:Balance|Amount|Total|Sum|Withdrawal|Deposit|Credit|Debit|Charge|Payment|Cost|Price|Fee)\\?"\s*:\s*)-?\d+(?:\.\d+)?/g,
  /** Transliterated money fields with a bare number (`"YitraAdkanit": 150`). */
  jsonTranslitMoneyNumber: new RegExp(
    String.raw`(?<=${TRANSLIT_MONEY_KEY_PREFIX})-?\d+(?:\.\d+)?(?![\d.])`,
    'g',
  ),
  /** Transliterated money fields with a quoted number (`"itra": "150"`). */
  jsonTranslitMoneyString: new RegExp(
    String.raw`(?<=${TRANSLIT_MONEY_KEY_PREFIX}\\?")-?\d+(?:\.\d+)?(?=\\?")`,
    'g',
  ),
  /** Mizrahi movement reference number (`"MC02AsmEZ": 1234`). */
  jsonMizrahiReference: /(?<="MC\d{2}AsmEZ\\?"\s*:\s*)\d+/g,
  /** Mizrahi branch fields (`Branch`, `BranchForDispaly`, `BranchForMF`). */
  jsonBranchField: /(?<="Branch(?:ForDispaly|ForDisplay|ForMF)?\\?"\s*:\s*\\?")\d{2,3}(?=\\?")/g,
  /** JSON numeric account-id fields. Hapoalim's `/general/accounts` and
   *  `/home-page/composite/myAccount` responses expose the customer's
   *  6-7 digit account number as `"accountNumber": NNNNNN` (no quotes).
   *  Function-replacement returns sentinel `0` so JSON stays parseable.
   *  `\\?"` tolerates escaped quotes inside NDJSON envelope strings. */
  jsonAccountNumberField:
    /(\\?"(?:accountNumber|accountId|customerAccountNumber|branchAccountNumber)\\?"\s*:\s*)-?\d+/g,
  ilIban: /\bIL\d{2}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{3,7}\b/g,
  ilBankAccount: /\b\d{2,3}-\d{2,3}-\d{4,7}\b/g,
  /** Hapoalim 2-segment branch-account composite (3-digit branch
   *  + dash OR space + 6-digit account). Catches HTML text like
   *  `מס' : XXX-NNNNNN` AND JSON string values like
   *  `"productLabel": "XXX NNNNNN"`. Distinct from `ilBankAccount`
   *  (which requires the 3-segment XX-XXX-XXXXXX form). Must precede
   *  `israeliId9` so the composite isn't mis-classified as a 9-digit ID. */
  hapoalimBranchAccount: /\b\d{3}[-\s]\d{6}\b/g,
  israeliId9: /\b\d{9}\b/g,
  israeliPhone: /\b05\d[-\s]?\d{7}\b/g,
  israeliLandline: /\b0[2-589][-\s]?\d{7}\b/g,
  email: /[\w.+-]+@[\w-]+\.[\w.-]+/g,
  ilsAmount: /(₪|NIS|ILS|ש"ח|ש״ח)\s*[-+]?\d[\d,]*(?:\.\d+)?/g,
  ilsAmountSuffix: /-?\d[\d,]*(?:\.\d+)?\s*(₪|NIS|ILS|ש"ח|ש״ח)/g,
  /** Branch prefix left beside a redacted account (`123-[redacted-account]`).
   *  Every copy becomes `000-`, so equal accounts stay equal. Runs after
   *  every rule that emits `[redacted-account]`. */
  branchBeforeRedactedAccount: /\b\d{2,3}-(?=\[redacted-account\])/g,
  /** Sanitize redactor-output `tel:[redacted-id]` and `tel:[redacted-landline]`
   *  (neither is a valid `tel:` URI; trips parsers extracting dialable values)
   *  into a deterministic zero-numeric placeholder. Runs LAST to clean up
   *  outputs that landed inside `tel:` URI hrefs. The all-zeros value
   *  is chosen so it cannot collide with operator-account literals
   *  (e.g. example secrets ship a 9999999999 placeholder). Also rewrites
   *  the visible anchor text so href and text stay digit-formatted and
   *  consistent (preventing UI-assertion drift). */
  telLinkRedactedHref:
    /<a\b([^>]+?href="tel:)(?:\[redacted-(?:id|landline|phone)\]|0000000000)("[^>]*)>\[redacted-(?:id|landline|phone)\]<\/a>/g,
  telLinkRedactedIdHref: /\btel:\[redacted-(?:id|landline|phone)\]/g,
} as const;

/** Replacement applied for each pattern key. */
const PII_REPLACEMENTS: Readonly<Record<keyof typeof PII_PATTERNS, PiiReplacement>> = {
  recaptchaTokenInput: '$1REDACTED_RECAPTCHA_TOKEN$2',
  recaptchaAnchorInit: '$1"REDACTED_RECAPTCHA_PAYLOAD"',
  bearerToken: '$1[redacted-bearer]',
  jwtToken: '[redacted-jwt]',
  /**
   * Function replacement: only a base64 run that decodes to `$<IPv4>` is
   * replaced; every other long alphanumeric run is returned unchanged.
   *
   * @param match - The base64 candidate.
   * @returns The placeholder, or the match itself.
   */
  base64EmbeddedIp: (match: string): string =>
    decodesToEmbeddedIp(match) ? 'REDACTED_BOT_TOKEN' : match,
  clientIpField: '0.0.0.0',
  radwareSessionUuid: ZERO_GUID,
  requestVerificationToken: 'REDACTED_REQUEST_VERIFICATION_TOKEN',
  jsonTokenField: '[redacted-token]',
  jsonActionGuid: ZERO_GUID,
  cookieAuthValue: '$1[redacted-cookie]',
  hebrewGreetingName: '$1[redacted-name]$2',
  hebrewSurnameLiteral: '[redacted-name]',
  hebrewGivenNameLiteral: '[redacted-name]',
  englishOperatorName: '[redacted-name]',
  operatorUsername: '[redacted-username]',
  operatorAccountLiteral: '[redacted-account]',
  urlPathAccountId: '$1[redacted-account]',
  jsonPersonNameField: '$1[redacted-name]$2',
  jsonOpaqueUserIdField: '$1[redacted-user-id]$2',
  glassboxUserIdAttr: '$1[redacted-user-id]$2',
  roleEmbeddedAccount: '$1[redacted-account]',
  lastLoginText: '$1[redacted-last-login]',
  hebrewLastLoginLabel: '$1[redacted-last-login]',
  jsonLastLoginField: '[redacted-last-login]',
  numericBalanceSpan: '$1[redacted-amount]',
  mizNumericText: '[redacted-amount]',
  mizNumericAttr: '0',
  currencyAmountAttr: '0',
  mizrahiReferenceCell: '[redacted-id]',
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
  /**
   * Function replacement for `jsonAccountNumberField`: capture group 1
   * is the field name + colon + whitespace; we substitute sentinel `0`
   * so the surrounding JSON remains parseable.
   *
   * @param _match - Full match including the redactable numeric value.
   * @param prefix - Captured `"accountNumber": ` (or escaped variant).
   * @returns Prefix followed by zero sentinel.
   */
  jsonAccountNumberField: (_match: string, prefix: string): string => `${prefix}0`,
  jsonTranslitMoneyNumber: '0',
  jsonTranslitMoneyString: '0',
  jsonMizrahiReference: '0',
  jsonBranchField: '000',
  ilIban: '[redacted-iban]',
  ilBankAccount: '[redacted-account]',
  hapoalimBranchAccount: '[redacted-account]',
  israeliId9: '[redacted-id]',
  israeliPhone: '[redacted-phone]',
  israeliLandline: '[redacted-landline]',
  email: '[redacted-email]',
  ilsAmount: '$1 [redacted-amount]',
  ilsAmountSuffix: '[redacted-amount] $1',
  branchBeforeRedactedAccount: '000-',
  lsessionIdParam: '$1REDACTED_SESSION_ID',
  trackingIdParam: '$1ti=REDACTED_TRACKING_ID',
  trackingIdInAssetPath: '$1REDACTED_TRACKING_ID',
  trackingMidInAssetPath: '$1REDACTED_SESSION_UUID',
  trackingSidInAssetPath: '$1REDACTED_SESSION_HEX',
  /**
   * Function replacement: $1 captures attribute fragment up to and
   * including `href="tel:`, $2 captures the closing `"` plus any
   * remaining attributes. We rebuild the anchor so both href value
   * AND visible text are the deterministic `0000000000` placeholder.
   * Avoids `$1` + `0000000000` literal collision (`$10` is ambiguous
   * in regex replacement strings).
   *
   * @param _match - Full anchor element (unused).
   * @param prefix - Captured leading attribute fragment up to `href="tel:`.
   * @param suffix - Captured trailing portion starting with closing `"`.
   * @returns Anchor element with `tel:0000000000` href + matching text.
   */
  telLinkRedactedHref: (_match: string, prefix: string, suffix: string): string =>
    `<a${prefix}0000000000${suffix}>0000000000</a>`,
  telLinkRedactedIdHref: 'tel:0000000000',
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
 * <p>After all patterns run, a post-pass uniquifies QUOTED
 * `[redacted-id]` and prettier-corrupted `[redacted - id]` instances
 * by appending a per-call counter (`'[redacted-id-1]'`, `'[redacted-id-2]'`,
 * ...). This prevents the duplicate-sibling-key collision that
 * arises when `israeliId9` collapses multiple distinct 9-digit object
 * keys (e.g. `'305555555'`, `'305444444'`) into the same `'[redacted-id]'`
 * token — silently overwriting policy branches in fixture JS.
 *
 * <p>The counter is local to each call (per-file in the fixture sweep),
 * so uniqueness holds within any single JS scope. Unquoted HTML-text
 * `[redacted-id]` is left untouched — duplicates there are harmless.
 *
 * @param raw - Untrusted input (HTML, JSON, or any captured string).
 * @returns Sanitized string safe to commit to the fixture corpus.
 */
function redactPii(raw: string): string {
  const keys = Object.keys(PII_PATTERNS) as readonly (keyof typeof PII_PATTERNS)[];
  const redacted = keys.reduce<string>((acc, key) => applyOnePattern(acc, key), raw);
  return uniquifyQuotedRedactedIds(redacted);
}

/**
 * Rewrites all `[redacted - id]` (prettier-corrupted, unquoted) tokens
 * to unique quoted `"[redacted-id-N]"` tokens, using the supplied
 * counter object so the caller can continue numbering after this pass.
 *
 * @param input - String after the quoted-pass.
 * @param counter - Mutable counter object holding the next sequence value.
 * @param counter.n - Next numeric suffix to use (incremented in place).
 * @returns Input with each prettier-corrupted instance replaced.
 */
function uniquifyPrettierCorrupted(input: string, counter: { n: number }): string {
  return input.replace(/\[redacted - id\]/g, (): string => {
    counter.n += 1;
    return `"[redacted-id-${String(counter.n)}]"`;
  });
}

/**
 * Per-call counter post-pass: rewrites quoted `"[redacted-id]"`,
 * `'[redacted-id]'`, and prettier-corrupted unquoted `[redacted - id]`
 * forms to unique tokens so JS object literals don't collapse distinct
 * sibling keys into a single overwriting entry.
 *
 * @param input - String AFTER all primary redactor patterns applied.
 * @returns String with each quoted-or-prettier-corrupted redacted-id
 *   instance assigned a unique numeric suffix.
 */
function uniquifyQuotedRedactedIds(input: string): string {
  const counter = { n: 0 };
  const quoted = input.replace(/(["'])\[redacted-id\]\1/g, (_m: string, q: string): string => {
    counter.n += 1;
    return `${q}[redacted-id-${String(counter.n)}]${q}`;
  });
  return uniquifyPrettierCorrupted(quoted, counter);
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
