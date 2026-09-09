#!/usr/bin/env node
/**
 * Drop OpenSSF Scorecard `PinnedDependenciesID` false positives that are
 * really GitHub's `$/` self-repository syntax.
 *
 * Why this script exists: Scorecard v2.4.4 (the latest release, 2026-07-23)
 * predates the `$/` self-repository syntax by seven days and does not parse
 * it, so it reports every `uses: $/.github/…` reference as a third-party
 * action "not pinned by hash" — 28 false code-scanning alerts on this repo.
 * The syntax is the *more* secure form: GitHub treats `$/` as a form of
 * pinning and zizmor's `self-repository` audit (v1.30.0) requires it. There
 * is no Scorecard version to bump to and no per-check input on
 * `ossf/scorecard-action` to disable it — upstream tracking issue
 * https://github.com/ossf/scorecard/issues/5191 is still open.
 *
 * So we keep `$/` (zizmor stays green) and surgically strip only the SARIF
 * results whose flagged source line is a `$/` self-repository reference,
 * before the SARIF is uploaded to code scanning. A genuinely unpinned
 * third-party action never matches `uses: $/…`, so it is still reported —
 * the security property Scorecard exists to enforce is preserved.
 *
 * See docs/workflow/code-scanning.md "Standing finding 1".
 *
 * Usage:
 *   node scripts/filter-scorecard-sarif.mjs <results.sarif>
 *
 * Exit codes:
 *   0  — SARIF rewritten in place (with 0 or more results dropped)
 *   2  — usage error (no file argument / file unreadable / invalid JSON)
 */
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { argv, cwd, exit, stderr, stdout } from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Scorecard rule whose `$/` hits are the false positives we remove. */
const PINNED_DEPS_RULE = 'PinnedDependenciesID';

/** A `uses:` line pointing at the current repo via `$/` self-repository syntax. */
const SELF_REPO_USES = /^\s*-?\s*uses:\s*\$\//;

/**
 * The rule id a SARIF result is attributed to.
 *
 * @param {Record<string, unknown>} result - A SARIF result object.
 * @returns {string} The rule id, or an empty string when absent.
 */
function ruleIdOf(result) {
  const rule = /** @type {{ id?: string }} */ (result.rule ?? {});
  return /** @type {string} */ (result.ruleId ?? rule.id ?? '');
}

/**
 * The primary flagged location of a SARIF result.
 *
 * @param {Record<string, unknown>} result - A SARIF result object.
 * @returns {{ uri: string, startLine: number } | undefined} The file and
 *   1-based line, or undefined when the result carries no physical location.
 */
function primaryLocation(result) {
  const locations = /** @type {unknown[]} */ (result.locations ?? []);
  const physical = /** @type {any} */ (locations[0])?.physicalLocation;
  const uri = physical?.artifactLocation?.uri;
  const startLine = physical?.region?.startLine;
  if (typeof uri !== 'string' || typeof startLine !== 'number') return undefined;
  return { uri, startLine };
}

/**
 * Is this result a `$/` self-repository false positive we should drop?
 *
 * @param {Record<string, unknown>} result - A SARIF result object.
 * @param {(uri: string, line: number) => string} resolveLine - Reads the
 *   source line the result points at.
 * @returns {boolean} True only for a `PinnedDependenciesID` hit whose flagged
 *   line is a `$/` self-repository `uses:` reference.
 */
function isSelfRepoFalsePositive(result, resolveLine) {
  if (ruleIdOf(result) !== PINNED_DEPS_RULE) return false;
  const location = primaryLocation(result);
  if (location === undefined) return false;
  const line = resolveLine(location.uri, location.startLine);
  return SELF_REPO_USES.test(line);
}

/**
 * Strip `$/` self-repository false positives from one SARIF run's results.
 *
 * @param {Record<string, unknown>} run - A SARIF run object.
 * @param {(uri: string, line: number) => string} resolveLine - Source reader.
 * @returns {number} How many results were removed from the run.
 */
function pruneRun(run, resolveLine) {
  const results = /** @type {Record<string, unknown>[]} */ (run.results ?? []);
  const kept = results.filter(result => !isSelfRepoFalsePositive(result, resolveLine));
  run.results = kept;
  return results.length - kept.length;
}

/**
 * Remove every `$/` self-repository `PinnedDependenciesID` false positive from
 * a parsed SARIF document, in place.
 *
 * @param {Record<string, unknown>} sarif - Parsed SARIF document.
 * @param {(uri: string, line: number) => string} resolveLine - Source reader.
 * @returns {number} Total number of results removed across all runs.
 */
export function filterSarif(sarif, resolveLine) {
  const runs = /** @type {Record<string, unknown>[]} */ (sarif.runs ?? []);
  return runs.reduce((total, run) => total + pruneRun(run, resolveLine), 0);
}

/**
 * A source reader rooted at a working directory.
 *
 * @param {string} root - Directory the SARIF uris are relative to.
 * @returns {(uri: string, line: number) => string} Reader returning the
 *   requested 1-based line, or an empty string when it cannot be read.
 */
function diskResolver(root) {
  return (uri, line) => {
    try {
      const relative = uri.replace(/^\.\//, '');
      const text = readFileSync(join(root, relative), 'utf8');
      return text.split('\n')[line - 1] ?? '';
    } catch {
      return '';
    }
  };
}

/**
 * Rewrite a SARIF file in place with the false positives removed.
 *
 * @param {string} file - Path to the SARIF file to filter.
 * @returns {void}
 */
function run(file) {
  const sarif = JSON.parse(readFileSync(file, 'utf8'));
  const removed = filterSarif(sarif, diskResolver(cwd()));
  writeFileSync(file, `${JSON.stringify(sarif, null, 2)}\n`);
  stdout.write(`filter-scorecard-sarif: dropped ${removed} $/ self-repository false positive(s)\n`);
}

/**
 * CLI entry point.
 *
 * @returns {void}
 */
function main() {
  const file = argv[2];
  if (file === undefined) {
    stderr.write('usage: node scripts/filter-scorecard-sarif.mjs <results.sarif>\n');
    exit(2);
  }
  try {
    run(file);
  } catch (error) {
    stderr.write(`filter-scorecard-sarif: ${String(error)}\n`);
    exit(2);
  }
}

/**
 * A path reduced to one canonical form, following symlinks.
 *
 * @param {string} path - Filesystem path to canonicalise.
 * @returns {string} The path as a `file:` URL with symlinks resolved.
 */
function canonicalHref(path) {
  return pathToFileURL(realpathSync(path)).href;
}

/**
 * Whether this module was run directly rather than imported.
 *
 * <p>Both sides are canonicalised. Node may resolve the module specifier
 * through symlinks while leaving `argv[1]` as written, or (under
 * `--preserve-symlinks-main`) do the opposite, so canonicalising only one side
 * still mismatches. That failure is silent and security-relevant: `main()`
 * would not run, the SARIF would upload unfiltered, and the step would still
 * exit 0. Canonicalisation is deliberately allowed to throw rather than be
 * caught into `false`, so an unresolvable entry fails the step loudly instead
 * of degrading into the same silent no-op.
 *
 * @returns {boolean} True when this file is the entry point.
 */
function isEntryPoint() {
  const entry = argv[1];
  if (entry === undefined) return false;
  return canonicalHref(entry) === canonicalHref(fileURLToPath(import.meta.url));
}

if (isEntryPoint()) main();
