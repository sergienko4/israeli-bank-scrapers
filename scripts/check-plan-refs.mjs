#!/usr/bin/env node
/**
 * Fails when an added line cites an internal planning ID.
 *
 * Why this script exists: work planned in local, uncommitted plan files left
 * their item numbers, decision IDs, task numbers and section marks in
 * comments, test titles and docs. Those labels point at documents no reader
 * of the repo can open, so they explain nothing and go stale at once.
 *
 * The rule checks ADDED lines only, so lines already on the base branch never
 * fail it; a change that touches one of them is asked to drop the label. Each
 * family in `PLAN_REF_RULES` is narrow on purpose: a hex or URL escape, a
 * dashed rule name, a cookie name, a base64 run, a name being assigned, a
 * quoted error code or a token glued to a word in any script must never match.
 *
 * Usage:
 *   node scripts/check-plan-refs.mjs                  # staged additions
 *   BASE_SHA=<sha> node scripts/check-plan-refs.mjs   # additions since the merge base
 *
 * Exit codes:
 *   0  - no planning ID added
 *   1  - at least one added line cites a planning ID
 */
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

/** Word characters in any script, marks included, so a Hebrew word never ends in an ID. */
const WORD = String.raw`\p{L}\p{M}\p{N}_`;
/**
 * Characters that, right before an item number, make it part of a word, a
 * path, an escape or a `${...}` interpolation.
 */
const NOT_AFTER = String.raw`(?<![-${WORD}$#%./=&+])(?<!\$\{)`;
/** Characters that, right after one, make it part of a word or an assignment target. */
const NOT_BEFORE = String.raw`(?![-${WORD}+])(?!\s*=(?![=>]))`;
/** The item number itself: one to three digits behind its family letter. */
const ITEM = String.raw`(?:DN|N|E|D)\d{1,3}`;
/**
 * A whole `'...'` or `"..."` string holding only the token is a value, such
 * as an error code, unless it opens a call's arguments or a line, where test
 * titles go.
 */
const WHOLE_STRING = String.raw`(?:(?<!['"])${ITEM}|(?<=(?:\(|^)\s*['"])${ITEM}|${ITEM}(?!['"]))`;

/** The planning-ID families, one rule each. */
export const PLAN_REF_RULES = [
  { name: 'plan section mark', pattern: /\b(?:spec|plan)(?:\.md)?\s*§/i },
  {
    name: 'plan item number',
    pattern: new RegExp(`${NOT_AFTER}${WHOLE_STRING}${NOT_BEFORE}`, 'u'),
  },
  { name: 'plan decision ID', pattern: /\bAD(?:\d+|-[A-Z]\d*)\b(?!-)/ },
  { name: 'plan task number', pattern: /\b(?:M\d+\.T\d+|T\d+\.\d+)\b/ },
  { name: 'plan test ID', pattern: /\bSEC-\d{2}\b/ },
];

/**
 * Paths never scanned: captured pages, recorded answers and lockfiles carry
 * third-party text, the changelog is generated from commit subjects, and the
 * phase-7 map is a committed planning record.
 */
const SKIPPED_PATHS = [
  /(^|\/)fixtures?\//i,
  /\.(html|snap)$/,
  /(^|\/)package-lock\.json$/,
  /^CHANGELOG\.md$/,
  /^docs\/phase-7-consolidation-map\.md$/,
];

/**
 * Whether a path is outside the scan.
 * @param file Repo-relative path.
 * @returns True when the path is skipped.
 */
export function isSkipped(file) {
  return SKIPPED_PATHS.some(rule => rule.test(file));
}

/**
 * Names the first rule a line breaks.
 * @param line One added line, without its diff marker.
 * @returns The rule name, or null when the line is clean.
 */
export function ruleBrokenBy(line) {
  const hit = PLAN_REF_RULES.find(rule => rule.pattern.test(line));
  return hit ? hit.name : null;
}

/**
 * Opens a hunk: the header block is over and numbering restarts.
 * @param state Scan state.
 * @param line The `@@ -a,b +c,d @@` line.
 * @returns Nothing; the state is updated in place.
 */
