#!/usr/bin/env node
/**
 * Assert that the Node versions we ADVERTISE are the ones we actually TEST.
 *
 * Why this script exists: `package.json` declared `engines.node: ">= 22.14.0"`
 * — an open-ended claim — while every CI job installed exactly one version,
 * the `.nvmrc` pin. Nothing verified 24.x. A consumer on a newer Node had our
 * word and no evidence, and the first proof either way would have been their
 * build breaking. Worse, that is precisely the failure that drives a *low*
 * Dependabot compatibility score once one exists: the score is the percentage
 * of downstream CI runs that passed after bumping us.
 *
 * Three sources have to agree, and each drifts for a different reason:
 *   - `.nvmrc`              — bumped when a developer needs a newer toolchain.
 *   - `engines.node`        — edited when someone widens or narrows support.
 *   - the unit-test matrix  — trimmed when CI minutes are under pressure.
 *   - the README table      — the only one a consumer ever reads, so the one
 *                             most likely to rot unnoticed.
 *
 * Scope, stated honestly: this proves the four declarations are CONSISTENT.
 * It cannot prove the suite passes on those versions — that is the matrix's
 * job. Consistency is what rots silently; a failing matrix leg is loud.
 *
 * Deliberately dependency-free: the likeliest drift is a docs-only PR editing
 * the README table, and CI skips `npm ci` for those. A gate that needs
 * `node_modules` would be absent for precisely the change it exists to catch.
 *
 * Usage:
 *   node scripts/check-node-support.mjs
 *
 * Exit codes:
 *   0  every declaration agrees
 *   1  at least one declaration has drifted
 */
import { readFileSync } from 'node:fs';
import { exit, stderr, stdout } from 'node:process';

const NVMRC = '.nvmrc';
const PKG = 'package.json';
const WORKFLOW = '.github/workflows/pr.yml';
const README = 'README.md';

/** Delimits the generated support table so the check never guesses at prose. */
const README_BLOCK = /<!-- node-support:start -->([\s\S]*?)<!-- node-support:end -->/;

/** First column of a Markdown table row, when it is an inline-code span. */
const TABLE_ROW = /^\|\s*`([^`]+)`\s*\|/gm;

/** The `unit-tests:` job body, bounded by the next top-level key in `jobs:`. */
const UNIT_TESTS_JOB = /^ {2}unit-tests:\n([\s\S]*?)(?=^ {2}\S)/m;

/** The inline `node:` matrix list declared inside that job. */
const NODE_LEGS = /^\s*node:\s*\[([^\]]+)\]/m;

/**
 * Abort the run. Drift is a build failure, never a warning: a warning here
 * would be read once and then filtered out of every subsequent log.
 * @param {string} message - What drifted, and against what.
 * @returns {never}
 */
function fail(message) {
  stderr.write(`check-node-support: ${message}\n`);
  exit(1);
}

/**
 * Node version pinned for local development.
 * @returns {string} Version without the `v` prefix, e.g. `22.14.0`.
 */
function devVersion() {
  return readFileSync(NVMRC, 'utf8').trim().replace(/^v/, '');
}

/**
 * Lowest Node version the published package claims to support.
 * @returns {string} Floor of the `engines.node` range.
 */
function declaredFloor() {
  const range = JSON.parse(readFileSync(PKG, 'utf8')).engines?.node ?? '';
  const found = /(\d+\.\d+\.\d+)/.exec(range);
  return found ? found[1] : fail(`${PKG}: engines.node ("${range}") states no floor version`);
}

/**
 * Node versions the unit-test job installs.
 * @returns {string[]} Matrix legs, in declaration order.
 */
function matrixVersions() {
  const job = UNIT_TESTS_JOB.exec(readFileSync(WORKFLOW, 'utf8'));
  if (!job) fail(`${WORKFLOW}: no \`unit-tests:\` job found`);
  const legs = NODE_LEGS.exec(job[1]);
  if (!legs) fail(`${WORKFLOW}: the \`unit-tests\` job declares no \`node:\` matrix`);
  return legs[1].split(',').map((leg) => leg.trim().replace(/^['"]|['"]$/g, ''));
}

/**
 * Node versions the README advertises to consumers.
 * @returns {string[]} Table rows, in document order.
 */
function readmeVersions() {
  const block = README_BLOCK.exec(readFileSync(README, 'utf8'));
  if (!block) fail(`${README}: missing <!-- node-support:start --> / <!-- node-support:end --> markers`);
  return [...block[1].matchAll(TABLE_ROW)].map((row) => row[1]);
}

const dev = devVersion();
const floor = declaredFloor();
const matrix = matrixVersions();
const readme = readmeVersions();

if (floor !== dev) {
  fail(`floor drift — ${PKG} engines.node floor is ${floor}, but ${NVMRC} pins ${dev}. ` + 'Move both together, or the advertised minimum is one nobody builds on.');
}
if (!matrix.includes(dev)) {
  fail(`matrix gap — ${NVMRC} pins ${dev}, which the unit-test matrix never runs: [${matrix.join(', ')}].`);
}
if (readme.join(',') !== matrix.join(',')) {
  fail(`README drift — the table advertises [${readme.join(', ')}] but CI runs [${matrix.join(', ')}]. ` + 'Both lists must agree in the same order, so the table reads as the run order.');
}

stdout.write(`check-node-support: floor ${floor}, matrix [${matrix.join(', ')}], README in sync ✓\n`);
exit(0);
