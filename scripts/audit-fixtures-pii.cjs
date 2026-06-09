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

const PATTERNS = [
  // --- Customer identity (operator-specific literals loaded from .pii-secrets.json) ---
  { id: 'hebrew-greeting-name', re: />שלום\s*<\/h1>\s*<p[^>]*>([^<]+)<\/p>/g, severity: 'CRITICAL', desc: 'Hebrew greeting name <h1>שלום</h1><p>NAME</p>' },
  { id: 'hebrew-name-literal-surname', re: new RegExp(escapeRegexLiteral(SECRETS.hebrewSurnameLiteral), 'g'), severity: 'CRITICAL', desc: 'Literal operator surname leaked' },
  { id: 'hebrew-name-literal-given', re: new RegExp(alternation(SECRETS.hebrewGivenNameLiterals), 'g'), severity: 'CRITICAL', desc: 'Literal operator given name leaked' },
  { id: 'eng-name-literal', re: new RegExp(`\\b(${alternation(SECRETS.englishOperatorNames)})\\b`, 'gi'), severity: 'CRITICAL', desc: 'Literal operator name in English' },
  { id: 'username-literal', re: new RegExp(`\\b(${alternation(SECRETS.operatorUsernames)})\\b`, 'g'), severity: 'CRITICAL', desc: 'Literal credential/username leaked' },
  { id: 'operator-account-literal', re: new RegExp(`\\b${escapeRegexLiteral(SECRETS.operatorAccountLiteral)}\\b`, 'g'), severity: 'CRITICAL', desc: 'Operator account number literal' },
  { id: 'bare-account-in-url', re: /(?:\/(?:gatewayAPI|portalserver|api|Titan|Lobby|apollo|retail|retail2|rb)(?:\/[A-Za-z][\w.-]*)+\/)\d{6,12}(?=\/|\?|$|"|\\")/g, severity: 'CRITICAL', desc: 'Bare account-id in REST URL path' },

  // --- Account / IBAN ---
  { id: 'il-iban', re: /\bIL\d{2}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{3,7}\b/g, severity: 'CRITICAL', desc: 'Israeli IBAN' },
  { id: 'il-bank-account', re: /\b\d{2,3}-\d{2,3}-\d{4,7}\b/g, severity: 'CRITICAL', desc: 'Hapoalim XX-XXX-XXXXXX account format' },
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

  // --- Temporal personal info ---
  { id: 'last-login-text', re: /class="last-login"[^>]*>[^<]*?\d{1,2}\/\d{1,2}\/\d{2,4}[^<]*?\d{1,2}:\d{2}/g, severity: 'HIGH', desc: 'Last-login timestamp (Hebrew "ביקורך האחרון")' },

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

/** Return true when a hit is a known false positive that the operator
 *  has accepted (already-redacted placeholder, public tracking ID, etc).
 *  Centralised here so each pattern stays focused on detection and the
 *  "is this real PII?" decision is reviewable in one place. */
function isFalsePositive(hit) {
  const ctx = hit.ctx;
  if (/\[redacted-(name|account|amount|id|phone|landline|email|iban|jwt|cookie|bearer|last-login)\]/.test(hit.match)) return true;
  if (hit.pat.id === 'hebrew-greeting-name' && /\[redacted-name\]/.test(hit.match)) return true;
  if (hit.pat.id === 'card-full-16') {
    if (/facebook\.net|facebook\.com\/tr|fbq\(|connect\.facebook|fbevents|googletagmanager|gtag\/js|google-analytics|googleadservices|googletag/.test(ctx)) return true;
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
  return false;
}

function auditFile(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const hits = [];
  for (const p of PATTERNS) {
    p.re.lastIndex = 0;
    let m;
    while ((m = p.re.exec(raw)) !== null) {
      const hit = { pat: p, match: m[0].slice(0, 80), at: m.index, ctx: snippet(raw, m.index, 80) };
      if (!isFalsePositive(hit)) hits.push(hit);
      if (m.index === p.re.lastIndex) p.re.lastIndex++;
    }
  }
  return hits;
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
      console.log(`  ${tag}: "${hit.match}"  ctx: ...${hit.ctx}...`);
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

main();
