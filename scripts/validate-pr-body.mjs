#!/usr/bin/env node
/**
 * Local mirror of `.github/workflows/pr-body-check.yml`.
 *
 * Validates a PR body file against the 3 mandatory sections defined
 * by `pr-guidlines.md` §7 + §10:
 *
 *   • `## Guideline compliance`   — guideline-compliance table (§10)
 *   • `## Why`                    — paragraph explaining motivation (§7)
 *   • `## What`                   — bullet list of touched files (§7)
 *
 * Why this script exists: CR cycle PR #336 #1 paired with a CI failure
 * on `Validate PR body sections` — the PR body opened without the
 * mandatory headers because the validation was only available server-
 * side. This script lets contributors (and the pre-push hook) catch
 * the gap BEFORE pushing.
 *
 * Usage:
 *   node scripts/validate-pr-body.mjs --file <path>
 *   PR_BODY_FILE=<path> node scripts/validate-pr-body.mjs
 *   cat body.md | node scripts/validate-pr-body.mjs --stdin
 *
 * Exit codes:
 *   0  — body contains all mandatory sections
 *   1  — body is missing at least one mandatory section
 *   2  — usage error (no source provided / file unreadable)
 *
 * Bot-author exemption (Dependabot, release-please, github-actions)
 * lives ONLY on the CI side — local pushes from a human contributor
 * always validate.
 */
import { readFileSync } from 'node:fs';
import { argv, exit, stderr, stdin, stdout } from 'node:process';

const REQUIRED_SECTIONS = [
  { header: '## Guideline compliance', cite: 'pr-guidlines.md §10' },
  { header: '## Why', cite: 'pr-guidlines.md §7' },
  { header: '## What', cite: 'pr-guidlines.md §7' },
];

/**
 * Read CLI args + env into a normalized request shape.
 * @returns Source descriptor (`file` path, `stdin`, or `error`).
 */
function parseArgs() {
  const args = argv.slice(2);
  const stdinIdx = args.indexOf('--stdin');
  if (stdinIdx !== -1) return { kind: 'stdin' };
  const fileIdx = args.indexOf('--file');
  if (fileIdx !== -1 && args[fileIdx + 1]) return { kind: 'file', path: args[fileIdx + 1] };
  const positional = args.filter((a) => !a.startsWith('--'));
  if (positional[0]) return { kind: 'file', path: positional[0] };
  if (process.env.PR_BODY_FILE) return { kind: 'file', path: process.env.PR_BODY_FILE };
  return { kind: 'error' };
}

/**
 * Read body content from stdin synchronously.
 * @returns Full stdin payload as a UTF-8 string.
 */
function readStdinSync() {
  return readFileSync(0, 'utf8');
}

/**
 * Resolve the body content from the parsed source descriptor.
 * @param source - Parsed CLI request.
 * @returns Body string (or throws if unreadable).
 */
function loadBody(source) {
  if (source.kind === 'stdin') return readStdinSync();
  if (source.kind === 'file') return readFileSync(source.path, 'utf8');
  throw new Error('No source provided');
}

/**
 * Determine which mandatory sections are missing.
 * @param body - PR body string.
 * @returns Array of missing section descriptors.
 */
function findMissingSections(body) {
  return REQUIRED_SECTIONS.filter(({ header }) => !body.includes(header));
}

/**
 * Print the failure report (mirrors the CI workflow message shape).
 * @param missing - Missing section descriptors.
 */
function printFailure(missing) {
  stderr.write('PR body is missing one or more mandatory sections:\n');
  for (const { header, cite } of missing) {
    stderr.write(`  - ${header}  (${cite})\n`);
  }
  stderr.write('\nSee .github/PULL_REQUEST_TEMPLATE.md for the canonical layout.\n');
  stderr.write('See pr-guidlines.md §7 (Why/What) and §10 (Guideline compliance) for content rules.\n');
}

/**
 * Print the usage banner + exit 2.
 */
function printUsageAndExit() {
  stderr.write('Usage:\n');
  stderr.write('  node scripts/validate-pr-body.mjs --file <path>\n');
  stderr.write('  PR_BODY_FILE=<path> node scripts/validate-pr-body.mjs\n');
  stderr.write('  cat body.md | node scripts/validate-pr-body.mjs --stdin\n');
  exit(2);
}

const source = parseArgs();
if (source.kind === 'error') printUsageAndExit();
let body;
try {
  body = loadBody(source);
} catch (err) {
  stderr.write(`Failed to read PR body: ${err.message}\n`);
  exit(2);
}
const missing = findMissingSections(body);
if (missing.length > 0) {
  printFailure(missing);
  exit(1);
}
stdout.write('PR body contains all mandatory sections ✓\n');
exit(0);
