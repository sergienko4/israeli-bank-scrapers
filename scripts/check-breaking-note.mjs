#!/usr/bin/env node
/**
 * Fails a PR that introduces a breaking change without recording how to
 * migrate.
 *
 * Why this script exists: in 8.3.0 the `OneZeroScraper` export was removed
 * and shipped on a MINOR bump with no breaking-change footer and no
 * migration note, so consumers importing that class broke on a routine
 * upgrade. Reviewers cannot reliably spot that by eye; this makes the
 * omission mechanical.
 *
 * The rule is deliberately narrow: a breaking commit must be accompanied
 * by an added or edited entry in `compatibility.json`. It does not try to
 * judge whether the note is *good* - only that the author was forced to
 * write one.
 *
 * Usage:
 *   BASE_SHA=<sha> node scripts/check-breaking-note.mjs
 *
 * Exit codes:
 *   0  - no breaking change, or a breaking change with a note
 *   1  - breaking change with no compatibility.json entry
 *   2  - usage error (no base ref available)
 */
import { execFileSync } from 'node:child_process';
import { argv, env, exit, stderr, stdout } from 'node:process';
import { pathToFileURL } from 'node:url';

const NOTE_FILE = 'compatibility.json';
/**
 * Conventional-commit bang form, e.g. `feat(api)!: drop x`.
 *
 * Deliberately NOT multiline-anchored. It is tested against the subject
 * line alone, because a commit *body* that quotes the syntax (a doc
 * commit explaining `feat!:`, say) is not itself a breaking change.
 */
const BANG = /^[a-z]+(\([^)]*\))?!:/i;
/** Conventional-commit breaking footer token, matched per footer line. */
const BREAKING_FOOTER = /^BREAKING[ -]CHANGE:/im;
/**
 * Git trailer / conventional footer token, e.g. `Reviewed-by:`, `Refs #12`.
 * Tokens are single words, which is what separates a real footer from a
 * prose line that happens to contain a colon.
 */
const FOOTER_TOKEN = /^(BREAKING[ -]CHANGE|[A-Za-z][A-Za-z-]*)(: | #)/;

/**
 * Runs a git command and returns trimmed stdout.
 * @param args Git arguments.
 * @returns Command output.
 */
function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

/**
 * Resolves the merge base between the PR base and HEAD.
 * @returns Merge-base sha.
 */
function resolveBase() {
  const base = env.BASE_SHA;
  if (!base) return null;
  try {
    return git(['merge-base', base, 'HEAD']);
  } catch {
    return base;
  }
}

/**
 * Collects commit messages in the range, separated by NUL.
 * @param base Merge-base sha.
 * @returns Array of full commit messages.
 */
function commitsSince(base) {
  const raw = git(['log', '--format=%B%x00', `${base}..HEAD`]);
  return raw.split('\0').map((m) => m.trim()).filter(Boolean);
}

/**
 * Splits a commit message into trimmed, non-empty paragraphs.
 * @param message Full commit message.
 * @returns Paragraph list, subject first.
 */
export function paragraphs(message) {
  return message
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * Extracts the trailing footer block of a commit message.
 *
 * Walks paragraphs from the end while each still opens with a footer
 * token, so `BREAKING CHANGE:` is only honoured where the Conventional
 * Commits spec puts it. Prose that merely mentions the token - this
 * repo's own docs about the checker, for instance - stops the walk and
 * is never treated as a declaration. The subject is never a footer.
 * @param message Full commit message.
 * @returns Footer text, empty when the commit has none.
 */
export function footerOf(message) {
  const paras = paragraphs(message);
  let start = paras.length;
  while (start > 1 && FOOTER_TOKEN.test(paras[start - 1])) start -= 1;
  return paras.slice(start).join('\n');
}

/**
 * Identifies commits that declare a breaking change.
 *
 * The bang form is matched against the subject only: a body quoting
 * `feat!:` is documentation, not a breaking change.
 * @param messages Full commit messages.
 * @returns Subject lines of the breaking commits.
 */
export function findBreaking(messages) {
  const isBreaking = (m) => BANG.test(m.split('\n')[0]) || BREAKING_FOOTER.test(footerOf(m));
  return messages.filter(isBreaking).map((m) => m.split('\n')[0]);
}

/**
 * Reads the compatibility entries as they stand at a git ref.
 * @param ref Git ref to read the data file from.
 * @returns Entry list, empty when the file is absent or unparseable.
 */
function entriesAt(ref) {
  try {
    return JSON.parse(git(['show', `${ref}:${NOTE_FILE}`])).entries ?? [];
  } catch {
    return [];
  }
}

/**
 * Reports whether the PR adds or edits a real compatibility entry.
 *
 * Comparing parsed entries rather than the file path is what makes the
 * gate meaningful: a whitespace-only edit, a change confined to the
 * `runtime` block, or a deletion all touch `compatibility.json` while
 * documenting nothing, and each used to satisfy the check.
 *
 * One entry can legitimately cover several breaking commits in the same
 * release, so this deliberately requires *an* entry rather than one per
 * commit.
 * @param base Merge-base sha.
 * @returns True when an entry was added or changed.
 */
function hasNote(base) {
  const before = new Map(entriesAt(base).map((e) => [e.version, JSON.stringify(e)]));
  return entriesAt('HEAD').some((e) => before.get(e.version) !== JSON.stringify(e));
}

/**
 * Prints the failure explanation and exits non-zero.
 * @param subjects Breaking commit subjects.
 */
function fail(subjects) {
  stderr.write(`Breaking change detected, but ${NOTE_FILE} has no new entry:\n`);
  subjects.forEach((s) => stderr.write(`  - ${s}\n`));
  stderr.write(`\nAdd an entry to ${NOTE_FILE} describing what breaks and how to\n`);
  stderr.write('migrate, then run `npm run compat:build`.\n');
  exit(1);
}

/** Entry point: detect breaking commits, then require a note. */
function main() {
  const base = resolveBase();
  if (!base) {
    stderr.write('usage: BASE_SHA=<sha> node scripts/check-breaking-note.mjs\n');
    exit(2);
  }
  const breaking = findBreaking(commitsSince(base));
  if (breaking.length === 0) return stdout.write('no breaking changes in this range\n');
  if (!hasNote(base)) fail(breaking);
  stdout.write(`breaking change documented in ${NOTE_FILE}\n`);
}

// Only run the CLI when invoked directly, so the pure helpers above can be
// imported by tests without the process exiting on a missing BASE_SHA.
if (argv[1] && import.meta.url === pathToFileURL(argv[1]).href) {
  main();
}
