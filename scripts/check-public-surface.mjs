#!/usr/bin/env node
/**
 * Assert the published public API surface matches its committed snapshot.
 *
 * Why this script exists: the pre-PR contract's public-surface step was
 * `git show origin/main:lib/index.cjs`, compared against the working copy.
 * That command cannot work in this repo. `lib/` is gitignored
 * (`.gitignore:62`) and has never been tracked, so `git show` exits 128
 * with no baseline. In the documented PowerShell form the commands do
 * print errors, but the only signal the contract consumed passes anyway:
 * `$pre` never gets a value, `Compare-Object` refuses a null reference
 * object, `$diff` stays null, and the guarding `if ($diff)` therefore
 * reports "no drift". Every PR passed a check that had compared nothing
 * at all — a false green, not a missing gate.
 *
 * The second flaw is what it compared. `lib/index.cjs` is the bundled
 * implementation: renaming an internal module or reordering an import
 * changes its bytes while the exported API is untouched, and treeshaking
 * can change them again for reasons no reviewer can act on. Diffing it
 * answers "did the build output change", not "did the public API change".
 * `scripts/decoupling-metrics/diff.mjs` already labels its own hash of
 * that same file "implementation bundle, not a declaration-level API
 * diff" — this script is the declaration-level diff that sentence implies.
 *
 * What it checks instead: `lib/index.d.ts` IS the public surface. It
 * carries every exported value, type and signature, and nothing internal.
 * Committing it as `api-surface.d.ts` puts the baseline in git, where
 * `origin/main` genuinely has a copy to compare against, and where a PR
 * diff shows an API change in a form a reviewer can read.
 *
 * Scope, stated honestly: this detects declaration-level drift. It cannot
 * detect a behavioural change behind an unchanged signature, and it does
 * not claim the bundle is byte-identical — that was never the right
 * question. Judging whether a surface change is acceptable stays a job
 * for review; this only guarantees no such change passes unnoticed.
 *
 * Usage:
 *   node scripts/check-public-surface.mjs --check    # verify (CI + hook)
 *   node scripts/check-public-surface.mjs --update   # accept a change
 *
 * Both modes require a prior `npm run build`; the surface is a build
 * artifact and there is nothing to compare without one.
 *
 * Exit codes:
 *   0  surface matches the committed snapshot (or `--update` wrote it)
 *   1  surface drifted from the snapshot
 *   2  cannot verify — build or snapshot missing. Never reported as a pass.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { argv, env, exit, stderr, stdout } from 'node:process';

const BUILT_ESM = 'lib/index.d.ts';
const BUILT_CJS = 'lib/index.d.cts';
const SNAPSHOT = 'api-surface.d.ts';
const BUILD_HINT = 'Run `npm run build` first — the surface is a build artifact.';
const UPDATE_HINT = 'If the change is intended, run `npm run api:update` and commit the result.';
const MODE_HINT = 'Usage: check-public-surface.mjs [--check | --update]';
const MODES = new Set(['--check', '--update']);

/**
 * Read a file as UTF-8 with line endings normalized to LF.
 *
 * An I/O failure is an unverifiable state, not drift, so it exits 2
 * rather than surfacing as a confusing "API changed" verdict.
 */
function readLf(path) {
  try {
    return readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
  } catch (err) {
    return cannotVerify(`cannot read ${path} — ${err.code ?? err.message}`, BUILD_HINT);
  }
}

/** Report an unverifiable state and exit 2, so it can never read as a pass. */
function cannotVerify(reason, hint) {
  stderr.write(`check-public-surface: CANNOT VERIFY — ${reason}\n${hint}\n`);
  exit(2);
}

/** Report drift and exit 1. */
function drifted(reason) {
  stderr.write(`check-public-surface: PUBLIC API DRIFT — ${reason}\n`);
  exit(1);
}

/**
 * Confirm the build produced both declaration files.
 *
 * A missing build is the exact condition the old check swallowed, so it
 * is surfaced as "cannot verify" rather than allowed to look clean.
 */
function requireBuild() {
  if (!existsSync(BUILT_ESM)) cannotVerify(`${BUILT_ESM} not found`, BUILD_HINT);
  if (!existsSync(BUILT_CJS)) cannotVerify(`${BUILT_CJS} not found`, BUILD_HINT);
}

/**
 * Assert CJS and ESM consumers are offered the same declarations.
 *
 * tsup emits these byte-identical today. A divergence would mean
 * `require()` and `import` disagree about the API, which no single
 * snapshot could represent honestly.
 */
function requireDualParity() {
  if (readLf(BUILT_ESM) === readLf(BUILT_CJS)) return;
  drifted(`${BUILT_ESM} and ${BUILT_CJS} differ; CJS and ESM expose different APIs`);
}

/** Print a unified diff of snapshot vs build, best-effort. */
function printDiff() {
  const args = ['--no-pager', 'diff', '--no-index', '--', SNAPSHOT, BUILT_ESM];
  try {
    execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (err) {
    if (err.stdout) stdout.write(err.stdout);
  }
}

/** Write the built surface to the tracked snapshot. */
function update() {
  try {
    writeFileSync(SNAPSHOT, readLf(BUILT_ESM), 'utf8');
  } catch (err) {
    cannotVerify(`cannot write ${SNAPSHOT} — ${err.code ?? err.message}`, UPDATE_HINT);
  }
  stdout.write(`check-public-surface: snapshot updated from ${BUILT_ESM} → ${SNAPSHOT}\n`);
  stdout.write('Review the diff before committing: it is a public API change.\n');
}

/** Compare the built surface against the tracked snapshot. */
function check() {
  if (!existsSync(SNAPSHOT)) cannotVerify(`${SNAPSHOT} not found`, UPDATE_HINT);
  if (readLf(SNAPSHOT) === readLf(BUILT_ESM)) {
    stdout.write(`check-public-surface: public API surface unchanged ✓ (${SNAPSHOT})\n`);
    return;
  }
  printDiff();
  drifted(`${BUILT_ESM} no longer matches ${SNAPSHOT}. ${UPDATE_HINT}`);
}

/**
 * Resolve the single requested mode.
 *
 * `--update` rewrites the reviewed baseline, so it must never be
 * reachable by accident: an unknown flag, both modes at once, or any
 * invocation under CI aborts rather than blessing whatever was built.
 */
function resolveMode(args) {
  const unknown = args.filter(arg => !MODES.has(arg));
  if (unknown.length) cannotVerify(`unknown argument(s): ${unknown.join(' ')}`, MODE_HINT);
  const wantsUpdate = args.includes('--update');
  if (wantsUpdate && args.includes('--check')) {
    cannotVerify('--check and --update are mutually exclusive', MODE_HINT);
  }
  if (wantsUpdate && env.CI) cannotVerify('--update cannot run in CI', UPDATE_HINT);
  return wantsUpdate;
}

function main() {
  const wantsUpdate = resolveMode(argv.slice(2));
  requireBuild();
  requireDualParity();
  if (wantsUpdate) update();
  else check();
}

main();
