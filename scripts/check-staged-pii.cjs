#!/usr/bin/env node
/* eslint-disable */
/**
 * Pre-commit guard — blocks staged content that re-introduces known real
 * account / card / API-key values that were scrubbed from git history
 * (PR #404 follow-up). The values live ONLY as sha256 hashes in
 * scripts/pii-denylist.sha256, so they are never re-committed in plaintext.
 *
 * Complements scripts/audit-fixtures-pii.cjs (which scans committed HTML/JSON
 * fixtures with regex patterns). This guard closes the gap that let real card
 * and account values into *.test.ts files: it scans the STAGED diff across
 * ALL file types and matches exact known values by hash.
 *
 * Token extraction is deliberately narrow to avoid false positives on
 * coincidental numbers:
 *   - quoted strings ('x' / "x") with inner length >= 3  (how PII appears
 *     in test files, e.g. cardSuffix: 'XXXX')
 *   - bare digit runs of length >= 6                      (account numbers)
 *   - long alphanumeric tokens of length >= 20            (API keys)
 * A bare 4-digit number is NOT checked, so ordinary constants never trip it.
 *
 * Exit 1 (blocks the commit) when any staged addition matches. Prints the
 * offending file(s) only — never the value.
 */
const { execSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DENYLIST_FILE = path.join(__dirname, 'pii-denylist.sha256');

/** Load the sha256 denylist (ignores comments / blank lines). */
function loadDenylist() {
  const raw = fs.readFileSync(DENYLIST_FILE, 'utf8');
  const hashes = raw
    .split('\n')
    .map((line) => line.split('#')[0].trim())
    .filter((line) => line.length === 64);
  return new Set(hashes);
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const QUOTED = /'([^']{3,})'|"([^"]{3,})"/g;
const BARE_NUMBER = /\b(\d{6,})\b/g;
const LONG_ALNUM = /\b([A-Za-z0-9_.-]{20,})\b/g;

/** Extract candidate PII tokens from a single added line. */
function candidateTokens(line) {
  const tokens = [];
  for (const re of [QUOTED, BARE_NUMBER, LONG_ALNUM]) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(line)) !== null) tokens.push(match[1] ?? match[2]);
  }
  return tokens;
}

/** Scan the staged additions and return the set of offending file paths. */
function findOffendingFiles(deny) {
  const diff = execSync('git diff --cached --unified=0', {
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
  });
  const offending = new Set();
  let file = '';
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ b/')) file = line.slice(6);
    else if (line.startsWith('+') && !line.startsWith('+++')) {
      for (const token of candidateTokens(line.slice(1))) {
        if (deny.has(sha256(token))) offending.add(file);
      }
    }
  }
  return [...offending];
}

function main() {
  const deny = loadDenylist();
  const offending = findOffendingFiles(deny);
  if (offending.length === 0) {
    console.log('✅ pii-denylist: no known real values in staged changes.');
    return;
  }
  console.error(
    '\n🛑 PII guard: staged changes re-introduce a known real ' +
      'account / card / API-key value in:',
  );
  for (const file of offending) console.error(`   ${file}`);
  console.error(
    '\nUse the normalized fake values (accounts 1000xx, cards 1111/2222/…,\n' +
      'API keys AIzaSy.EXAMPLE.REDACTED.FIXTURE). The real values were scrubbed\n' +
      'from history in PR #404 — see scripts/pii-denylist.sha256.\n',
  );
  process.exit(1);
}

main();
