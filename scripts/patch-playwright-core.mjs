#!/usr/bin/env node
/**
 * Null-guards `pageError.location` inside the installed `playwright-core`.
 *
 * Why this script exists. This library subscribes to `page.on('pageerror')`
 * (see `Mediator/Init/PageObservers.ts` and
 * `Mediator/Network/AuthFailureWatcher/Factory.ts`). Playwright's
 * `BrowserContextDispatcher` forwards every such event and reads
 * `pageError.location.url` unguarded. Camoufox (Firefox) can emit an
 * uncaught page error with NO location, so that read throws
 * `TypeError: Cannot read properties of undefined` from inside
 * playwright-core — killing a scrape for a reason no stack trace of ours
 * explains. Upstream 1.62.1 (latest stable) still ships the unguarded read.
 *
 * Why not `patch-package`. Its patch file is keyed to an exact version
 * (`playwright-core+1.62.0.patch`) and it is a dev-only tool, so a published
 * consumer never runs it and the fix silently never reached them. This
 * script is dependency-free, version-agnostic, and idempotent, so it works
 * for contributors and consumers through the same code path.
 *
 * Guarantees: never fails an install (always exits 0) and never writes when
 * the guard is already present. Set `SKIP_PLAYWRIGHT_CORE_PATCH=1` to opt out.
 *
 * `--strict` (CI only; postinstall never passes it) turns the outcome into
 * proof: exit 0 only when every guarded form is present after patching,
 * checked per guard because one renamed read can hide behind the others.
 * Each absent form prints `MISSING-GUARD <index> <unguarded read>`. Any
 * skip — unresolvable package, opt-out, read or write error — exits 1,
 * because nothing was verified.
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { argv, env, exit, stdout } from 'node:process';

/** Unguarded reads and their optional-chained replacements. */
const GUARDS = [
  { from: 'url: pageError.location.url', to: 'url: (pageError.location?.url ?? "")' },
  { from: 'line: pageError.location.lineNumber', to: 'line: (pageError.location?.lineNumber ?? 0)' },
  {
    from: 'column: pageError.location.columnNumber',
    to: 'column: (pageError.location?.columnNumber ?? 0)',
  },
];

const BUNDLE_SUBPATH = ['lib', 'coreBundle.js'];

const STRICT_FLAG = '--strict';

/**
 * Locate `coreBundle.js` in whichever `playwright-core` the host tree resolved.
 *
 * <p>Resolves via `package.json` because the package's `exports` map does not
 * expose internal `lib/` paths.
 *
 * @returns Absolute bundle path, or empty string when unresolvable.
 */
function resolveBundlePath() {
  try {
    const require = createRequire(import.meta.url);
    const manifest = require.resolve('playwright-core/package.json');
    return join(dirname(manifest), ...BUNDLE_SUBPATH);
  } catch {
    return '';
  }
}

/**
 * Apply every guard to the bundle source.
 *
 * @param source - Current `coreBundle.js` contents.
 * @returns Rewritten source plus the number of substitutions made.
 */
function applyGuards(source) {
  let text = source;
  let count = 0;
  for (const guard of GUARDS) {
    const parts = text.split(guard.from);
    count += parts.length - 1;
    text = parts.join(guard.to);
  }
  return { text, count };
}

/**
 * List the guards whose optional-chained form is absent from the source.
 *
 * @param source - `coreBundle.js` contents after patching.
 * @returns Indexes into `GUARDS`; empty when every guard is present.
 */
function missingGuards(source) {
  return GUARDS.flatMap((guard, index) => (source.includes(guard.to) ? [] : [index]));
}

/**
 * Rewrite the bundle in place when at least one guard is missing.
 *
 * <p>Zero substitutions is ambiguous: the guard may already be applied, or
 * the resolved build may simply not contain the expected forms. Reporting
 * "already guarded" for the second case would promise protection that is
 * not there, so the guarded forms are confirmed before claiming success.
 *
 * @param bundlePath - Absolute path to `coreBundle.js`.
 * @returns Outcome for the install log plus the guards still missing.
 */
function patchBundle(bundlePath) {
  const result = applyGuards(readFileSync(bundlePath, 'utf8'));
  const missing = missingGuards(result.text);
  if (result.count > 0) {
    writeFileSync(bundlePath, result.text, 'utf8');
    return { outcome: `guarded ${result.count} pageError.location read(s)`, missing };
  }
  if (missing.length === 0) return { outcome: 'already guarded', missing };
  return { outcome: 'NOT APPLIED — no known pageError.location read in this build', missing };
}

/**
 * Build the result of a run that never inspected the bundle.
 *
 * @param reason - Why the bundle was not inspected.
 * @returns Outcome with `missing: null`, which strict mode never accepts.
 */
function skipped(reason) {
  return { outcome: `skipped (${reason})`, missing: null };
}

/**
 * Run the patch, absorbing every failure so an install can never break.
 *
 * @returns Outcome plus missing guard indexes (`null` when not inspected).
 */
function run() {
  if (env['SKIP_PLAYWRIGHT_CORE_PATCH']) return skipped('SKIP_PLAYWRIGHT_CORE_PATCH set');
  const bundlePath = resolveBundlePath();
  if (!bundlePath) return skipped('playwright-core not resolvable');
  try {
    return patchBundle(bundlePath);
  } catch (error) {
    return skipped(error instanceof Error ? error.message : 'unknown error');
  }
}

/**
 * Write one line to stdout so the outcome is visible in install output.
 *
 * @param line - Text to print.
 */
function report(line) {
  stdout.write(`${line}\n`);
}

/**
 * Report the run and decide the exit code.
 *
 * @returns 0 by default; under `--strict`, 0 only when every guard is present.
 */
function main() {
  const result = run();
  report(`playwright-core pageError guard: ${result.outcome}`);
  if (!argv.slice(2).includes(STRICT_FLAG)) return 0;
  for (const index of result.missing ?? []) report(`MISSING-GUARD ${index} ${GUARDS[index].from}`);
  return result.missing?.length === 0 ? 0 : 1;
}

exit(main());
