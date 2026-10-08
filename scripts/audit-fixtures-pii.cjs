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
 * Zero trust: prints EVERY hit so the operator can verify nothing leaked.
 * Exits non-zero when any pattern fires.
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
/** The whole base64-decoded Radware bot token: `<uuid>$<IPv4>`. */
const DECODED_EMBEDDED_IP = new RegExp(String.raw`^[\da-z]{8}(?:-[\da-z]{4}){3}-[\da-z]{12}\$${IPV4}$`, 'i');
/** Mirrors SKY_CURRENCY_ATTR / PLAIN_AMOUNT in PiiRedactor.ts. */
const SKY_CURRENCY_ATTR = String.raw`\s(?:sky-currency|sky-on-currency-change)`;
const PLAIN_AMOUNT = String.raw`-?\d[\d,]*(?:\.\d+)?`;
const ZERO_GUID = '00000000-0000-0000-0000-000000000000';
/** Mirrors PERSON_NAME_KEYS / TOKEN_PLACEHOLDER_VALUES in PiiRedactor.ts. */
const PERSON_NAME_KEYS = String.raw`partyFullName|partyFirstName|partyLastName|partyMiddleName|customerName|customerFullName|customerFirstName|customerLastName|userName|userFullName|firstName|lastName|fullName|middleName|FirstName|LastName|BankerName`;
const TOKEN_PLACEHOLDER_VALUES = String.raw`\[redacted-[a-z-]+\]|FIXTURE-MAX-SESSION-A`;
/** The exact anti-forgery placeholder PiiRedactor.ts writes; only this
 *  value is exempt, never anything that merely starts with `REDACTED_`. */
const RVT_PLACEHOLDER = 'REDACTED_REQUEST_VERIFICATION_TOKEN';
/** Rules that capture only an amount or reference; a zero value is the
 *  redacted sentinel, so it is not a hit. Tested in JS rather than with
 *  overlapping quantifiers, which backtrack on long near-misses. */
const ZERO_VALUE_IDS = new Set([
  'json-translit-money',
  'miz-numeric-attr',
  'miz-numeric-text',
  'currency-amount-attr',
  'json-mizrahi-reference',
  'miz-reference-cell',
]);