function startHunk(state, line) {
  state.inHeader = false;
  state.lineNo = Number(/\+(\d+)/.exec(line)?.[1] ?? 0);
}

/** The escapes git writes inside a quoted path, beyond a literal character. */
const PATH_ESCAPES = { a: '\x07', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v' };

/**
 * Undoes one backslash escape from a quoted git path.
 * @param _match The whole escape.
 * @param octal Three octal digits, for a control character.
 * @param char The character after the backslash, otherwise.
 * @returns The character the escape stands for.
 */
function unescapeChar(_match, octal, char) {
  if (octal) return String.fromCharCode(Number.parseInt(octal, 8));
  return PATH_ESCAPES[char] ?? char;
}

/**
 * Reads the new-file path from a `+++` header line. Git ends a path that
 * holds a space with a tab, and quotes one that holds a quote or backslash.
 * @param line The `+++ b/<path>` line.
 * @returns The repo-relative path.
 */
function pathOf(line) {
  const raw = line.slice(4).replace(/\t$/, '');
  const unquoted = /^"(.*)"$/.exec(raw)?.[1].replace(/\\(?:([0-7]{3})|(.))/g, unescapeChar) ?? raw;
  return unquoted.replace(/^b\//, '');
}

/**
 * Checks one added line and advances the new-file line number.
 * @param state Scan state.
 * @param line The diff line, still carrying its `+` marker.
 * @returns Nothing; the state is updated in place.
 */
function readAdded(state, line) {
  const rule = isSkipped(state.file) ? null : ruleBrokenBy(line.slice(1));
  if (rule) state.found.push({ file: state.file, line: state.lineNo, rule });
  state.lineNo += 1;
}

/**
 * The diff line kinds that matter, tried in order. A `+++` line names the
 * file only inside a header, so an added line that itself opens with `++`
 * is still read as content.
 */
const LINE_KINDS = [
  {
    matches: (_state, line) => line.startsWith('diff --git '),
    apply: state => Object.assign(state, { inHeader: true }),
  },
  {
    matches: (state, line) => state.inHeader && line.startsWith('+++ '),
    apply: (state, line) => Object.assign(state, { file: pathOf(line) }),
  },
  { matches: (_state, line) => line.startsWith('@@'), apply: startHunk },
  { matches: (state, line) => !state.inHeader && line.startsWith('+'), apply: readAdded },
];

/**
 * Lists the added lines of a zero-context diff that cite a planning ID.
 * @param diff Output of `git diff --unified=0`.
 * @returns One finding per offending line.
 */
export function findPlanRefs(diff) {
  const state = { file: '', lineNo: 0, inHeader: false, found: [] };
  for (const line of diff.split('\n')) {
    LINE_KINDS.find(kind => kind.matches(state, line))?.apply(state, line);
  }
  return state.found;
}

/**
 * Reads the diff to scan: the merge-base range in CI, the index locally.
 * @returns Zero-context diff text.
 */
function readDiff() {
  const range = process.env.BASE_SHA ? [`${process.env.BASE_SHA}...HEAD`] : ['--cached'];
  const flags = ['--unified=0', '--no-color', '--no-ext-diff', '--find-renames'];
  const args = ['-c', 'core.quotePath=false', 'diff', ...flags, ...range];
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
}

/**
 * Prints every finding with a hint on how to fix it.
 * @param found Findings from `findPlanRefs`.
 * @returns Nothing.
 */
function report(found) {
  process.stderr.write('\n🛑 plan-refs: added lines cite IDs from local, uncommitted plans:\n');
  for (const hit of found) process.stderr.write(`   ${hit.file}:${hit.line}  (${hit.rule})\n`);
  process.stderr.write('\nSay what the code does instead of naming the plan item behind it.\n');
}

/**
 * Runs the gate and sets the exit code.
 * @returns Nothing.
 */
function main() {
  const found = findPlanRefs(readDiff());
  if (found.length === 0) {
    process.stdout.write('✅ plan-refs: no planning IDs in the added lines.\n');
    return;
  }
  report(found);
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main();
}
