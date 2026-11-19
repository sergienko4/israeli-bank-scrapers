#!/usr/bin/env node
/**
 * Generates `docs/compatibility.md` from `compatibility.json`.
 *
 * Why this script exists: upgrade-impact notes were previously spread
 * across CHANGELOG entries and commit bodies, so a real breaking change
 * (the `OneZeroScraper` export removed in 8.3.0) shipped on a MINOR
 * bump with nothing telling users to switch to `createScraper`. Keeping
 * one machine-rendered page means the notes cannot silently rot.
 *
 * The data file is the source of truth; the Markdown page is a build
 * artifact that happens to be committed so it renders on GitHub and in
 * the docs site. `--check` proves the two are still in sync.
 *
 * Usage:
 *   node scripts/build-compatibility.mjs            # write the page
 *   node scripts/build-compatibility.mjs --check    # fail if it drifted
 *
 * Exit codes:
 *   0  - page written, or already up to date
 *   1  - drift detected under `--check`, or data failed validation
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { argv, exit, stderr, stdout } from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'compatibility.json');
const PAGE = join(ROOT, 'docs', 'compatibility.md');

/**
 * Version sentinel for an entry the next release will ship. Authors write
 * this instead of guessing a release number; the release process stamps the
 * version it computed.
 */
export const UNRELEASED = 'unreleased';

/** Impact label rendered next to each entry. */
export const IMPACT_LABEL = {
  breaking: 'Breaking',
  dependency: 'Dependency',
  behavior: 'Behavior',
};

/**
 * Whether a value is a plain semantic version the tooling can compare.
 * @param value Candidate version.
 * @returns True for `x.y.z` with numeric parts.
 */
export function isSemanticVersion(value) {
  return /^\d+\.\d+\.\d+$/.test(value);
}

/**
 * Split a validated semantic version into numeric parts.
 * @param version A value accepted by {@link isSemanticVersion}.
 * @returns The three numeric parts.
 */
function partsOf(version) {
  const [major, minor, patch] = version.split('.').map((part) => Number.parseInt(part, 10));
  return { major, minor, patch };
}

/**
 * Compare two semantic versions.
 * @param left First version.
 * @param right Second version.
 * @returns Negative when left is older, positive when newer, zero when equal.
 */
export function compareSemver(left, right) {
  const a = partsOf(left);
  const b = partsOf(right);
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

/**
 * Read released versions from the `v*` git tags.
 * @param root Repository root; defaults to this script's parent.
 * @returns Version strings without the leading `v`, sorted ascending.
 * @throws When git cannot list tags.
 */
export function readReleasedVersions(root = ROOT) {
  const output = execFileSync('git', ['-C', root, 'tag', '--list', 'v*'], {
    encoding: 'utf8',
  });
  return output
    .split('\n')
    .map((line) => line.trim().replace(/^v/, ''))
    .filter(isSemanticVersion)
    .sort(compareSemver);
}

/**
 * Reads and parses the compatibility data file.
 * @returns Parsed data document.
 */
export function readData() {
  return JSON.parse(readFileSync(DATA, 'utf8'));
}

/**
 * Rejects entries whose `impact` has no rendering label.
 *
 * Uses `Object.hasOwn` rather than a truthiness test on the lookup:
 * `IMPACT_LABEL['toString']` resolves through `Object.prototype` and would
 * otherwise pass validation, then render a function into the page.
 * @param entries Entry list from the data file.
 * @throws When an entry uses an unknown impact value.
 */
export function assertKnownImpacts(entries) {
  const bad = entries.filter((e) => !Object.hasOwn(IMPACT_LABEL, e.impact));
  if (bad.length === 0) return;
  const detail = bad.map((e) => `${e.version} -> "${e.impact}"`).join(', ');
  throw new Error(`unknown impact value(s): ${detail}`);
}

/**
 * Renders a fenced code block, or nothing when the snippet is absent.
 * @param label Heading shown above the snippet.
 * @param code Snippet body, or null.
 * @returns Markdown lines for the snippet.
 */
function renderSnippet(label, code) {
  if (!code) return [];
  return ['', `${label}:`, '', '```js', code, '```'];
}

/**
 * Renders the before/after migration pair for one entry.
 * @param entry Compatibility entry.
 * @returns Markdown lines, empty when the entry has no snippets.
 */
function renderMigration(entry) {
  return [...renderSnippet('Before', entry.before), ...renderSnippet('After', entry.after)];
}

/**
 * Renders a single compatibility entry as a Markdown section.
 * @param entry Compatibility entry.
 * @returns Markdown lines for the entry.
 */
function renderEntry(entry) {
  const heading = entry.version === UNRELEASED ? 'Unreleased' : entry.version;
  return [
    `### ${heading} - ${entry.title}`,
    '',
    `**Impact:** ${IMPACT_LABEL[entry.impact]}`,
    '',
    entry.detail,
    '',
    `**What to do:** ${entry.action}`,
    ...renderMigration(entry),
    '',
  ];
}

/**
 * Renders the runtime-requirement block.
 * @param runtime Runtime section of the data file.
 * @returns Markdown lines for the runtime block.
 */
function renderRuntime(runtime) {
  return [
    '## Runtime requirement',
    '',
    `Node **${runtime.node}**, unchanged since ${runtime.since}.`,
    '',
    runtime.note,
    '',
  ];
}

/** @returns The fixed page header. */
function renderHeader() {
  return [
    '<!-- Generated by scripts/build-compatibility.mjs. Edit compatibility.json instead. -->',
    '',
    '# Compatibility and upgrade notes',
    '',
    'Only releases that need something from you are listed. Anything not',
    'mentioned here is a drop-in upgrade.',
    '',
  ];
}

/** @returns The fixed page footer. */
function renderFooter() {
  return [
    '## Everything else',
    '',
    'Releases absent from this page changed no public API and need no action.',
    'For the full per-release list, see the',
    '[release notes](https://github.com/sergienko4/israeli-bank-scrapers/releases).',
    '',
  ];
}

/**
 * Renders the whole page.
 * @param data Parsed data document.
 * @returns Complete Markdown document text.
 */
export function renderPage(data) {
  assertKnownImpacts(data.entries);
  const body = data.entries.flatMap(renderEntry);
  const lines = [...renderHeader(), ...renderRuntime(data.runtime), '## Release notes', '', ...body, ...renderFooter()];
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

/**
 * Compares generated output against the committed page.
 * @param expected Freshly rendered document text.
 */
function checkDrift(expected) {
  const actual = readFileSync(PAGE, 'utf8');
  if (actual === expected) return stdout.write('compatibility page is up to date\n');
  stderr.write('docs/compatibility.md is stale - run `npm run compat:build`\n');
  exit(1);
}

/** Entry point: render, then either check or write. */
function main() {
  const page = renderPage(readData());
  if (argv.includes('--check')) return checkDrift(page);
  writeFileSync(PAGE, page, 'utf8');
  stdout.write(`wrote ${PAGE}\n`);
}

// Only run the CLI when invoked directly, so upgrade-notes.mjs can import
// the data helpers above without triggering a page write.
if (argv[1] && import.meta.url === pathToFileURL(argv[1]).href) {
  try {
    main();
  } catch (error) {
    stderr.write(`compatibility build failed: ${error.message}\n`);
    exit(1);
  }
}
