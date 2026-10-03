#!/usr/bin/env node
/**
 * Decide the Scorecard npm-pin gate from one OpenSSF Scorecard JSON result.
 *
 * Why this script exists: the scheduled Scorecard scan raises code-scanning
 * rule `PinnedDependenciesID` for every npm command that downloads without a
 * lockfile pin (type `npmCommand`). `scorecard-npm-pins.sh` runs the same
 * engine over the pull request's merge tree and passes its `--format=json`
 * result here. Scorecard exits 0 whatever it finds, so this script is what
 * fails the build.
 *
 * It fails closed: a result it cannot positively read as "every npm command
 * pinned, nothing skipped" is a failure. That includes a shell file Scorecard
 * could not parse (`Possibly incomplete results`) — the scan drops every
 * command in such a file — and a result with no npm commands at all, which in
 * this repository means the scan saw the wrong tree. Other dependency types
 * are not this gate's concern.
 *
 * See docs/workflow/code-scanning.md.
 *
 * Usage:
 *   node .github/scripts/ci/check-scorecard-npm-pins.mjs <result.json> <engine-version>
 *
 * Exit codes:
 *   0  — every npm command pinned
 *   1  — gate failure, including an unreadable or malformed result
 *   2  — usage error
 */
import { readFileSync } from 'node:fs';
import process, { argv, stderr, stdout } from 'node:process';

const CHECK_NAME = 'Pinned-Dependencies';
const NPM_SUMMARY = /^Info:\s+(\d+) out of\s+(\d+) npmCommand dependencies pinned$/;
const NPM_WARNING = /^Warn:.*\bnpmCommand\b/;
const INCOMPLETE = /^Info: Possibly incomplete results\b/;
const INCONCLUSIVE_SCORE = -1;
const MAX_SCORE = 10;
const USAGE = 'Usage: check-scorecard-npm-pins.mjs <result.json> <engine-version>\n';

/**
 * Whether a value is a plain JSON object.
 *
 * @param {unknown} value - Parsed JSON value.
 * @returns {value is Record<string, unknown>} True for a non-array object.
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parse the result file.
 *
 * @param {string} path - Scorecard JSON result.
 * @returns {{ result?: unknown, problem?: string }} The parsed value, or why it could not be read.
 */
function readResult(path) {
  try {
    return { result: JSON.parse(readFileSync(path, 'utf8')) };
  } catch (error) {
    return { problem: `cannot read ${path}: ${error instanceof Error ? error.message : error}` };
  }
}

/**
 * The result's only check, when it is the Pinned-Dependencies check.
 *
 * @param {unknown} result - Parsed Scorecard result.
 * @returns {{ check?: Record<string, unknown>, problem?: string }} The check, or what is wrong.
 */
function pinnedCheckOf(result) {
  const checks = isRecord(result) ? result.checks : undefined;
  if (!Array.isArray(checks)) return { problem: 'result has no checks list' };
  const [check] = checks;
  if (checks.length === 1 && isRecord(check) && check.name === CHECK_NAME) return { check };
  return { problem: `expected exactly one ${CHECK_NAME} check, got ${checks.length} checks` };
}

/**
 * Whether the result came from the expected engine.
 *
 * @param {Record<string, unknown>} result - Parsed Scorecard result.
 * @param {string} expected - Engine version the gate pins, e.g. `v5.5.0`.
 * @returns {string[]} Problems found.
 */
function engineProblems(result, expected) {
  const engine = isRecord(result.scorecard) ? result.scorecard.version : undefined;
  if (engine === expected) return [];
  return [`engine is ${JSON.stringify(engine)}, expected ${expected}`];
}

/**
 * Whether the check's score and reason are a conclusive Scorecard verdict.
 *
 * @param {Record<string, unknown>} check - The Pinned-Dependencies check.
 * @returns {string[]} Problems found.
 */
function verdictProblems(check) {
  const { score, reason } = check;
  if (typeof reason !== 'string') return [`${CHECK_NAME} reason is not text`];
  if (score === INCONCLUSIVE_SCORE) return [`scan was inconclusive: ${reason}`];
  const isInRange = Number.isFinite(score) && score >= 0 && score <= MAX_SCORE;
  if (typeof score === 'number' && isInRange) return [];
  return [`${CHECK_NAME} score ${JSON.stringify(score)} is not a number from 0 to ${MAX_SCORE}`];
}

/**
 * The check's detail lines, when they are a non-empty list of text.
 *
 * @param {Record<string, unknown>} check - The Pinned-Dependencies check.
 * @returns {string[] | undefined} The lines, or undefined when malformed.
 */
function detailLines(check) {
  const { details } = check;
  if (!Array.isArray(details) || details.length === 0) return undefined;
  return details.every(line => typeof line === 'string') ? details : undefined;
}

/**
 * Problems the detail lines report: npm warnings, skipped files, and a
 * missing, duplicated or partial npm summary.
 *
 * @param {string[]} details - The check's detail lines.
 * @returns {string[]} Problems found.
 */
function detailProblems(details) {
  const flagged = details.filter(line => NPM_WARNING.test(line) || INCOMPLETE.test(line));
  const summaries = details.filter(line => NPM_SUMMARY.test(line));
  if (summaries.length !== 1) {
    return [...flagged, `expected one npmCommand summary, found ${summaries.length}`];
  }
  const [, pinned, total] = NPM_SUMMARY.exec(summaries[0]) ?? [];
  const isAllPinned = Number(total) > 0 && pinned === total;
  return isAllPinned ? flagged : [...flagged, summaries[0]];
}

/**
 * Every reason the result fails the gate.
 *
 * @param {unknown} result - Parsed Scorecard result.
 * @param {string} expected - Engine version the gate pins.
 * @returns {string[]} Problems found; empty when the gate passes.
 */
function problemsIn(result, expected) {
  const { check, problem } = pinnedCheckOf(result);
  if (!check) return [problem ?? 'result has no checks list'];
  const head = [...engineProblems(result, expected), ...verdictProblems(check)];
  const details = detailLines(check);
  if (!details) return [...head, `${CHECK_NAME} details are missing or not all text`];
  return [...head, ...detailProblems(details)];
}

/**
 * The npm summary line of a result that passed.
 *
 * @param {unknown} result - Parsed Scorecard result.
 * @returns {string} The summary line.
 */
function npmSummaryOf(result) {
  const { check } = pinnedCheckOf(result);
  const details = check ? detailLines(check) : undefined;
  return details?.find(line => NPM_SUMMARY.test(line)) ?? '';
}

/**
 * Run the gate.
 *
 * @param {string[]} args - Command-line arguments.
 * @returns {number} Exit code.
 */
function main(args) {
  const [path, expected] = args;
  if (!path || !expected) {
    stderr.write(USAGE);
    return 2;
  }
  const { result, problem } = readResult(path);
  const problems = problem ? [problem] : problemsIn(result, expected);
  if (problems.length === 0) {
    stdout.write(`Scorecard ${expected} npm-pin gate passed: ${npmSummaryOf(result)}\n`);
    return 0;
  }
  const report = problems.map(line => `  - ${line}`).join('\n');
  stderr.write(`Scorecard ${expected} npm-pin gate failed:\n${report}\n`);
  return 1;
}

// `exitCode`, not `exit()`: stdout to a pipe is asynchronous on macOS, and
// `exit()` can drop the report before it is written.
process.exitCode = main(argv.slice(2));
