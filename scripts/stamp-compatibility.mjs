#!/usr/bin/env node
/**
 * Stamps every unreleased compatibility entry with the version the release
 * process computed.
 *
 * Why this script exists: authors used to type the next release number into
 * `compatibility.json`. PR #871 shipped a note labelled 10.4.0 while the next
 * release was 10.1.0, and nothing caught it. The release PR is the one place
 * where the real version is known — release-please writes it to `package.json`
 * — so that is where the note is stamped. No separate version record exists.
 *
 * An entry is unreleased when it carries the `unreleased` sentinel, or when it
 * is newer than the highest `v<version>` tag and not already the target
 * version. That second clause also corrects a hand-typed guessed number
 * without moving a historical note that predates tagging.
 *
 * Usage:
 *   node scripts/stamp-compatibility.mjs --version 10.1.0
 *   node scripts/stamp-compatibility.mjs --version v10.1.0 --dry-run
 *   node scripts/stamp-compatibility.mjs --version 10.1.0 --root /tmp/fixture
 *
 * Exit codes:
 *   0  - entries stamped, or already stamped
 *   1  - a write/validation failure
 *   2  - usage error (no version supplied)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { argv, exit, stderr, stdout } from 'node:process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  compareSemver,
  isSemanticVersion,
  readReleasedVersions,
  renderPage,
  UNRELEASED,
} from './build-compatibility.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Whether an entry must be rewritten to the release version. The boundary is
 * the highest release tag, not a per-entry tag: some historical notes predate
 * tagging, and rewriting them would move old release history into this one.
 * @param version Entry's current version.
 * @param target Release version.
 * @param lastReleased Highest released version, or null.
 * @returns True when the entry has not shipped yet.
 */
function isUnreleased(version, target, lastReleased) {
  if (version === UNRELEASED) return true;
  if (!isSemanticVersion(version)) return true;
  if (version === target) return false;
  if (lastReleased === null) return true;
  return compareSemver(version, lastReleased) > 0;
}

/**
 * The highest released version.
 * @param versions Released versions, possibly with a leading `v`.
 * @returns The highest semantic version, or null.
 */
function highestOf(versions) {
  let highest = null;
  for (const candidate of versions) {
    const version = candidate.replace(/^v/, '');
    if (!isSemanticVersion(version)) continue;
    if (highest === null || compareSemver(version, highest) > 0) highest = version;
  }
  return highest;
}

/**
 * Rewrite every unreleased entry to the release version.
 * @param data Parsed compatibility document.
 * @param version Release version, `x.y.z`.
 * @param releasedVersions Versions that already have a `v*` tag.
 * @returns The rewritten document and the number of entries changed.
 * @throws When the version is malformed, no tags exist, or the target is not
 *   newer than the last release.
 */
export function stampData(data, version, releasedVersions) {
  if (!isSemanticVersion(version)) {
    throw new Error(`release version is not semantic: "${version}" (expected x.y.z)`);
  }
  const lastReleased = highestOf(releasedVersions);
  const hasNumeric = data.entries.some((entry) => entry.version !== UNRELEASED);
  if (lastReleased === null && hasNumeric) {
    throw new Error('no release tags found; cannot tell released entries from pending ones');
  }
  if (lastReleased !== null && compareSemver(version, lastReleased) <= 0) {
    throw new Error(`release version ${version} is not newer than the last release ${lastReleased}`);
  }
  let stamped = 0;
  const entries = data.entries.map((entry) => {
    if (!isUnreleased(entry.version, version, lastReleased)) return entry;
    stamped += 1;
    return { ...entry, version };
  });
  return { data: { ...data, entries }, stamped };
}

/**
 * Read a comma-separated released-version override.
 * @param value Raw flag value.
 * @returns Version strings without a leading `v`.
 */
function parseReleased(value) {
  return value
    .split(',')
    .map((item) => item.trim().replace(/^v/, ''))
    .filter(isSemanticVersion);
}

/**
 * Parse the CLI arguments.
 * @param args Argument vector.
 * @returns Parsed options, or null when `--version` is absent.
 */
export function parseArgs(args) {
  const index = args.findIndex((arg) => arg === '--version');
  const value = index === -1 ? undefined : args[index + 1];
  if (!value || value.startsWith('--')) return null;
  const rootIndex = args.findIndex((arg) => arg === '--root');
  const releasedIndex = args.findIndex((arg) => arg === '--released');
  const rootValue = rootIndex === -1 ? undefined : args[rootIndex + 1];
  const releasedValue = releasedIndex === -1 ? undefined : args[releasedIndex + 1];
  return {
    version: value.replace(/^v/, ''),
    root: rootValue ?? ROOT,
    released: releasedValue,
    dryRun: args.includes('--dry-run'),
  };
}

/**
 * Resolve the released versions, failing closed when tags are unavailable.
 * @param options Parsed CLI options.
 * @param data Parsed compatibility document.
 * @returns Released version strings.
 */
function releasedFor(options, data) {
  if (options.released !== undefined) return parseReleased(options.released);
  const released = readReleasedVersions(options.root);
  const hasNumeric = data.entries.some((entry) => entry.version !== UNRELEASED);
  if (released.length === 0 && hasNumeric) {
    throw new Error('no v* release tags found; fetch tags before stamping (git fetch --tags)');
  }
  return released;
}

/**
 * Run the stamp from parsed options.
 * @param options Parsed CLI options.
 */
function run(options) {
  const dataPath = join(options.root, 'compatibility.json');
  const pagePath = join(options.root, 'docs', 'compatibility.md');
  const data = JSON.parse(readFileSync(dataPath, 'utf8'));
  const released = releasedFor(options, data);
  const result = stampData(data, options.version, released);
  if (result.stamped === 0) {
    stdout.write(`compatibility notes already stamped for ${options.version}\n`);
    return;
  }
  if (options.dryRun) {
    stdout.write(`would stamp ${result.stamped} entr${result.stamped === 1 ? 'y' : 'ies'} with ${options.version}\n`);
    return;
  }
  writeFileSync(dataPath, `${JSON.stringify(result.data, null, 2)}\n`, 'utf8');
  writeFileSync(pagePath, renderPage(result.data), 'utf8');
  stdout.write(`stamped ${result.stamped} entr${result.stamped === 1 ? 'y' : 'ies'} with ${options.version}\n`);
}

/** Entry point: parse arguments, then stamp or explain the usage error. */
function main() {
  const options = parseArgs(argv);
  if (!options) {
    stderr.write('usage: node scripts/stamp-compatibility.mjs --version <x.y.z>\n');
    exit(2);
  }
  try {
    run(options);
  } catch (error) {
    stderr.write(`compatibility stamp failed: ${error.message}\n`);
    exit(1);
  }
}

// Only run the CLI when invoked directly, so tests can import the pure rules.
if (argv[1] && import.meta.url === pathToFileURL(argv[1]).href) {
  main();
}
