#!/usr/bin/env node
/* eslint-disable */
/**
 * Exhaustive PII audit for committed bank fixtures.
 *
 * Scans every HTML/JSON file under src/Tests/Integration/fixtures/banks/
 * for ANY pattern that could leak production customer data: Hebrew names
 * in greetings, account numbers, IBANs, IDs, phones, emails, raw
 * monetary numbers (with/without currency), last-login timestamps,
 * card last-4, address fragments, JSON monetary fields, and any
 * Hebrew text inside a known PII-bearing class context.
 *
 * Zero trust: each fixture reports at most MAX_HITS_PER_FILE (15) CRITICAL
 * or HIGH hits as rule, severity and line:column, and any further hits
 * only as a count. It never prints the matched text or its context,
 * because the pre-commit hook writes this output to
 * `.pre-commit-output.log`. Open the fixture at a reported location to
 * inspect a hit; re-run after fixing to surface the hits past the cap.
 * Exits non-zero when any CRITICAL or HIGH pattern fires.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const FIXTURES = path.join(ROOT, 'src', 'Tests', 'Integration', 'fixtures', 'banks');

/** Escape a literal so it can be embedded in a RegExp source. */
function escapeRegexLiteral(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Build a regex alternation source from a list of literals. */
function alternation(items) {
  return items.map(escapeRegexLiteral).join('|');
}

/** Load operator-specific PII literals from a gitignored secrets file.
 *  Prefers .pii-secrets.json (real values) and falls back to
 *  .pii-secrets.example.json so CI without secrets still runs the
 *  generic patterns. Hard-errors only when NEITHER file exists. */
function loadPiiSecrets() {
  const real = path.join(ROOT, '.pii-secrets.json');
  const example = path.join(ROOT, '.pii-secrets.example.json');
  const chosen = fs.existsSync(real) ? real : fs.existsSync(example) ? example : null;
  if (!chosen) {
    console.error(
      `\n❌ Missing .pii-secrets.json AND .pii-secrets.example.json under ${ROOT}.\n` +
        `   Copy .pii-secrets.example.json (template) to .pii-secrets.json and populate with real operator values.\n` +
        `   This file is gitignored — never commit it.\n`,
    );
    process.exit(3);
  }
  if (chosen === example) {
    console.warn(`⚠️  Using ${path.relative(ROOT, example)} — operator-specific patterns will use placeholder values only.\n`);
  }
  return JSON.parse(fs.readFileSync(chosen, 'utf8'));
}

const SECRETS = loadPiiSecrets();

/** The exact transliterated money keys Mizrahi returns — mirrors
 *  TRANSLIT_MONEY_KEYS in src/Tests/Integration/Tools/PiiRedactor.ts. */
const TRANSLIT_MONEY_KEYS = String.raw`Yitra(?:Adkanit(?:LeloChekim)?|LeloChekim|Pahak)?|itra(?:Lelo_shekim)?|[Mm]isgeret(?:_kolel|_zmani|Peiloot)?|schum[1-3]|Remain|MC\d{2}(?:Ofi)?(?:Schum\d?|Yitra)EZ`;
const TRANSLIT_MONEY_KEY_PREFIX = String.raw`"(?:${TRANSLIT_MONEY_KEYS})\\?"\s*:\s*`;
/** A dotted IPv4 address whose every octet is in range (0-255). */
const IPV4_OCTET = String.raw`(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)`;
const IPV4 = String.raw`${IPV4_OCTET}(?:\.${IPV4_OCTET}){3}`;
/** Mirrors IPV6 / CLIENT_ADDRESS in PiiRedactor.ts. */
const IPV6 = String.raw`(?:[\da-f]{1,4}:){7}[\da-f]{1,4}|(?:(?:[\da-f]{1,4}:){1,7}|:):[\da-f.:]*`;
const CLIENT_ADDRESS = new RegExp(String.raw`(?<![\w.:])(?:${IPV4}(?![\d.])|(?:${IPV6})(?![\w.:]))`, 'gi');
/** The exact all-zero addresses PiiRedactor.ts writes for a client IP. */
const CLIENT_IP_PLACEHOLDERS = new Set(['0.0.0.0', '::']);
/** The whole base64-decoded Radware bot token: `<uuid>$<IPv4>`. */
const DECODED_EMBEDDED_IP = new RegExp(String.raw`^[\da-z]{8}(?:-[\da-z]{4}){3}-[\da-z]{12}\$${IPV4}$`, 'i');
/** Mirrors SKY_CURRENCY_ATTR / PLAIN_AMOUNT in PiiRedactor.ts. */
const SKY_CURRENCY_ATTR = String.raw`\s(?:sky-currency|sky-on-currency-change)`;
const PLAIN_AMOUNT = String.raw`-?\d[\d,]*(?:\.\d+)?`;
const ZERO_GUID = '00000000-0000-0000-0000-000000000000';
/** Mirrors UUID_GLOBAL in PiiRedactor.ts. */
const UUID_GLOBAL = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
/** Mirrors PERSON_NAME_KEYS / TOKEN_PLACEHOLDER_VALUES in PiiRedactor.ts. */
const PERSON_NAME_KEYS = String.raw`partyFullName|partyFirstName|partyLastName|partyMiddleName|customerName|customerFullName|customerFirstName|customerLastName|custFullName|displayName|userName|userFullName|firstName|lastName|fullName|middleName|FirstName|LastName|BankerName`;
const TOKEN_PLACEHOLDER_VALUES = String.raw`\[redacted-[a-z-]+\]|FIXTURE-MAX-SESSION-A`;
/** Regex source for a whole JSON string value with its quotes, plain or
 *  NDJSON-escaped once; each body token is one char or one whole escape
 *  pair, so `\"`, `\/` or `\uXXXX` never ends it — mirrors jsonStringValue
 *  in PiiRedactor.ts. */
function jsonStringValue(count = '+') {
  const plain = String.raw`"(?:[^"\\]|\\.)${count}"`;
  const escaped = String.raw`\\"(?:[^"\\]|\\\\(?:\\["\\]|[^"\\]))${count}\\"`;
  return `(?:${plain}|${escaped})`;
}
/** Negative lookahead for a JSON string value that is wholly one of
 *  `values`, in either quoting — mirrors notWholeValue in PiiRedactor.ts. */
function notWholeValue(values) {
  return String.raw`(?!"(?:${values})"|\\"(?:${values})\\")`;
}
/** The exact anti-forgery placeholder PiiRedactor.ts writes; only this
 *  value is exempt, never anything that merely starts with `REDACTED_`. */
const RVT_PLACEHOLDER = 'REDACTED_REQUEST_VERIFICATION_TOKEN';
/** Rules whose whole match is a value; an all-zero value is not personal
 *  data, and PiiRedactor.ts keeps it (`keepZero`), so it is not a hit.
 *  Tested in JS rather than with overlapping quantifiers, which backtrack
 *  on long near-misses. */
const ZERO_VALUE_IDS = new Set([
  'json-translit-money',
  'miz-numeric-attr',
  'miz-numeric-text',
  'currency-amount-attr',
  'json-mizrahi-reference',
  'miz-reference-cell',
  'il-bank-account',
  'hapoalim-branch-account',
  'israeli-id-9',
]);

// A rule whose lookbehind ends in `\s*` consumes its first value character
// before the lookbehind (`\d(?<=…\s*\d)`), so a whitespace run is not
// rescanned backwards at every position in it (PiiRuleLinearity.test.ts).
const PATTERNS = [
  // --- Customer identity (operator-specific literals loaded from .pii-secrets.json) ---
  { id: 'hebrew-greeting-name', re: />שלום\s*<\/h1>\s*<p[^>]*>([^<]+)<\/p>/g, severity: 'CRITICAL', desc: 'Hebrew greeting name <h1>שלום</h1><p>NAME</p>' },
  { id: 'hebrew-name-literal-surname', re: new RegExp(escapeRegexLiteral(SECRETS.hebrewSurnameLiteral), 'g'), severity: 'CRITICAL', desc: 'Literal operator surname leaked' },
  { id: 'hebrew-name-literal-given', re: new RegExp(alternation(SECRETS.hebrewGivenNameLiterals), 'g'), severity: 'CRITICAL', desc: 'Literal operator given name leaked' },
  { id: 'eng-name-literal', re: new RegExp(`\\b(${alternation(SECRETS.englishOperatorNames)})\\b`, 'gi'), severity: 'CRITICAL', desc: 'Literal operator name in English' },
  { id: 'username-literal', re: new RegExp(`\\b(${alternation(SECRETS.operatorUsernames)})\\b`, 'g'), severity: 'CRITICAL', desc: 'Literal credential/username leaked' },
  { id: 'operator-account-literal', re: new RegExp(`\\b${escapeRegexLiteral(SECRETS.operatorAccountLiteral)}\\b`, 'g'), severity: 'CRITICAL', desc: 'Operator account number literal' },
  { id: 'bare-account-in-url', re: /(?:\/(?:gatewayAPI|portalserver|api|Titan|Lobby|apollo|retail|retail2|rb)(?:\/[A-Za-z][\w.-]*)+\/)\d{6,12}(?=\/|\?|$|"|\\")/g, severity: 'CRITICAL', desc: 'Bare account-id in REST URL path' },
  { id: 'json-person-name-field', re: new RegExp(String.raw`\\?"(?:${PERSON_NAME_KEYS})\\?"\s*:\s*${notWholeValue(String.raw`\[redacted-name\]`)}${jsonStringValue()}`, 'g'), severity: 'CRITICAL', desc: 'JSON person-name field with raw value' },
  { id: 'json-opaque-user-id', re: new RegExp(String.raw`\\?"(?:UserId|Username|UserIdentifier|ClientGWIdentifier|anonymousID)\\?"\s*:\s*${notWholeValue(String.raw`\[redacted-user-id\]`)}${jsonStringValue()}`, 'g'), severity: 'CRITICAL', desc: 'JSON per-user identifier field with raw value' },
  { id: 'glassbox-user-id', re: /data[.-]glassbox-id="(?!\[redacted-user-id\]")[^"]+"/g, severity: 'CRITICAL', desc: 'Glassbox session-replay user id attribute' },
  { id: 'role-embedded-account', re: /\bAC_\d{5,}_/g, severity: 'CRITICAL', desc: 'Account number embedded in permission role (AC_<account>_...)' },
  { id: 'json-branch-field', re: /"Branch(?:ForDispaly|ForDisplay|ForMF)?\\?"\s*:\s*\\?"(?!000\\?")\d{2,3}(?=\\?")/g, severity: 'HIGH', desc: 'JSON branch-number field with a raw value (Mizrahi)' },
  { id: 'branch-before-redacted-account', re: /\b(?!000-)\d{2,3}-(?=\[redacted-account\])/g, severity: 'HIGH', desc: 'Raw branch prefix left beside a redacted account' },
  { id: 'json-mizrahi-reference', re: /\d(?<="MC\d{2}AsmEZ\\?"\s*:\s*\d)\d*/g, severity: 'HIGH', desc: 'Mizrahi movement reference number with a raw value' },
  { id: 'miz-reference-cell', re: /\d(?<=isCloseToZero\(dataItem\.MC\d{2}AsmEZ\)"[^>]*>\s*\d)\d*/g, severity: 'HIGH', desc: 'Rendered Mizrahi movement reference cell' },

  // --- Account / IBAN ---
  { id: 'il-iban', re: /\bIL\d{2}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{3,7}\b/g, severity: 'CRITICAL', desc: 'Israeli IBAN' },
  { id: 'il-bank-account', re: /\b\d{2,3}-\d{2,3}-\d{4,7}\b/g, severity: 'CRITICAL', desc: 'Hapoalim XX-XXX-XXXXXX account format' },
  { id: 'hapoalim-branch-account', re: /\b\d{3}[-\s]\d{6}\b/g, severity: 'CRITICAL', desc: 'Hapoalim 2-segment branch-account (XXX-XXXXXX or XXX XXXXXX)' },
  { id: 'json-account-number', re: /\\?"(?:accountNumber|accountId|customerAccountNumber|branchAccountNumber)\\?"\s*:\s*-?\d*[1-9]\d*/g, severity: 'CRITICAL', desc: 'JSON numeric account-id field with non-zero raw value' },
  { id: 'card-full-16', re: /(?<![\d.])\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}(?![\d.])/g, severity: 'CRITICAL', desc: 'Full 16-digit card number' },
  { id: 'card-masked-last4', re: /(?:\*{2,}|[xX]{2,}|\.{2,})\s*\d{4}\b/g, severity: 'HIGH', desc: 'Masked card last-4 (xxxx 1234)' },
  { id: 'israeli-id-9', re: /\b\d{9}\b/g, severity: 'HIGH', desc: 'Standalone 9-digit number (Israeli ID shape)' },

  // --- Contact ---
  { id: 'israeli-mobile', re: /\b05\d[-\s]?\d{7}\b/g, severity: 'CRITICAL', desc: 'Israeli mobile 05X-XXXXXXX' },
  { id: 'israeli-landline', re: /\b0[2-489][-\s]?\d{7}\b/g, severity: 'HIGH', desc: 'Israeli landline 0X-XXXXXXX' },
  { id: 'email', re: /[\w.+-]+@[\w-]+\.[\w.-]+/g, severity: 'CRITICAL', desc: 'Email address' },

  // --- Monetary ---
  { id: 'ils-prefix-amount', re: /(?:₪|NIS|ILS|ש"ח|ש״ח)\s*[-+]?\d[\d,]*(?:\.\d+)?/g, severity: 'HIGH', desc: 'ILS amount currency-PREFIX' },
  { id: 'ils-suffix-amount', re: /-?\d[\d,]*(?:\.\d+)?\s*(?:₪|NIS|ILS|ש"ח|ש״ח)/g, severity: 'HIGH', desc: 'ILS amount currency-SUFFIX' },
  { id: 'json-monetary-field', re: /\\?"\w*(?:Balance|Amount|Total|Sum|Withdrawal|Deposit|Credit|Debit|Charge|Payment|Cost|Price|Fee)\\?"\s*:\s*-?\d+(?:\.\d+)?/g, severity: 'HIGH', desc: 'JSON monetary field with raw numeric value' },
  { id: 'numeric-balance-span', re: /<span[^>]*class="[^"]*number-(?:negative|positive|strong|amount|value|balance)[^"]*"[^>]*>\s*-?\d[\d,]*(?:\.\d+)?\s*<\/span>/g, severity: 'HIGH', desc: 'Hapoalim balance span numeric' },
  { id: 'json-translit-money', re: new RegExp(String.raw`-?\d(?<=${TRANSLIT_MONEY_KEY_PREFIX}-?\d)\d*(?:\.\d+)?(?![\d.])|(?<=${TRANSLIT_MONEY_KEY_PREFIX}\\?")-?\d+(?:\.\d+)?(?=\\?")`, 'g'), severity: 'HIGH', desc: 'Transliterated Hebrew money field (Yitra/itra/schum/Remain/misgeret) with a non-zero value' },
  { id: 'miz-numeric-attr', re: /(?<=\smiz-numeric-[\w-]+=")-?\d[\d,]*(?:\.\d+)?(?=")/g, severity: 'HIGH', desc: 'Mizrahi miz-numeric-* attribute holding a rendered amount' },
  { id: 'miz-numeric-text', re: /-?\d(?<=miz-numeric-[\w-]+="[^"]*"[^>]*>\s*\u202A?-?\d)[\d,]*(?:\.\d+)?/g, severity: 'HIGH', desc: 'Rendered amount text inside a miz-numeric-* element' },
  { id: 'currency-amount-attr', re: new RegExp(String.raw`(?<=${SKY_CURRENCY_ATTR}(?=[\s=/])[^>]*\scurrency=")${PLAIN_AMOUNT}(?=")|(?<=\scurrency=")${PLAIN_AMOUNT}(?="[^>]*${SKY_CURRENCY_ATTR}[\s=>/])`, 'g'), severity: 'HIGH', desc: 'Rendered Mizrahi currency="<amount>" attribute' },

  // --- Tokens / secrets ---
  { id: 'bearer-token', re: /Bearer\s+[\w.~+/=-]{20,}/g, severity: 'CRITICAL', desc: 'Bearer auth token' },
  { id: 'jwt', re: /\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}\b/g, severity: 'CRITICAL', desc: 'JWT token' },
  { id: 'cookie-auth', re: /(?<=(?:Set-Cookie|cookie)[^\n]*?(?:auth|token|session)=(?:\\?")?)(?:[^;\s"\\]|\\(?!"))+/gi, severity: 'CRITICAL', desc: 'Cookie session/auth value' },
  { id: 'recaptcha-token', re: /<input[^>]*id="recaptcha-token"[^>]*value="(?!REDACTED_RECAPTCHA_TOKEN")[^"]+"/gi, severity: 'HIGH', desc: 'Unredacted recaptcha token' },
  { id: 'lsessionid-token', re: /LSESSIONID=(?!REDACTED_SESSION_ID(?![^&"'\s>]))[^&"'\s>]+/g, severity: 'CRITICAL', desc: 'Telebank session token in URL (LSESSIONID=...)' },
  { id: 'tracking-id-param', re: /[?&;]ti=\d{6,}/g, severity: 'HIGH', desc: 'Google-ads tracking-conversion ID (&ti=NNN)' },
  { id: 'tracking-id-asset-path', re: /_(?:tag_uet|p_action|action_\d+_ti|ti)_\d{6,}/g, severity: 'HIGH', desc: 'MS Clarity / Bing UET advertiser tag ID in asset filename' },
  { id: 'tracking-mid-asset-path', re: /_mid_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, severity: 'HIGH', desc: 'MS Clarity / Bing UET session UUID in asset filename (_mid_<uuid>)' },
  { id: 'tracking-sid-asset-path', re: /_sid_[0-9a-f]{15,}/gi, severity: 'HIGH', desc: 'MS Clarity / Bing UET session hex blob in asset filename (_sid_<hex>)' },
  { id: 'tel-link-redacted-id', re: /\btel:\[redacted-(?:id|landline|phone)\]/g, severity: 'HIGH', desc: 'Invalid tel: URI containing a redacted id or phone placeholder' },
  { id: 'prettier-corrupt-redacted-id', re: /\[redacted - id\]/g, severity: 'CRITICAL', desc: 'JS-breaking [redacted - id] (prettier-corrupted) — would throw ReferenceError' },
  { id: 'b64-embedded-ip', re: /(?<![\da-z+/])[\da-z+/]{56,76}={0,2}(?![\da-z+/=])/gi, severity: 'CRITICAL', desc: 'Base64 run decoding to <uuid>$<IPv4> (Radware bot token embeds the client IP)' },
  { id: 'client-ip-field', re: /[^\s"'\\,;<>](?<=\b(?:client_?ip|remote_?addr|ip_?address|user_?ip|x-forwarded-for|x-real-ip)\\?["']?\s*[:=]\s*\\?["']?.)[^\s"'\\,;<>]*(?:\s*,\s*[^\s"'\\,;<>]+)*/gi, severity: 'CRITICAL', desc: 'Client-address field value holding an IPv4 or IPv6 address (client_ip, x-forwarded-for)' },
  { id: 'radware-session-uuid', re: /[^'\r\n](?<=\bvar __uzdbm_\d+\s*=\s*'.)[^'\r\n]*/gi, severity: 'HIGH', desc: 'Radware per-session UUID anywhere in a __uzdbm_N value' },
  { id: 'request-verification-token', re: /(?<=name=\\?["']__RequestVerificationToken\\?["'][^>]*?value=\\?["'])[^"'\\]+(?=\\?["'])|(?<=value=\\?["'])[^"'\\]+(?=\\?["'][^>]*?name=\\?["']__RequestVerificationToken\\?["'])/gi, severity: 'HIGH', desc: 'Unredacted ASP.NET anti-forgery token' },
  { id: 'json-token-field', re: new RegExp(String.raw`"\w+Token\\?"\s*:\s*${notWholeValue(TOKEN_PLACEHOLDER_VALUES)}${jsonStringValue('{12,}')}`, 'g'), severity: 'CRITICAL', desc: 'JSON <prefix>Token field with a live value (xsrfToken)' },
  { id: 'json-action-guid', re: /(?<="actionGUID\\?"\s*:\s*\\?")[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, severity: 'HIGH', desc: 'Mizrahi paging GUID (server session handle)' },

  // --- Temporal personal info ---
  { id: 'last-login-text', re: /class="last-login"[^>]*>[^<]*?\d{1,2}\/\d{1,2}\/\d{2,4}[^<]*?\d{1,2}:\d{2}/g, severity: 'HIGH', desc: 'Last-login timestamp (Hebrew "ביקורך האחרון")' },
  { id: 'hebrew-last-login-label', re: /(?:כניסתך האחרונה|ביקורך האחרון)[^<]*?(?:<[^>]*>\s*)*\d{1,2}\/\d{1,2}\/\d{2,4}[\s,|]*\d{1,2}:\d{2}/g, severity: 'HIGH', desc: 'Last-login timestamp after its Hebrew label' },
  { id: 'json-last-login', re: new RegExp(String.raw`"(?:LastTimeVisited|TaarichPeulaAhrona|_LastTime\w*)\\?"\s*:\s*${notWholeValue(String.raw`\[redacted-last-login\]`)}${jsonStringValue()}`, 'g'), severity: 'HIGH', desc: 'JSON last-visit timestamp field' },

  // --- Already-redacted markers (NEGATIVE — informational only) ---
  { id: 'redacted-marker-name', re: /\[redacted-name\]/g, severity: 'INFO', desc: 'Already redacted name (good)' },
  { id: 'redacted-marker-account', re: /\[redacted-account\]/g, severity: 'INFO', desc: 'Already redacted account (good)' },
  { id: 'redacted-marker-amount', re: /\[redacted-amount\]/g, severity: 'INFO', desc: 'Already redacted amount (good)' },
  { id: 'redacted-marker-id', re: /\[redacted-id\](?!-\d+)/g, severity: 'INFO', desc: 'Already redacted id (good)' },
  { id: 'redacted-marker-unique-id', re: /\[redacted-id-\d+\]/g, severity: 'INFO', desc: 'Already redacted + uniquified id (good)' },
];

const SEV_ORDER = { CRITICAL: 0, HIGH: 1, INFO: 99 };
/** Most hit lines printed, and counted, per fixture. */
const MAX_HITS_PER_FILE = 15;
const FAIL_LINE = '\n❌ FAIL: PII detected in committed fixtures. Re-run redactor and re-audit.';
const PASS_LINE = '\n✅ PASS: no PII patterns detected.';

/**
 * List every auditable fixture file under a directory, recursively.
 *
 * @param {string} dir - Directory to walk; a missing one yields no files.
 * @returns {string[]} Absolute paths of the `.html`, `.json` and `.ndjson` files.
 */
function walkDir(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkDir(full));
    else if (/\.(html|json|ndjson)$/i.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * Single-line text around an offset, so the false-positive rules can judge
 * a hit by its neighbourhood. It is never printed.
 *
 * @param {string} text - Fixture contents.
 * @param {number} idx - Offset of the hit.
 * @param {number} [ctx] - Characters kept on each side.
 * @returns {string} The window, with line breaks folded to spaces.
 */
function snippet(text, idx, ctx = 50) {
  const s = Math.max(0, idx - ctx);
  const e = Math.min(text.length, idx + ctx);
  return text.slice(s, e).replace(/\r?\n/g, ' ');
}

/** True when a base64 run decodes to a payload carrying `$<IPv4>` — the
 *  shape of Radware's bot token, `base64(<uuid>$<ip>)`. Every other long
 *  alphanumeric run (bundle hashes, nonces) is a false positive. */
function decodesToEmbeddedIp(b64) {
  const decoded = Buffer.from(b64, 'base64').toString('latin1');
  return DECODED_EMBEDDED_IP.test(decoded);
}
/** True when a matched value has no non-zero digit (`0`, `-0.00`,
 *  `000000000`, `00-000-0000`) — mirrors isZeroValue in PiiRedactor.ts. */
function isZeroValue(value) {
  return !/[1-9]/.test(value);
}
/** True when a client-address value holds an address other than the
 *  all-zero placeholders PiiRedactor.ts writes. */
function hasRawClientAddress(value) {
  return [...value.matchAll(CLIENT_ADDRESS)].some(address => !CLIENT_IP_PLACEHOLDERS.has(address[0]));
}
/** True when a Radware `__uzdbm_N` value holds a UUID other than the
 *  all-zero GUID PiiRedactor.ts writes. */
function hasRawUuid(value) {
  return [...value.matchAll(UUID_GLOBAL)].some(uuid => uuid[0] !== ZERO_GUID);
}
// Only a match that IS a placeholder is safe. A placeholder after part of
// a raw value, or inside a wider match (`tel:[redacted-id]`), is a hit.
const PLACEHOLDER_MATCH = /^\[redacted-(name|account|amount|id|phone|landline|email|iban|jwt|cookie|bearer|last-login)\]$/;
/** Contexts in which a 16-digit run is a tracker, bot-manager,
 *  session-recorder or correlation id rather than a card number. */
const CARD_CTX_EXEMPT = [
  /facebook\.net|facebook\.com\\?\/tr|fbq\(|connect\.facebook|fbevents|googletagmanager|gtag\/js|google-analytics|googleadservices|googletag|vtp_pixelId|"pixelId"|fbPixelId/,
  /__uzdbm|__uzma|__uzmf|__uzmb|__uzmc|__uzmd|__uzme|_rbzid|_rbzsessionid|reblaze/i,
  /runcontext|d-c-id=|v-c-at=|x-c-id=|x-content-id=/i,
  /\\?"cls[sve]\\?"|\\?"clsid\\?"|glassbox|"sessionId"|"requestId"|"correlationId"|"traceId"|"transactionId"/i,
];
/** Contexts in which a 9-digit run is an ad-tag id or a phone link. */
const ID9_CTX_EXEMPT = [
  /googletagmanager|gtag\/js\?id=AW-|gtm\.js|google-analytics|googleadservices|AW-\d{9}|UA-\d{4,}|G-[A-Z0-9]{6,}/,
  /doubleclick\.net|viewthroughconversion|tag_exp=|dc_random=|dc_fmt=|gtm_ee=|gtm_ndx=/i,
  /href="tel:|tel:0\d{8,}/i,
];
/** Contexts in which a shekel amount is banner or marketing copy. */
const ILS_SUFFIX_CTX_EXEMPT = [
  /banner_|promo_|alt=['"]/i,
  /_atar_|_shivuki_|_marketing/i,
];

/** True when any regex in `list` matches `text`. None of them is global,
 *  so `test` keeps no state between calls. */
function anyMatch(list, text) {
  return list.some(re => re.test(text));
}
/** A 16-digit run is not a card in a known tracker context, after a hex
 *  id (`<hex>-<16 digits>`), or when it is the all-zero placeholder. */
function cardFull16Exemption(hit) {
  if (anyMatch(CARD_CTX_EXEMPT, hit.ctx)) return true;
  const masked = hit.ctx.replace(hit.match, '###');
  if (/\b[\da-f]{16,}-(?=\d{16}\b)/i.test(masked)) return true;
  return /^0000[-\s]?0000[-\s]?0000[-\s]?0000$/.test(hit.match);
}
/** A monetary JSON field is safe when the value after its last `:` is
 *  zero, which PiiRedactor.ts keeps. */
function monetaryZeroExemption(hit) {
  const colon = hit.match.lastIndexOf(':');
  const value = hit.match.slice(colon + 1);
  return isZeroValue(value);
}

/** Per-rule false-positive predicates. Each takes a hit and returns true
 *  when that hit is accepted as not personal data. A rule with no entry
 *  has no rule-specific exemption. */
const RULE_EXEMPTIONS = new Map([
  ['hebrew-greeting-name', hit => /<p[^>]*>\[redacted-name\]<\/p>$/.test(hit.match)],
  ['card-full-16', cardFull16Exemption],
  ['israeli-id-9', hit => anyMatch(ID9_CTX_EXEMPT, hit.ctx)],
  ['israeli-landline', hit => /href="tel:|tel:0\d{8,}/i.test(hit.ctx)],
  ['json-monetary-field', monetaryZeroExemption],
  // NOTE: unreachable today, since the rule's `\d{6,12}` never matches a
  // placeholder. Kept so this map changes no audit result.
  ['bare-account-in-url', hit => /\[redacted-account\]/.test(hit.match)],
  ['ils-suffix-amount', hit => anyMatch(ILS_SUFFIX_CTX_EXEMPT, hit.ctx)],
  ['b64-embedded-ip', hit => !decodesToEmbeddedIp(hit.match)],
  ['json-action-guid', hit => hit.match === ZERO_GUID],
  ['request-verification-token', hit => hit.match === RVT_PLACEHOLDER],
  ['client-ip-field', hit => !hasRawClientAddress(hit.match)],
  ['radware-session-uuid', hit => !hasRawUuid(hit.match)],
]);

/** Return true when a hit is a known false positive that the operator
 *  has accepted (already-redacted placeholder, zero value, public
 *  tracking ID, etc). Each rule's exemption lives in RULE_EXEMPTIONS, so
 *  adding one is a map entry rather than another branch here. */
function isFalsePositive(hit) {
  if (PLACEHOLDER_MATCH.test(hit.match)) return true;
  if (ZERO_VALUE_IDS.has(hit.pat.id) && isZeroValue(hit.match)) return true;
  const exemption = RULE_EXEMPTIONS.get(hit.pat.id);
  return exemption ? exemption(hit) : false;
}
/**
 * Audit one fixture's text against every pattern.
 *
 * @param {string} raw - Fixture contents.
 * @returns {{ pat: { id: string, severity: string }, match: string, at: number, ctx: string }[]}
 *   Hits that are not known false positives, INFO markers included.
 */
function auditText(raw) {
  const hits = [];
  for (const p of PATTERNS) {
    p.re.lastIndex = 0;
    let m;
    while ((m = p.re.exec(raw)) !== null) {
      const hit = { pat: p, match: m[0], at: m.index, ctx: snippet(raw, m.index, 80) };
      if (!isFalsePositive(hit)) hits.push(hit);
      if (m.index === p.re.lastIndex) p.re.lastIndex++;
    }
  }
  return hits;
}

/**
 * 1-based line and column of an offset. Only `\n` starts a line, so a CRLF
 * line keeps its `\r`; the column counts UTF-16 code units, as editors do.
 *
 * @param {string} raw - Fixture contents.
 * @param {number} at - Offset in `raw`.
 * @returns {string} The location as `line:column`.
 */
function lineCol(raw, at) {
  const before = raw.slice(0, at);
  const line = before.split('\n').length;
  return `${line}:${at - before.lastIndexOf('\n')}`;
}
/**
 * One report line for a hit: severity, rule id, location and match length.
 * The matched text and its context are never printed, because the hook
 * keeps this output in `.pre-commit-output.log`.
 *
 * @param {{ pat: { id: string, severity: string }, match: string, at: number }} hit - The hit.
 * @param {string} raw - Fixture contents the hit was found in.
 * @returns {string} The report line.
 */
function formatHit(hit, raw) {
  return `  [${hit.pat.severity}] ${hit.pat.id} at ${lineCol(raw, hit.at)} (len ${hit.match.length})`;
}
/**
 * Hits that fail the gate; INFO markers flag placeholders that are already safe.
 *
 * @param {{ pat: { severity: string } }[]} hits - Hits of one fixture.
 * @returns {{ pat: { severity: string } }[]} The CRITICAL and HIGH hits, in scan order.
 */
function reportableHits(hits) {
  return hits.filter(hit => hit.pat.severity !== 'INFO');
}
/**
 * The hits a fixture's report prints and the summary counts: CRITICAL first,
 * scan order kept within a severity, capped at {@link MAX_HITS_PER_FILE}.
 *
 * @param {{ pat: { severity: string } }[]} reportable - CRITICAL and HIGH hits of one fixture.
 * @returns {{ pat: { severity: string } }[]} At most MAX_HITS_PER_FILE hits.
 */
function topHits(reportable) {
  const sorted = [...reportable].sort((a, b) => SEV_ORDER[a.pat.severity] - SEV_ORDER[b.pat.severity]);
  return sorted.slice(0, MAX_HITS_PER_FILE);
}
/**
 * Report lines for one fixture: a header, one line per top hit and a count
 * of the hits left out.
 *
 * @param {string} rel - Fixture path relative to the repo root.
 * @param {string} raw - Fixture contents.
 * @param {{ pat: { id: string, severity: string }, match: string, at: number }[]} hits - Hits of the fixture.
 * @returns {string[]} The lines, or none when no CRITICAL or HIGH hit fired.
 */
function renderFileReport(rel, raw, hits) {
  const reportable = reportableHits(hits);
  if (reportable.length === 0) return [];
  const lines = [`\n=== ${rel} ===`, ...topHits(reportable).map(hit => formatHit(hit, raw))];
  const hidden = reportable.length - MAX_HITS_PER_FILE;
  if (hidden > 0) lines.push(`  ... and ${hidden} more`);
  return lines;
}
/**
 * Count the hits of one severity.
 *
 * @param {{ pat: { severity: string } }[]} hits - Hits to count.
 * @param {string} severity - Severity to match.
 * @returns {number} The count.
 */
function countSeverity(hits, severity) {
  return hits.filter(hit => hit.pat.severity === severity).length;
}
/**
 * Tally every fixture's top hits into the audit verdict.
 *
 * @param {{ pat: { severity: string } }[][]} hitLists - Hits of each fixture.
 * @returns {{ critical: number, high: number, filesWithHits: number, failed: boolean }}
 *   Counts within each fixture's top hits, and whether the gate fails.
 */
function summarizeReports(hitLists) {
  const tops = hitLists.map(hits => topHits(reportableHits(hits)));
  const critical = tops.reduce((sum, top) => sum + countSeverity(top, 'CRITICAL'), 0);
  const high = tops.reduce((sum, top) => sum + countSeverity(top, 'HIGH'), 0);
  const filesWithHits = tops.filter(top => top.length > 0).length;
  return { critical, high, filesWithHits, failed: critical > 0 || high > 0 };
}
/**
 * The summary block and verdict line printed after every fixture report.
 *
 * @param {number} fileCount - Number of fixtures scanned.
 * @param {{ critical: number, high: number, filesWithHits: number, failed: boolean }} summary - The tally.
 * @returns {string[]} The lines, ending with the FAIL or PASS verdict.
 */
function renderSummary(fileCount, summary) {
  return [
    '\n========== AUDIT SUMMARY ==========',
    `Files scanned: ${fileCount}`,
    `Files with PII hits: ${summary.filesWithHits}`,
    `CRITICAL hits (top ${MAX_HITS_PER_FILE}/file): ${summary.critical}`,
    `HIGH     hits (top ${MAX_HITS_PER_FILE}/file): ${summary.high}`,
    summary.failed ? FAIL_LINE : PASS_LINE,
  ];
}
/**
 * Audit one fixture file on disk and print its report.
 *
 * @param {string} file - Absolute fixture path.
 * @returns {{ pat: { id: string, severity: string }, match: string, at: number, ctx: string }[]} Its hits.
 */
function printFileReport(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const hits = auditText(raw);
  for (const line of renderFileReport(path.relative(ROOT, file), raw, hits)) console.log(line);
  return hits;
}
/** Audit every committed fixture; exit 2 when any CRITICAL or HIGH hit fires. */
function main() {
  const files = walkDir(FIXTURES);
  console.log(`Scanning ${files.length} fixture files under ${path.relative(ROOT, FIXTURES)}`);
  const summary = summarizeReports(files.map(file => printFileReport(file)));
  for (const line of renderSummary(files.length, summary)) console.log(line);
  if (summary.failed) process.exit(2);
}

module.exports = {
  auditText,
  formatHit,
  renderFileReport,
  summarizeReports,
  renderSummary,
  RULE_IDS: PATTERNS.map(p => p.id),
};

if (require.main === module) main();
