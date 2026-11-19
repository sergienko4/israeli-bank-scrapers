#!/usr/bin/env node
/**
 * Rejects a compatibility entry that names a release which never happened.
 *
 * Why this script exists: `compatibility.json` is hand-edited, and a guessed
 * next version (10.4.0 while the next release was 10.1.0) is indistinguishable
 * from a real one without checking the release record. The check is dynamic:
 * a numeric version passes only when its `v<version>` tag exists, when it is
 * the version release-please proposed in `package.json`, or when the base
 * branch already carried it as an untagged pending entry. There is no local
 * version list to maintain.
 *
 * Usage:
 *   node scripts/check-compatibility-versions.mjs
 *   node scripts/check-compatibility-versions.mjs --base origin/main
 *   node scripts/check-compatibility-versions.mjs --strict
 *
 * Exit codes:
 *   0  - every version is allowed
 *   1  - a version is guessed, malformed or out of order
 *   2  - usage error (an unreadable base ref)
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { argv, exit, stderr, stdout } from 'node:process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  compareSemver,
  isSemanticVersion,
  readReleasedVersions,
  UNRELEASED,
} from './build-compatibility.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_BASE = 'origin/main';

/**
 * Strip a `v` prefix and keep only semantic versions.
 * @param versions Raw version strings.
 * @returns Normalized semantic versions.
 */
function semanticOnly(versions) {
  return versions.map((version) => version.replace(/^v/, '')).filter(isSemanticVersion);
}

/**
 * Check entry versions against the release record.
 * @param entries Compatibility entries, in document order.
 * @param options Released versions, pending versions and strict mode.
 * @returns Human-readable problems; empty when every entry is allowed.
 */
export function versionProblems(entries, options) {
  const releasedVersions = semanticOnly(options.releasedVersions);
  const released = new Set(releasedVersions);
  const pending = new Set(semanticOnly(options.pendingVersions ?? []));
  const strict = options.strict === true;
  const ordered = [...new Set(releasedVersions)].sort(compareSemver);
  const previousReleased = ordered.length > 1 ? ordered[ordered.length - 2] : null;
  const problems = [];
  let previous = null;
  for (const entry of entries) {
    const { version, title } = entry;
    if (version === UNRELEASED) {
      if (strict) {
        problems.push(`entry "${title}" is still unreleased; a released page must name a version`);
      }
      if (previous !== null) {
        problems.push(`entry "${title}" is unreleased but follows ${previous}; unreleased entries must come first`);
      }
      continue;
    }
    if (!isSemanticVersion(version)) {
      problems.push(`entry "${title}" uses "${version}"; write "${UNRELEASED}" or x.y.z`);
      continue;
    }
    if (previous !== null && compareSemver(version, previous) > 0) {
      problems.push(`entry "${title}" uses ${version}, which is newer than the preceding ${previous}`);
    }
    // In strict mode an untagged entry is historical only when it predates the
    // previous release. That accepts the notes written before tagging while
    // still rejecting a stale note that belongs to the release just made.
    const isHistorical = previousReleased !== null && compareSemver(version, previousReleased) < 0;
    const isAllowed = released.has(version) || (strict && isHistorical) || (!strict && pending.has(version));
    if (!isAllowed) {
      problems.push(`entry "${title}" uses ${version}, which has no v${version} tag; write "${UNRELEASED}" instead`);
    }
    previous = version;
  }
  return problems;
}

/**
 * Read the entries committed at a base ref.
 * @param root Repository root.
 * @param base Git ref, such as `origin/main` or a SHA.
 * @returns Base entries, or an empty list when the file did not exist there.
 * @throws When the ref is unreadable for any other reason.
 */
export function readBaseEntries(root, base) {
  try {
    const raw = execFileSync('git', ['-C', root, 'show', `${base}:compatibility.json`], {
      encoding: 'utf8',
    });
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.entries) ? parsed.entries : [];
  } catch (error) {
    const detail = String(error.stderr ?? error.message);
    if (detail.includes('does not exist')) return [];
    throw new Error(`cannot read compatibility.json at ${base}: ${detail.trim()}`);
  }
}

/**
 * The version release-please proposed on this branch, when there is one.
 * @param root Repository root.
 * @returns A semantic version, or null.
 */
function proposedVersion(root) {
  try {
    const raw = readFileSync(join(root, 'package.json'), 'utf8');
    const version = JSON.parse(raw).version;
    return typeof version === 'string' && isSemanticVersion(version) ? version : null;
  } catch (error) {
    return null;
  }
}

/**
 * Pending versions: the proposed one plus untagged versions the base carried.
 * @param root Repository root.
 * @param baseEntries Entries committed at the base ref.
 * @param released Released versions.
 * @returns Versions a normal PR may still use.
 */
function pendingVersions(root, baseEntries, released) {
  const proposed = proposedVersion(root);
  const basePending = baseEntries
    .map((entry) => entry.version)
    .filter((version) => isSemanticVersion(version) && !released.has(version));
  return proposed === null ? basePending : [proposed, ...basePending];
}

/**
 * Parse the CLI arguments.
 * @param args Argument vector.
 * @returns Root, base ref and strict flag.
 */
export function parseArgs(args) {
  const rootIndex = args.findIndex((arg) => arg === '--root');
  const baseIndex = args.findIndex((arg) => arg === '--base');
  const rootValue = rootIndex === -1 ? undefined : args[rootIndex + 1];
  const baseValue = baseIndex === -1 ? undefined : args[baseIndex + 1];
  return {
    root: rootValue ?? ROOT,
    base: baseValue ?? DEFAULT_BASE,
    strict: args.includes('--strict'),
  };
}

/**
 * Run the guard and print every problem.
 * @param options Parsed CLI options.
 * @returns Process exit code.
 */
function run(options) {
  const data = JSON.parse(readFileSync(join(options.root, 'compatibility.json'), 'utf8'));
  const entries = Array.isArray(data.entries) ? data.entries : [];
  const released = readReleasedVersions(options.root);
  const baseEntries = options.strict ? [] : readBaseEntries(options.root, options.base);
  const pending = options.strict ? [] : pendingVersions(options.root, baseEntries, new Set(released));
  const problems = versionProblems(entries, {
    releasedVersions: released,
    pendingVersions: pending,
    strict: options.strict,
  });
  if (problems.length === 0) {
    stdout.write(`compatibility versions OK (${entries.length} entries)\n`);
    return 0;
  }
  for (const problem of problems) stderr.write(`${problem}\n`);
  stderr.write(`compatibility versions failed (${problems.length} problem${problems.length === 1 ? '' : 's'})\n`);
  return 1;
}

/** Entry point: parse arguments, then run or explain the usage error. */
function main() {
  const options = parseArgs(argv);
  try {
    exit(run(options));
  } catch (error) {
    stderr.write(`compatibility version check failed: ${error.message}\n`);
    exit(2);
  }
}

// Only run the CLI when invoked directly, so tests can import the pure rules.
if (argv[1] && import.meta.url === pathToFileURL(argv[1]).href) {
  main();
}
