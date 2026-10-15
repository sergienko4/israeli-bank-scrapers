#!/usr/bin/env node
/**
 * Keeps the installed `playwright-core` working against Camoufox: it
 * null-guards `pageError.location` and shims request interception.
 *
 * pageError guard. This library subscribes to `page.on('pageerror')`
 * (see `Mediator/Init/PageObservers.ts` and
 * `Mediator/Network/AuthFailureWatcher/Factory.ts`). Playwright's
 * `BrowserContextDispatcher` forwards every such event and reads
 * `pageError.location.url` unguarded. Camoufox (Firefox) can emit an
 * uncaught page error with NO location, so that read throws
 * `TypeError: Cannot read properties of undefined` from inside
 * playwright-core — killing a scrape for a reason no stack trace of ours
 * explains. Upstream 1.62.1 (latest stable) still ships the unguarded read.
 *
 * Interception shim. playwright-core 1.64 added `bypassServiceWorker` to
 * Juggler's `Network.setRequestInterception`. No released Camoufox accepts
 * the field, so `page.route()` fails with a protocol error;
 * `context.route()` uses `Browser.setRequestInterception`, which did not
 * change. A consumer whose `^` range resolves 1.64 gets that build,
 * so the shim drops the field and sends the 1.63 payload `{ enabled }`.
 * It restores routing only: 1.64's other changes (multi-value `Set-Cookie`
 * headers) remain, which is why this library stays tested on the
 * playwright-core minor named in `browser-stack.json`.
 *
 * Every copy. camoufox-js takes playwright-core as a peer and imports it
 * from its own location, and that copy drives the browser. A dependency
 * tree can hold more than one copy — nested under camoufox-js, hoisted at
 * another version, or symlinked by pnpm — so the script patches each
 * distinct real copy: the one this package resolves and the one camoufox-js
 * resolves. With one copy the output is unchanged; with more, each copy's
 * lines follow a `playwright-core copy: <path>` header, the path relative
 * to this package.
 *
 * Why not `patch-package`. Its patch file is keyed to an exact version
 * (`playwright-core+1.62.0.patch`) and it is a dev-only tool, so a published
 * consumer never runs it and the fix silently never reached them. This
 * script is dependency-free, version-agnostic, and idempotent, so it works
 * for contributors and consumers through the same code path.
 *
 * Guarantees: never fails an install (postinstall passes no arguments, and
 * that default mode always exits 0) and never writes a copy whose guard and
 * shim are already present. Set `SKIP_PLAYWRIGHT_CORE_PATCH=1` to opt out.
 * Any argument other than a single `--strict` is a usage error (exit 2,
 * nothing resolved or written), so a mistyped flag cannot pass as an
 * unproven run.
 *
 * `--strict` (CI only; postinstall never passes it) turns the outcome into
 * proof: exit 0 only when, after patching, every copy has each guarded form at
 * exactly `REVIEWED_SITES` sites. It is checked per guard and per site,
 * because a renamed read can hide behind the other reads or behind its own
 * copy at another site. Each mismatch prints
 * `GUARD-SITES <index> <found>/<reviewed> <unguarded read>`. Likewise the
 * interception call must be sent at exactly `REVIEWED_CALLS` sites, each
 * with `{ enabled }` alone; every mention of the method name counts as a
 * send, whatever its quoting or line breaks. Otherwise it prints
 * `SHIM-SITES <shimmed>/<reviewed> (<sent> sent) <shimmed form>`. Any skip —
 * no copy found, opt-out, or a read or write error on any copy — exits 1,
 * because that copy was not verified.
 */