const PATTERNS = [
  // --- Customer identity (operator-specific literals loaded from .pii-secrets.json) ---
  { id: 'hebrew-greeting-name', re: />שלום\s*<\/h1>\s*<p[^>]*>([^<]+)<\/p>/g, severity: 'CRITICAL', desc: 'Hebrew greeting name <h1>שלום</h1><p>NAME</p>' },
  { id: 'hebrew-name-literal-surname', re: new RegExp(escapeRegexLiteral(SECRETS.hebrewSurnameLiteral), 'g'), severity: 'CRITICAL', desc: 'Literal operator surname leaked' },
  { id: 'hebrew-name-literal-given', re: new RegExp(alternation(SECRETS.hebrewGivenNameLiterals), 'g'), severity: 'CRITICAL', desc: 'Literal operator given name leaked' },
  { id: 'eng-name-literal', re: new RegExp(`\\b(${alternation(SECRETS.englishOperatorNames)})\\b`, 'gi'), severity: 'CRITICAL', desc: 'Literal operator name in English' },
  { id: 'username-literal', re: new RegExp(`\\b(${alternation(SECRETS.operatorUsernames)})\\b`, 'g'), severity: 'CRITICAL', desc: 'Literal credential/username leaked' },
  { id: 'operator-account-literal', re: new RegExp(`\\b${escapeRegexLiteral(SECRETS.operatorAccountLiteral)}\\b`, 'g'), severity: 'CRITICAL', desc: 'Operator account number literal' },
  { id: 'bare-account-in-url', re: /(?:\/(?:gatewayAPI|portalserver|api|Titan|Lobby|apollo|retail|retail2|rb)(?:\/[A-Za-z][\w.-]*)+\/)\d{6,12}(?=\/|\?|$|"|\\")/g, severity: 'CRITICAL', desc: 'Bare account-id in REST URL path' },
  { id: 'json-person-name-field', re: new RegExp(String.raw`\\?"(?:${PERSON_NAME_KEYS})\\?"\s*:\s*\\?"(?!\[redacted-name\]\\?")[^"\\]+`, 'g'), severity: 'CRITICAL', desc: 'JSON person-name field with raw value' },
  { id: 'json-opaque-user-id', re: /\\?"(?:UserId|Username|UserIdentifier|ClientGWIdentifier|anonymousID)\\?"\s*:\s*\\?"(?!\[redacted-user-id\]\\?")[^"\\]+/g, severity: 'CRITICAL', desc: 'JSON per-user identifier field with raw value' },
  { id: 'glassbox-user-id', re: /data[.-]glassbox-id="(?!\[redacted-user-id\]")[^"]+"/g, severity: 'CRITICAL', desc: 'Glassbox session-replay user id attribute' },
  { id: 'role-embedded-account', re: /\bAC_\d{5,}_/g, severity: 'CRITICAL', desc: 'Account number embedded in permission role (AC_<account>_...)' },
  { id: 'json-branch-field', re: /"Branch(?:ForDispaly|ForDisplay|ForMF)?\\?"\s*:\s*\\?"(?!000\\?")\d{2,3}(?=\\?")/g, severity: 'HIGH', desc: 'JSON branch-number field with a raw value (Mizrahi)' },
  { id: 'branch-before-redacted-account', re: /\b(?!000-)\d{2,3}-(?=\[redacted-account\])/g, severity: 'HIGH', desc: 'Raw branch prefix left beside a redacted account' },
  { id: 'json-mizrahi-reference', re: /(?<="MC\d{2}AsmEZ\\?"\s*:\s*)\d+/g, severity: 'HIGH', desc: 'Mizrahi movement reference number with a raw value' },
  { id: 'miz-reference-cell', re: /(?<=isCloseToZero\(dataItem\.MC\d{2}AsmEZ\)"[^>]*>\s*)\d+/g, severity: 'HIGH', desc: 'Rendered Mizrahi movement reference cell' },

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
  { id: 'json-monetary-field', re: /"\w*(?:Balance|Amount|Total|Sum|Withdrawal|Deposit|Credit|Debit|Charge|Payment|Cost|Price|Fee)"\s*:\s*-?\d+(?:\.\d+)?/g, severity: 'HIGH', desc: 'JSON monetary field with raw numeric value' },
  { id: 'numeric-balance-span', re: /<span[^>]*class="[^"]*number-(?:negative|positive|strong|amount|value|balance)[^"]*"[^>]*>\s*-?\d[\d,]*(?:\.\d+)?\s*<\/span>/g, severity: 'HIGH', desc: 'Hapoalim balance span numeric' },
  { id: 'json-translit-money', re: new RegExp(String.raw`(?<=${TRANSLIT_MONEY_KEY_PREFIX})-?\d+(?:\.\d+)?(?![\d.])|(?<=${TRANSLIT_MONEY_KEY_PREFIX}\\?")-?\d+(?:\.\d+)?(?=\\?")`, 'g'), severity: 'HIGH', desc: 'Transliterated Hebrew money field (Yitra/itra/schum/Remain/misgeret) with a non-zero value' },
  { id: 'miz-numeric-attr', re: /(?<=\smiz-numeric-[\w-]+=")-?\d[\d,]*(?:\.\d+)?(?=")/g, severity: 'HIGH', desc: 'Mizrahi miz-numeric-* attribute holding a rendered amount' },
  { id: 'miz-numeric-text', re: /(?<=miz-numeric-[\w-]+="[^"]*"[^>]*>\s*\u202A?)-?\d[\d,]*(?:\.\d+)?/g, severity: 'HIGH', desc: 'Rendered amount text inside a miz-numeric-* element' },
  { id: 'currency-amount-attr', re: new RegExp(String.raw`(?<=${SKY_CURRENCY_ATTR}(?=[\s=/])[^>]*\scurrency=")${PLAIN_AMOUNT}(?=")|(?<=\scurrency=")${PLAIN_AMOUNT}(?="[^>]*${SKY_CURRENCY_ATTR}[\s=>/])`, 'g'), severity: 'HIGH', desc: 'Rendered Mizrahi currency="<amount>" attribute' },

  // --- Tokens / secrets ---
  { id: 'bearer-token', re: /Bearer\s+[\w.~+/=-]{20,}/g, severity: 'CRITICAL', desc: 'Bearer auth token' },
  { id: 'jwt', re: /\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}\b/g, severity: 'CRITICAL', desc: 'JWT token' },
  { id: 'cookie-auth', re: /(?:Set-Cookie|cookie)[^\n]*?(?:auth|token|session)=[^;\s"]+/gi, severity: 'CRITICAL', desc: 'Cookie session/auth value' },
  { id: 'recaptcha-token', re: /<input[^>]*id="recaptcha-token"[^>]*value="(?!REDACTED_)[^"]+"/gi, severity: 'HIGH', desc: 'Unredacted recaptcha token' },
  { id: 'lsessionid-token', re: /LSESSIONID=(?!REDACTED_)[A-Za-z0-9%+/=._-]{12,}/g, severity: 'CRITICAL', desc: 'Telebank session token in URL (LSESSIONID=...)' },
  { id: 'tracking-id-param', re: /[?&;]ti=\d{6,}/g, severity: 'HIGH', desc: 'Google-ads tracking-conversion ID (&ti=NNN)' },
  { id: 'tracking-id-asset-path', re: /_(?:tag_uet|p_action|action_\d+_ti|ti)_\d{6,}/g, severity: 'HIGH', desc: 'MS Clarity / Bing UET advertiser tag ID in asset filename' },
  { id: 'tracking-mid-asset-path', re: /_mid_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, severity: 'HIGH', desc: 'MS Clarity / Bing UET session UUID in asset filename (_mid_<uuid>)' },
  { id: 'tracking-sid-asset-path', re: /_sid_[0-9a-f]{15,}/gi, severity: 'HIGH', desc: 'MS Clarity / Bing UET session hex blob in asset filename (_sid_<hex>)' },
  { id: 'tel-link-redacted-id', re: /\btel:\[redacted-id\]/g, severity: 'HIGH', desc: 'Invalid tel: URI containing redacted-id placeholder' },
  { id: 'prettier-corrupt-redacted-id', re: /\[redacted - id\]/g, severity: 'CRITICAL', desc: 'JS-breaking [redacted - id] (prettier-corrupted) — would throw ReferenceError' },
  { id: 'b64-embedded-ip', re: /(?<![\da-z+/])[\da-z+/]{56,76}={0,2}(?![\da-z+/=])/gi, severity: 'CRITICAL', desc: 'Base64 run decoding to <uuid>$<IPv4> (Radware bot token embeds the client IP)' },
  { id: 'client-ip-field', re: new RegExp(String.raw`(?<=\b(?:client_?ip|remote_?addr|ip_?address|user_?ip|x-forwarded-for|x-real-ip)\\?["']?\s*[:=]\s*\\?["'])${IPV4}(?=\\?["'])`, 'gi'), severity: 'CRITICAL', desc: 'IPv4 in a client-address field (client_ip, x-forwarded-for)' },
  { id: 'radware-session-uuid', re: /var __uzdbm_\d+\s*=\s*'(?!00000000-0000-0000-0000-000000000000')[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'/gi, severity: 'HIGH', desc: 'Radware per-session UUID (__uzdbm_N)' },
  { id: 'request-verification-token', re: /(?<=name=\\?["']__RequestVerificationToken\\?["'][^>]*?value=\\?["'])[^"'\\]+(?=\\?["'])|(?<=value=\\?["'])[^"'\\]+(?=\\?["'][^>]*?name=\\?["']__RequestVerificationToken\\?["'])/gi, severity: 'HIGH', desc: 'Unredacted ASP.NET anti-forgery token' },
  { id: 'json-token-field', re: new RegExp(String.raw`"\w+Token\\?"\s*:\s*\\?"(?!(?:${TOKEN_PLACEHOLDER_VALUES})\\?")[^"\\]{12,}(?=\\?")`, 'g'), severity: 'CRITICAL', desc: 'JSON <prefix>Token field with a live value (xsrfToken)' },
  { id: 'json-action-guid', re: /(?<="actionGUID\\?"\s*:\s*\\?")[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, severity: 'HIGH', desc: 'Mizrahi paging GUID (server session handle)' },

  // --- Temporal personal info ---
  { id: 'last-login-text', re: /class="last-login"[^>]*>[^<]*?\d{1,2}\/\d{1,2}\/\d{2,4}[^<]*?\d{1,2}:\d{2}/g, severity: 'HIGH', desc: 'Last-login timestamp (Hebrew "ביקורך האחרון")' },
  { id: 'hebrew-last-login-label', re: /(?:כניסתך האחרונה|ביקורך האחרון)[^<]*?(?:<[^>]*>\s*)*\d{1,2}\/\d{1,2}\/\d{2,4}[\s,|]*\d{1,2}:\d{2}/g, severity: 'HIGH', desc: 'Last-login timestamp after its Hebrew label' },
  { id: 'json-last-login', re: /"(?:LastTimeVisited|TaarichPeulaAhrona|_LastTime\w*)\\?"\s*:\s*\\?"(?!\[redacted-last-login\]\\?")[^"\\]+/g, severity: 'HIGH', desc: 'JSON last-visit timestamp field' },

  // --- Already-redacted markers (NEGATIVE — informational only) ---
  { id: 'redacted-marker-name', re: /\[redacted-name\]/g, severity: 'INFO', desc: 'Already redacted name (good)' },
  { id: 'redacted-marker-account', re: /\[redacted-account\]/g, severity: 'INFO', desc: 'Already redacted account (good)' },
  { id: 'redacted-marker-amount', re: /\[redacted-amount\]/g, severity: 'INFO', desc: 'Already redacted amount (good)' },
  { id: 'redacted-marker-id', re: /\[redacted-id\](?!-\d+)/g, severity: 'INFO', desc: 'Already redacted id (good)' },
  { id: 'redacted-marker-unique-id', re: /\[redacted-id-\d+\]/g, severity: 'INFO', desc: 'Already redacted + uniquified id (good)' },
];

const SEV_ORDER = { CRITICAL: 0, HIGH: 1, INFO: 99 };

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
/** True when a captured amount or reference is zero (`0`, `-0.00`, `0,000`). */
function isZeroValue(value) {
  return Number(value.replace(/,/g, '')) === 0;
}
/** Return true when a hit is a known false positive that the operator
 *  has accepted (already-redacted placeholder, public tracking ID, etc).
 *  Centralised here so each pattern stays focused on detection and the
 *  "is this real PII?" decision is reviewable in one place. */
function isFalsePositive(hit) {
  const ctx = hit.ctx;
  // Only a match whose sensitive tail IS a placeholder is safe; a placeholder
  // elsewhere in a wide match must not hide an unredacted value beside it.
  if (/\[redacted-(name|account|amount|id|phone|landline|email|iban|jwt|cookie|bearer|last-login)\]$/.test(hit.match)) return true;
  if (hit.pat.id === 'hebrew-greeting-name' && /\[redacted-name\]/.test(hit.match)) return true;
  if (hit.pat.id === 'card-full-16') {
    if (/facebook\.net|facebook\.com\\?\/tr|fbq\(|connect\.facebook|fbevents|googletagmanager|gtag\/js|google-analytics|googleadservices|googletag|vtp_pixelId|"pixelId"|fbPixelId/.test(ctx)) return true;
    if (/__uzdbm|__uzma|__uzmf|__uzmb|__uzmc|__uzmd|__uzme|_rbzid|_rbzsessionid|reblaze/i.test(ctx)) return true;
    if (/runcontext|d-c-id=|v-c-at=|x-c-id=|x-content-id=/i.test(ctx)) return true;
    if (/\\?"cls[sve]\\?"|\\?"clsid\\?"|glassbox|"sessionId"|"requestId"|"correlationId"|"traceId"|"transactionId"/i.test(ctx)) return true;
    if (/\b[\da-f]{16,}-(?=\d{16}\b)/i.test(ctx.replace(hit.match, '###'))) return true;
    if (/^0000[-\s]?0000[-\s]?0000[-\s]?0000$/.test(hit.match)) return true;
  }
  if (hit.pat.id === 'israeli-id-9') {
    if (/googletagmanager|gtag\/js\?id=AW-|gtm\.js|google-analytics|googleadservices|AW-\d{9}|UA-\d{4,}|G-[A-Z0-9]{6,}/.test(ctx)) return true;
    if (/^0{9}$/.test(hit.match)) return true;
    if (/doubleclick\.net|viewthroughconversion|tag_exp=|dc_random=|dc_fmt=|gtm_ee=|gtm_ndx=/i.test(ctx)) return true;
    if (/href="tel:|tel:0\d{8,}/i.test(ctx)) return true;
  }
  if (hit.pat.id === 'israeli-landline' && /href="tel:|tel:0\d{8,}/i.test(ctx)) return true;
  if (hit.pat.id === 'il-bank-account') {
    if (/^00-00-00/.test(hit.match) || /^000-000-/.test(hit.match)) return true;
  }
  if (hit.pat.id === 'json-monetary-field') {
    if (/:\s*-?0(\.0+)?$/.test(hit.match)) return true;
  }
  if (hit.pat.id === 'bare-account-in-url') {
    if (/\[redacted-account\]/.test(hit.match)) return true;
  }
  if (hit.pat.id === 'ils-suffix-amount') {
    if (/banner_|promo_|alt=['"]/i.test(ctx)) return true;
    if (/_atar_|_shivuki_|_marketing/i.test(ctx)) return true;
  }
  if (hit.pat.id === 'last-login-text' && /\[redacted-last-login\]/.test(hit.ctx)) return true;
  if (hit.pat.id === 'b64-embedded-ip' && !decodesToEmbeddedIp(hit.match)) return true;
  if (ZERO_VALUE_IDS.has(hit.pat.id) && isZeroValue(hit.match)) return true;
  if (hit.pat.id === 'json-action-guid' && hit.match === ZERO_GUID) return true;
  if (hit.pat.id === 'request-verification-token' && hit.match === RVT_PLACEHOLDER) return true;
  if (hit.pat.id === 'client-ip-field' && hit.match === '0.0.0.0') return true;
  return false;
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

/** Audit one fixture file on disk. */
function auditFile(file) {
  return auditText(fs.readFileSync(file, 'utf8'));
}

function main() {
  const files = walkDir(FIXTURES);
  console.log(`Scanning ${files.length} fixture files under ${path.relative(ROOT, FIXTURES)}`);
  let critical = 0;
  let high = 0;
  const fileSummary = {};
  for (const f of files) {
    const hits = auditFile(f);
    if (hits.length === 0) continue;
    const rel = path.relative(ROOT, f);
    const interesting = hits.filter((h) => h.pat.severity !== 'INFO');
    if (interesting.length === 0) {
      fileSummary[rel] = { c: 0, h: 0, ok: true };
      continue;
    }
    fileSummary[rel] = { c: 0, h: 0, ok: false };
    interesting.sort((a, b) => SEV_ORDER[a.pat.severity] - SEV_ORDER[b.pat.severity]);
    console.log(`\n=== ${rel} ===`);
    for (const hit of interesting.slice(0, 15)) {
      const tag = `[${hit.pat.severity}] ${hit.pat.id}`;
      console.log(`  ${tag}: "${hit.match.slice(0, 80)}"  ctx: ...${hit.ctx}...`);
      if (hit.pat.severity === 'CRITICAL') {
        critical++;
        fileSummary[rel].c++;
      }
      if (hit.pat.severity === 'HIGH') {
        high++;
        fileSummary[rel].h++;
      }
    }
    if (interesting.length > 15) console.log(`  ... and ${interesting.length - 15} more`);
  }
  console.log(`\n========== AUDIT SUMMARY ==========`);
  console.log(`Files scanned: ${files.length}`);
  console.log(`Files with PII hits: ${Object.values(fileSummary).filter((v) => !v.ok).length}`);
  console.log(`CRITICAL hits (top 15/file): ${critical}`);
  console.log(`HIGH     hits (top 15/file): ${high}`);
  if (critical > 0 || high > 0) {
    console.log(`\n❌ FAIL: PII detected in committed fixtures. Re-run redactor and re-audit.`);
    process.exit(2);
  }
  console.log(`\n✅ PASS: no PII patterns detected.`);
}

module.exports = { auditText };

if (require.main === module) main();
