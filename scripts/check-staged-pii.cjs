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
 *
 * With `BASE_SHA` set it scans the pull request's additions instead
 * (`git diff BASE_SHA...HEAD`), which is how CI runs it: the hook only sees
 * what is staged, so a commit made with the hook skipped needs this second
 * look before it can merge.
 */
const { execFileSync } = require('node:child_process');
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

/** A full or abbreviated commit id; anything else is refused, never passed to git. */
const COMMIT_ID = /^[0-9a-f]{7,40}$/i;

/**
 * The `git` arguments for the additions to scan: the staged index, or the
 * pull request range when a base commit is given.
 */
function diffArgs(baseSha) {
  if (!baseSha) return ['diff', '--cached', '--unified=0'];
  if (!COMMIT_ID.test(baseSha)) return null;
  return ['diff', '--unified=0', `${baseSha}...HEAD`];
}

/** Return the set of file paths whose added lines carry a denylisted value. */
function findOffendingFiles(deny, diff) {
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
  const baseSha = process.env.BASE_SHA ?? '';
  const args = diffArgs(baseSha);
  if (args === null) {
    console.error('🛑 PII guard: BASE_SHA is not a commit id.');
    process.exit(2);
  }
  const scope = baseSha ? `changes since ${baseSha}` : 'staged changes';
  const diff = execFileSync('git', args, { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
  const offending = findOffendingFiles(loadDenylist(), diff);
  if (offending.length === 0) {
    console.log(`✅ pii-denylist: no known real values in ${scope}.`);
    return;
  }
  console.error(
    `\n🛑 PII guard: ${scope} re-introduce a known real ` +
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

module.exports = { diffArgs, findOffendingFiles };

if (require.main === module) main();
