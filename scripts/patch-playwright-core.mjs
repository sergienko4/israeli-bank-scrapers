#!/usr/bin/env node
/**
 * Keeps the installed `playwright-core` working against Camoufox: it
 * null-guards `pageError.location`, shims request interception, and splits
 * multi-value `Set-Cookie` headers.
 *
 * pageError guard. This library subscribes to `page.on('pageerror')`
 * (see `Mediator/Init/PageObservers.ts` and
 * `Mediator/Network/AuthFailureWatcher/Factory.ts`). Playwright's
 * `BrowserContextDispatcher` forwards every such event and reads
 * `pageError.location.url` unguarded. Camoufox (Firefox) can emit an
 * uncaught page error with NO location, so that read throws
 * `TypeError: Cannot read properties of undefined` from inside
 * playwright-core — killing a scrape for a reason no stack trace of ours
 * explains. Upstream 1.64.1 (latest stable) still ships the unguarded read.
 *
 * Interception shim. playwright-core 1.64 added `bypassServiceWorker` to
 * Juggler's `Network.setRequestInterception`. No released Camoufox accepts
 * the field, so `page.route()` fails with a protocol error;
 * `context.route()` uses `Browser.setRequestInterception`, which did not
 * change. A consumer whose `^` range resolves 1.64 gets that build,
 * so the shim drops the field and sends the 1.63 payload `{ enabled }`.
 *
 * Set-Cookie split. Camoufox's Juggler reports every `Set-Cookie` of a
 * response as one header whose value joins the cookies with newlines.
 * playwright-core 1.63 split it; 1.64 expects one field per header, as
 * upstream Firefox now sends, so `headersArray()` and `headerValues()` would
 * return one entry for several cookies. The split restores 1.63's result for
 * `Set-Cookie` only, at the Firefox network manager's one response site;
 * other headers keep the value Juggler sent, as 1.64 intends. A 1.63 build
 * needs neither the shim nor the split and is left as it is.
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
 * that default mode always exits 0), never writes a copy whose guard,
 * shim and split are already present, and never leaves a bundle half
 * written: the patched text goes to a scratch file that is renamed over the
 * bundle, so a write that fails leaves the original whole. Set
 * `SKIP_PLAYWRIGHT_CORE_PATCH=1` to opt out.
 * Any argument other than a single `--strict` is a usage error (exit 2,
 * nothing resolved or written), so a mistyped flag cannot pass as an
 * unproven run.
 *
 * `--strict` (CI only; postinstall never passes it) turns the outcome into
 * proof: exit 0 only when, after patching, every copy has each guarded form at
 * exactly `REVIEWED_SITES` sites. It is checked per guard and per site,
 * because a renamed read can hide behind the other reads or behind its own
 * copy at another site. Each mismatch prints
 * `GUARD-SITES <index> <found>/<reviewed> <unguarded read>`. No
 * `pageError.location` member read may stay unguarded, whether written with
 * `.`, `?.` on `pageError`, or quoted brackets, so a read the exact forms
 * missed prints
 * `GUARD-LEFT <count> unguarded pageError.location read(s)`. Likewise the
 * interception call must be sent at exactly `REVIEWED_CALLS` sites, each
 * with `{ enabled }` alone; every mention of the method name counts as a
 * send, whatever its quoting or line breaks. Otherwise it prints
 * `SHIM-SITES <shimmed>/<reviewed> (<sent> sent) <shimmed form>`. The
 * Firefox response must be built from a Juggler event at exactly
 * `REVIEWED_RESPONSES` sites, whatever their formatting or arguments,
 * each splitting `Set-Cookie` in a known form (1.63's own or the patched
 * one); otherwise it prints
 * `COOKIE-SITES <known>/<reviewed> (<sites> sites) <site>`.
 * Any skip — no copy found, opt-out, or a read or write error on any copy —
 * exits 1, because that copy was not verified.
 */
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  chmodSync,
  existsSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
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

/** Bits of `st_mode` that `chmod` sets. */
const PERMISSION_BITS = 0o777;

/**
 * A member read of `pageError.location` that `?.` does not protect: `location`
 * reached by `.`, `?.` or a quoted bracket key, then a field read by `.` or
 * `[`, with any spacing. Text, not syntax: a mention in a comment also counts,
 * so it fails closed. In the reviewed bundles every such read is one the
 * guards rewrite, so one left after patching is a read their exact forms missed.
 */