import { createRequire } from 'node:module';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { argv, env, exit, stderr, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';

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

const PLAYWRIGHT_PACKAGE = 'playwright-core';

/** camoufox-js, whose own playwright-core copy drives the browser. */
const CAMOUFOX_PACKAGE = '@hieutran094/camoufox-js';

/** This package's root, which copy labels are relative to. */
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const STRICT_FLAG = '--strict';
const USAGE = `usage: node scripts/patch-playwright-core.mjs [${STRICT_FLAG}]`;

/**
 * Sites per read in the reviewed playwright-core: the BrowserContext
 * dispatcher and the trace recorder each build a pageError location.
 * Change it only after reading every pageError site of the new bundle.
 */
const REVIEWED_SITES = 2;

/** Juggler's request-interception method. */
const INTERCEPTION_METHOD = 'Network.setRequestInterception';

/** The method as playwright-core's Firefox network manager sends it, the payload next. */
const INTERCEPTION_CALL = `"${INTERCEPTION_METHOD}", `;

/** The 1.64 payload no released Camoufox accepts, and the 1.63 payload it becomes. */
const SHIM = {
  from: `${INTERCEPTION_CALL}{ enabled, bypassServiceWorker }`,
  to: `${INTERCEPTION_CALL}{ enabled }`,
};

/** Interception calls in the reviewed playwright-core: the network manager's one send. */
const REVIEWED_CALLS = 1;

/**
 * The real directory of the `packageName` copy Node loads from `from`.
 *
 * <p>The directory is looked up along Node's own search paths rather than
 * resolved, because an `exports` map need not expose `package.json`. The real
 * path keeps symlinked layouts, such as pnpm's, pointing where the package
 * really lives, and makes two routes to one copy compare equal.
 *
 * @param from - Module path or file URL the lookup starts from.
 * @param packageName - Package to find.
 * @returns Real package directory, or empty string when not found.
 */
function findPackageDir(from, packageName) {
  const searchDirs = createRequire(from).resolve.paths(packageName) ?? [];
  const dirs = searchDirs.map(dir => join(dir, packageName));
  const found = dirs.find(dir => existsSync(join(dir, 'package.json')));
  return found === undefined ? '' : realpathSync(found);
}

/**
 * The playwright-core copy camoufox-js loads.
 *
 * @returns Its real directory, or empty string when either is missing.
 */
function camoufoxPlaywrightDir() {
  const camoufoxDir = findPackageDir(import.meta.url, CAMOUFOX_PACKAGE);
  if (camoufoxDir === '') return '';
  return findPackageDir(join(camoufoxDir, 'package.json'), PLAYWRIGHT_PACKAGE);
}

/**
 * Every distinct playwright-core copy to patch: this package's and
 * camoufox-js's, deduplicated by real path.
 *
 * @returns Real package directories; empty when none resolves.
 */
function resolveCopies() {
  try {
    const dirs = [findPackageDir(import.meta.url, PLAYWRIGHT_PACKAGE), camoufoxPlaywrightDir()];
    return [...new Set(dirs.filter(dir => dir !== ''))];
  } catch {
    return [];
  }
}

/**
 * Apply each rewrite to the bundle source.
 *
 * @param source - Current `coreBundle.js` contents.
 * @param rewrites - `{ from, to }` pairs, applied in order.
 * @returns Rewritten source plus the number of substitutions made.
 */
function rewrite(source, rewrites) {
  let text = source;
  let count = 0;
  for (const { from, to } of rewrites) {
    const parts = text.split(from);
    count += parts.length - 1;
    text = parts.join(to);
  }
  return { text, count };
}

/**
 * Count the occurrences of a form in the source.
 *
 * @param source - `coreBundle.js` contents.
 * @param form - Exact text to count.
 * @returns Occurrences.
 */
function occurrences(source, form) {
  return source.split(form).length - 1;
}

/**
 * Describe the pageError guard after patching.
 *
 * <p>Zero substitutions is ambiguous: the guard may already be applied, or
 * the resolved build may simply not contain the expected forms. Reporting
 * "already guarded" for the second case would promise protection that is
 * not there, so the guarded forms are confirmed before claiming success.
 *
 * @param count - Reads guarded by this run.
 * @param text - Bundle text after patching.
 * @returns Outcome plus guarded sites per guard, index-aligned with `GUARDS`.
 */
function guardResult(count, text) {
  const sites = GUARDS.map(guard => occurrences(text, guard.to));
  if (count > 0) return { outcome: `guarded ${count} pageError.location read(s)`, sites };
  if (!sites.includes(0)) return { outcome: 'already guarded', sites };
  return { outcome: 'NOT APPLIED — no known pageError.location read in this build', sites };
}

/**
 * Describe the interception shim after patching.
 *
 * <p>A 1.63 build already sends `{ enabled }` alone, as does an already
 * shimmed 1.64 build, so both report that no `bypassServiceWorker` is sent.
 * Every mention of the method name counts as a send, whatever its quoting or
 * line breaks, so a send the exact rewrite cannot read is still counted.
 *
 * @param count - Calls shimmed by this run.
 * @param text - Bundle text after patching.
 * @returns Outcome plus the shimmed and the total interception calls.
 */
function shimResult(count, text) {
  const sent = occurrences(text, INTERCEPTION_METHOD);
  const calls = { shimmed: occurrences(text, SHIM.to), sent };
  if (count > 0) return { outcome: `dropped bypassServiceWorker from ${count} call(s)`, calls };
  const isEnabledOnly = calls.sent > 0 && calls.shimmed === calls.sent;
  if (isEnabledOnly) return { outcome: 'no bypassServiceWorker sent', calls };
  const known = `${calls.shimmed} of ${calls.sent} Network.setRequestInterception send(s)`;
  return { outcome: `NOT APPLIED — ${known} in a known form`, calls };
}

/**
 * Rewrite the bundle in place when a guard or the shim is missing.
 *
 * @param bundlePath - Absolute path to `coreBundle.js`.
 * @returns Guard and shim results for the install log.
 */
function patchBundle(bundlePath) {
  const guarded = rewrite(readFileSync(bundlePath, 'utf8'), GUARDS);
  const shimmed = rewrite(guarded.text, [SHIM]);
  if (guarded.count + shimmed.count > 0) writeFileSync(bundlePath, shimmed.text, 'utf8');
  const guard = guardResult(guarded.count, shimmed.text);
  return { guard, shim: shimResult(shimmed.count, shimmed.text) };
}

/**
 * Build the result of a run that never inspected the bundle.
 *
 * @param reason - Why the bundle was not inspected.
 * @returns Guard and shim results with `null` counts, which strict mode
 *   never accepts.
 */
function skipped(reason) {
  const outcome = `skipped (${reason})`;
  return { guard: { outcome, sites: null }, shim: { outcome, calls: null } };
}

/**
 * Patch one copy, absorbing every failure so an install can never break.
 *
 * @param copyDir - Real playwright-core directory.
 * @returns Guard and shim results (`null` counts when not inspected).
 */
function patchCopy(copyDir) {
  try {
    return patchBundle(join(copyDir, ...BUNDLE_SUBPATH));
  } catch (error) {
    return skipped(error instanceof Error ? error.message : 'unknown error');
  }
}

/**
 * Run the patch on every copy.
 *
 * @returns One result per copy, labelled with its path when there are
 *   several; a single skipped result when no copy was inspected.
 */
function run() {
  if (env['SKIP_PLAYWRIGHT_CORE_PATCH']) return [skipped('SKIP_PLAYWRIGHT_CORE_PATCH set')];
  const copies = resolveCopies();
  if (copies.length === 0) return [skipped('playwright-core not resolvable')];
  const isSeveral = copies.length > 1;
  return copies.map(copyDir => ({
    ...patchCopy(copyDir),
    label: isSeveral ? relative(PACKAGE_ROOT, copyDir) : '',
  }));
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
 * Describe every guard whose guarded sites differ from `REVIEWED_SITES`.
 *
 * @param sites - Guarded sites per guard.
 * @returns One `GUARD-SITES` line per mismatch; empty when all match.
 */
function siteMismatches(sites) {
  return sites.flatMap((found, index) =>
    found === REVIEWED_SITES
      ? []
      : [`GUARD-SITES ${index} ${found}/${REVIEWED_SITES} ${GUARDS[index].from}`],
  );
}

/**
 * Describe the interception shim when its calls differ from the review.
 *
 * @param calls - Shimmed and total interception calls; `null` when not inspected.
 * @returns One `SHIM-SITES` line on a mismatch; empty otherwise.
 */
function shimMismatches(calls) {
  if (calls === null) return [];
  if (calls.shimmed === REVIEWED_CALLS && calls.sent === REVIEWED_CALLS) return [];
  return [`SHIM-SITES ${calls.shimmed}/${REVIEWED_CALLS} (${calls.sent} sent) ${SHIM.to}`];
}

/**
 * Read the mode before anything is resolved or written.
 *
 * @returns Whether `--strict` was passed. Any other argument prints the
 *   usage and exits 2, so a mistyped flag cannot pass as an unproven run.
 */
function strictMode() {
  const args = argv.slice(2);
  if (args.length === 0) return false;
  if (args.length === 1 && args[0] === STRICT_FLAG) return true;
  stderr.write(`${USAGE}\n`);
  return exit(2);
}

/**
 * Report one copy and, under `--strict`, whether it was proven.
 *
 * @param result - Guard, shim and label of one copy.
 * @param isStrict - Whether `--strict` was passed.
 * @returns `true` when not strict, or every check of the copy matched the review.
 */
function reportCopy({ guard, shim, label }, isStrict) {
  if (label) report(`playwright-core copy: ${label}`);
  report(`playwright-core pageError guard: ${guard.outcome}`);
  report(`playwright-core interception shim: ${shim.outcome}`);
  if (!isStrict) return true;
  const mismatches = [...siteMismatches(guard.sites ?? []), ...shimMismatches(shim.calls)];
  for (const line of mismatches) report(line);
  return guard.sites !== null && mismatches.length === 0;
}

/**
 * Report the run and decide the exit code.
 *
 * @returns 0 by default; under `--strict`, 0 only when, in every copy, every
 *   guard has exactly `REVIEWED_SITES` guarded sites and every interception
 *   call is one of the `REVIEWED_CALLS` shimmed sends.
 */
function main() {
  const isStrict = strictMode();
  const proven = run().map(result => reportCopy(result, isStrict));
  return proven.every(Boolean) ? 0 : 1;
}

exit(main());
