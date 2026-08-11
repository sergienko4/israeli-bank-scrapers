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
 * by a `compatibility.json` change. It does not try to judge whether the
 * note is *good* - only that the author was forced to write one.
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
import { env, exit, stderr, stdout } from 'node:process';

const NOTE_FILE = 'compatibility.json';
/** Conventional-commit bang form, e.g. `feat(api)!: drop x`. */
const BANG = /^[a-z]+(\([^)]*\))?!:/im;

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
 * Identifies commits that declare a breaking change.
 * @param messages Full commit messages.
 * @returns Subject lines of the breaking commits.
 */
function findBreaking(messages) {
  const isBreaking = (m) => BANG.test(m) || /^BREAKING[ -]CHANGE:/im.test(m);
  return messages.filter(isBreaking).map((m) => m.split('\n')[0]);
}

/**
 * Reports whether the PR touches the compatibility data file.
 * @param base Merge-base sha.
 * @returns True when the note file changed.
 */
function hasNote(base) {
  return git(['diff', '--name-only', `${base}...HEAD`]).split('\n').includes(NOTE_FILE);
}

/**
 * Prints the failure explanation and exits non-zero.
 * @param subjects Breaking commit subjects.
 */
function fail(subjects) {
  stderr.write(`Breaking change detected, but ${NOTE_FILE} was not updated:\n`);
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

main();