const UNGUARDED_READ =
  /\bpageError\s*(?:\??\.\s*location|(?:\?\.\s*)?\[\s*(["'`])location\1\s*\])\s*[.[]/g;

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
 * The arguments after the header list in the Firefox network manager's
 * `new Response(...)`, which locate a response site in every reviewed build.
 */
const RESPONSE_SITE = 'timing, getResponseBody, event.fromServiceWorker';

/** How the Firefox network manager starts a response built from a Juggler event. */
const RESPONSE_HEAD = String.raw`new [\w$]+\([\w$.]+, event\.status, `;

/**
 * Every response built from a Juggler event: a `new` expression that reads
 * `event.status` within its statement, whatever its formatting or arguments,
 * so a site the exact rewrite cannot read is still counted. It over-counts
 * rather than under-counts, so a stray match fails `--strict` loudly.
 */
const RESPONSE_BUILD = /new\s+[\w$]+\s*\([^;]*?\bevent\.status\b/gu;

/**
 * A header-list form, matched only where a response build starts it, so the
 * same text anywhere else is neither rewritten nor counted.
 *
 * @param form - Exact text that follows the response head.
 * @returns Pattern `rewrite` and `occurrences` split on.
 */
function atResponse(form) {
  const literal = form.replace(/[\\^$.*+?()[\]{}|]/gu, String.raw`\$&`);
  return new RegExp(`(?<=${RESPONSE_HEAD})${literal}`, 'u');
}

/**
 * 1.64's header list, which passes Juggler's newline-joined `Set-Cookie`
 * through as one header, and the split it becomes: `Set-Cookie` only, one
 * trimmed header per line as 1.63 made them, every other header as Juggler
 * sent it. Self-contained, so it never calls a bundle-internal helper that a
 * later build could rename.
 */
const COOKIE = {
  from: atResponse(`event.statusText, event.headers, ${RESPONSE_SITE}`),
  to: `event.statusText, event.headers.flatMap((header) => header.name.toLowerCase() === "set-cookie" ? header.value.split("\\n").map((value) => ({ name: header.name, value: value.trim() })) : [header]), ${RESPONSE_SITE}`,
};

/** Header lists that split `Set-Cookie`: 1.63's own and the patched 1.64 one. */
const COOKIE_KNOWN = [
  atResponse(`event.statusText, parseMultivalueHeaders(event.headers), ${RESPONSE_SITE}`),
  atResponse(COOKIE.to),
];

/** Response sites in the reviewed playwright-core: the Firefox network manager's one. */
const REVIEWED_RESPONSES = 1;

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
 * @param rewrites - `{ from, to }` pairs, applied in order; `from` is exact
 *   text or a pattern.
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
 * @param form - Exact text or pattern to count.
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
 * @returns Outcome, guarded sites per guard (index-aligned with `GUARDS`),
 *   and the `UNGUARDED_READ` matches left after patching.
 */
function guardResult(count, text) {
  const sites = GUARDS.map(guard => occurrences(text, guard.to));
  const found = { sites, left: text.match(UNGUARDED_READ)?.length ?? 0 };
  if (count > 0) return { outcome: `guarded ${count} pageError.location read(s)`, ...found };
  if (!sites.includes(0)) return { outcome: 'already guarded', ...found };
  return { outcome: 'NOT APPLIED — no known pageError.location read in this build', ...found };
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
 * Describe the Set-Cookie split after patching.
 *
 * <p>A 1.63 build splits `Set-Cookie` itself, as does an already patched 1.64
 * build, so both report it already split. Every response built from a Juggler
 * event counts as a site, whatever its formatting or arguments, so a
 * site the exact rewrite cannot read is still counted; a known form counts
 * only where a response build starts it.
 *
 * @param count - Response sites split by this run.
 * @param text - Bundle text after patching.
 * @returns Outcome plus the known-form and the total response sites.
 */
function cookieResult(count, text) {
  const known = COOKIE_KNOWN.reduce((sum, form) => sum + occurrences(text, form), 0);
  const responses = { known, sites: text.match(RESPONSE_BUILD)?.length ?? 0 };
  if (count > 0) return { outcome: `split Set-Cookie at ${count} response site(s)`, responses };
  const isSplit = responses.sites > 0 && responses.known === responses.sites;
  if (isSplit) return { outcome: 'Set-Cookie already split', responses };
  const sites = `${responses.known} of ${responses.sites} response site(s)`;
  return { outcome: `NOT APPLIED — ${sites} in a known form`, responses };
}

/**
 * Remove an abandoned scratch file without masking the failure that
 * abandoned it.
 *
 * @param tempPath - Scratch file path.
 */
function discardTemp(tempPath) {
  try {
    rmSync(tempPath, { force: true });
  } catch {
    // The original write or rename error is the one to report.
  }
}

/**
 * Replace the file at `path` with `text`: write a new, uniquely named file
 * in the same directory with the old file's permission bits, then rename it
 * over the target. The rename is atomic, so a reader sees the whole old file
 * or the whole new one, and a failed write leaves the old file as it was.
 *
 * @param path - File to replace.
 * @param text - New contents.
 */
function replaceFile(path, text) {
  const tempPath = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tempPath, text, { encoding: 'utf8', flag: 'wx' });
    chmodSync(tempPath, statSync(path).mode & PERMISSION_BITS);
    renameSync(tempPath, path);
  } catch (error) {
    discardTemp(tempPath);
    throw error;
  }
}

/**
 * Replace the bundle when a guard, the shim or the split is missing.
 *
 * @param bundlePath - Absolute path to `coreBundle.js`.
 * @returns Guard, shim and split results for the install log.
 */
function patchBundle(bundlePath) {
  const guarded = rewrite(readFileSync(bundlePath, 'utf8'), GUARDS);
  const shimmed = rewrite(guarded.text, [SHIM]);
  const split = rewrite(shimmed.text, [COOKIE]);
  const count = guarded.count + shimmed.count + split.count;
  if (count > 0) replaceFile(bundlePath, split.text);
  const guard = guardResult(guarded.count, split.text);
  const shim = shimResult(shimmed.count, split.text);
  return { guard, shim, cookie: cookieResult(split.count, split.text) };
}

/**
 * Build the result of a run that never inspected the bundle.
 *
 * @param reason - Why the bundle was not inspected.
 * @returns Guard, shim and split results with `null` counts, which strict
 *   mode never accepts.
 */
function skipped(reason) {
  const outcome = `skipped (${reason})`;
  const guard = { outcome, sites: null, left: null };
  return { guard, shim: { outcome, calls: null }, cookie: { outcome, responses: null } };
}

/**
 * Patch one copy, absorbing every failure so an install can never break.
 *
 * @param copyDir - Real playwright-core directory.
 * @returns Guard, shim and split results (`null` counts when not inspected).
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
 * Describe the `pageError.location` reads still unguarded after patching.
 *
 * @param left - `UNGUARDED_READ` matches left; `null` when not inspected.
 * @returns One `GUARD-LEFT` line when any remain; empty otherwise.
 */
function leftMismatches(left) {
  if (!left) return [];
  return [`GUARD-LEFT ${left} unguarded pageError.location read(s)`];
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
 * Describe the Set-Cookie split when its response sites differ from the review.
 *
 * @param responses - Known-form and total response sites; `null` when not inspected.
 * @returns One `COOKIE-SITES` line on a mismatch; empty otherwise.
 */
function cookieMismatches(responses) {
  if (responses === null) return [];
  const { known, sites } = responses;
  if (known === REVIEWED_RESPONSES && sites === REVIEWED_RESPONSES) return [];
  return [`COOKIE-SITES ${known}/${REVIEWED_RESPONSES} (${sites} sites) ${RESPONSE_SITE}`];
}

/**
 * Every mismatch `--strict` reports for one copy, guard first.
 *
 * @param result - Guard, shim and split results of one copy.
 * @returns The mismatch lines; empty when the copy matches the review.
 */
function strictMismatches({ guard, shim, cookie }) {
  const guardLines = [...siteMismatches(guard.sites ?? []), ...leftMismatches(guard.left)];
  return [...guardLines, ...shimMismatches(shim.calls), ...cookieMismatches(cookie.responses)];
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
 * @param result - Guard, shim, split and label of one copy.
 * @param isStrict - Whether `--strict` was passed.
 * @returns `true` when not strict, or every check of the copy matched the review.
 */
function reportCopy(result, isStrict) {
  const { guard, shim, cookie, label } = result;
  if (label) report(`playwright-core copy: ${label}`);
  report(`playwright-core pageError guard: ${guard.outcome}`);
  report(`playwright-core interception shim: ${shim.outcome}`);
  report(`playwright-core Set-Cookie split: ${cookie.outcome}`);
  if (!isStrict) return true;
  const mismatches = strictMismatches(result);
  for (const line of mismatches) report(line);
  return guard.sites !== null && mismatches.length === 0;
}

/**
 * Report the run and decide the exit code.
 *
 * @returns 0 by default; under `--strict`, 0 only when, in every copy, every
 *   guard has exactly `REVIEWED_SITES` guarded sites, no read is left
 *   unguarded, every interception call is one of the `REVIEWED_CALLS`
 *   shimmed sends, and every response site is one of the
 *   `REVIEWED_RESPONSES` that split `Set-Cookie`.
 */
function main() {
  const isStrict = strictMode();
  const proven = run().map(result => reportCopy(result, isStrict));
  return proven.every(Boolean) ? 0 : 1;
}

exit(main());
