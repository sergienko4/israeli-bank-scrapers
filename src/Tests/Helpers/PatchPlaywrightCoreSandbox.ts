/**
 * Sandbox for `scripts/patch-playwright-core.mjs` tests: a copy of the real
 * script under `<root>/scripts/`, a synthetic `<root>/node_modules/`, and a
 * run with a minimal environment. Shared by the single-copy, multi-copy and
 * Set-Cookie suites so each drives the script exactly as an install does.
 */

import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = dirname(THIS_FILE);
const REPO_ROOT = join(THIS_DIR, '../../../');
export const SCRIPT_NAME = 'patch-playwright-core.mjs';
export const SCRIPT = join(REPO_ROOT, 'scripts', SCRIPT_NAME);

/** The reads upstream ships unguarded, in the script's `GUARDS` order. */
export const UNGUARDED = [
  'url: pageError.location.url',
  'line: pageError.location.lineNumber',
  'column: pageError.location.columnNumber',
] as const;

/** The guarded form of each read, index-aligned with `UNGUARDED`. */
export const GUARDED = [
  'url: (pageError.location?.url ?? "")',
  'line: (pageError.location?.lineNumber ?? 0)',
  'column: (pageError.location?.columnNumber ?? 0)',
] as const;

/** A future build that renamed the read: same field, a name no guard targets. */
export const RENAMED = [
  'url: pageError.location.href',
  'line: pageError.location.line',
  'column: pageError.location.col',
] as const;

export const PREFIX = 'playwright-core pageError guard: ';
export const SHIM_PREFIX = 'playwright-core interception shim: ';
export const COOKIE_PREFIX = 'playwright-core Set-Cookie split: ';

/** The split outcome when every response site already splits Set-Cookie per line. */
export const COOKIE_CLEAN = 'Set-Cookie already split';
export const NOT_APPLIED = 'NOT APPLIED — no known pageError.location read in this build';
const SITES_TAG = 'GUARD-SITES';
const LEFT_TAG = 'GUARD-LEFT';

/** pageError sites in the reviewed playwright-core: the dispatcher and the trace recorder. */
export const REVIEWED_SITES = 2;

/** The interception payload every released Camoufox accepts, as playwright-core 1.63 sends it. */
export const SENT_163 = '"Network.setRequestInterception", { enabled }';

/** playwright-core 1.64's payload, whose `bypassServiceWorker` no released Camoufox accepts. */
export const SENT_164 = '"Network.setRequestInterception", { enabled, bypassServiceWorker }';

/**
 * The Firefox network manager's response, as upstream builds it, around its header list.
 *
 * @param headers - The header-list argument.
 * @returns The constructor call.
 */
export function responseOf(headers: string): string {
  const head = 'new Response2(request2.request, event.status, event.statusText, ';
  return `${head}${headers}, timing, getResponseBody, event.fromServiceWorker)`;
}

/** playwright-core 1.63's response: it splits Juggler's newline-joined Set-Cookie itself. */
export const RESPONSE_163 = responseOf('parseMultivalueHeaders(event.headers)');

/** 1.64's response, which passes Juggler's newline-joined Set-Cookie through as one header. */
export const RESPONSE_164 = responseOf('event.headers');

/** 1.64's response after the patch: Set-Cookie split per trimmed line, every other header as sent. */
export const RESPONSE_SPLIT = responseOf(
  'event.headers.flatMap((header) => header.name.toLowerCase() === "set-cookie" ? header.value.split("\\n").map((value) => ({ name: header.name, value: value.trim() })) : [header])',
);

/** A fixed past mtime; any write by the script moves it to "now". */
export const UNTOUCHED_MTIME = new Date('2000-01-01T00:00:00Z');
export const UNTOUCHED_MS = UNTOUCHED_MTIME.getTime();

/** One run of the patcher. */
export interface IRun {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** A sandbox root and the bundle path the script resolves inside it. */
export interface ISandbox {
  readonly root: string;
  readonly bundle: string;
}

const ROOTS: string[] = [];

/**
 * Remove every sandbox root created since the last call; run it after each test.
 *
 * @returns How many roots were removed.
 */
export function removeRoots(): number {
  const roots = ROOTS.splice(0);
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  return roots.length;
}

/**
 * The same reads at both reviewed sites.
 *
 * @param reads - Location reads of one site.
 * @returns Two sites with those reads.
 */
export function atBothSites(reads: readonly string[]): readonly (readonly string[])[] {
  return [reads, reads];
}

/**
 * Render one `_onPageError` event-builder per site, as upstream ships it,
 * then the network manager's interception sends and response constructions.
 *
 * @param sites - Location fields of each site, one per line.
 * @param calls - Interception sends; one 1.63 send by default.
 * @param responses - Firefox response constructions; one 1.63 response by default.
 * @returns Synthetic `coreBundle.js` text.
 */
export function bundleOf(
  sites: readonly (readonly string[])[],
  calls: readonly string[] = [SENT_163],
  responses: readonly string[] = [RESPONSE_163],
): string {
  const builders = sites.map((reads): string => {
    const fields = reads.join(',\n        ');
    return `_onPageError(pageError, page) {\n  const event = {\n    params: {\n      location: {\n        ${fields}\n      },\n    },\n  };\n}\n`;
  });
  const sends = calls.map((call): string => `this._session.send(${call});\n`);
  const built = responses.map((response): string => `const response2 = ${response};\n`);
  return [...builders, ...sends, ...built].join('');
}

/**
 * The bundle text after a correct patch: every known read guarded, every
 * 1.64 send shimmed, every 1.64 response split.
 *
 * @param sites - Reads of each site of the original bundle.
 * @param calls - Interception sends of the original bundle.
 * @param responses - Response constructions of the original bundle.
 * @returns Expected text.
 */
export function patchedBundleOf(
  sites: readonly (readonly string[])[],
  calls: readonly string[] = [SENT_163],
  responses: readonly string[] = [RESPONSE_163],
): string {
  const guarded = sites.map((reads): string[] =>
    reads.map((read): string => {
      const index = UNGUARDED.findIndex((form): boolean => form === read);
      return index < 0 ? read : GUARDED[index];
    }),
  );
  const shimmed = calls.map((call): string => (call === SENT_164 ? SENT_163 : call));
  const split = responses.map((made): string => (made === RESPONSE_164 ? RESPONSE_SPLIT : made));
  return bundleOf(guarded, shimmed, split);
}

/**
 * Create a sandbox root holding a copy of the real script.
 *
 * @returns Absolute root path.
 */
export function makeRoot(): string {
  const tempRoot = tmpdir();
  const prefix = join(tempRoot, 'patch-playwright-core-');
  const root = mkdtempSync(prefix);
  ROOTS.push(root);
  const scriptsDir = join(root, 'scripts');
  mkdirSync(scriptsDir);
  const copy = join(scriptsDir, SCRIPT_NAME);
  copyFileSync(SCRIPT, copy);
  return root;
}

/**
 * Create a sandbox whose `playwright-core` resolves but ships no bundle file.
 *
 * @returns The sandbox; its bundle path does not exist yet.
 */
export function sandboxWithoutBundle(): ISandbox {
  const root = makeRoot();
  const pkgDir = join(root, 'node_modules', 'playwright-core');
  const libDir = join(pkgDir, 'lib');
  mkdirSync(libDir, { recursive: true });
  const manifest = join(pkgDir, 'package.json');
  writeFileSync(manifest, '{"name":"playwright-core","version":"0.0.0"}');
  return { root, bundle: join(libDir, 'coreBundle.js') };
}

/**
 * Create a sandbox whose bundle holds the given sites, sends and responses,
 * with a fixed past mtime.
 *
 * @param sites - Location reads of each site written into the bundle.
 * @param calls - Interception sends written into the bundle.
 * @param responses - Response constructions written into the bundle.
 * @returns The sandbox.
 */
export function sandboxWithBundle(
  sites: readonly (readonly string[])[],
  calls: readonly string[] = [SENT_163],
  responses: readonly string[] = [RESPONSE_163],
): ISandbox {
  const sandbox = sandboxWithoutBundle();
  const text = bundleOf(sites, calls, responses);
  writeFileSync(sandbox.bundle, text);
  utimesSync(sandbox.bundle, UNTOUCHED_MTIME, UNTOUCHED_MTIME);
  return sandbox;
}

/**
 * Read the sandbox's bundle text.
 *
 * @param sandbox - Sandbox whose bundle exists.
 * @returns Bundle text.
 */
export function readBundle(sandbox: ISandbox): string {
  return readFileSync(sandbox.bundle, 'utf8');
}

/**
 * Read a file's modification time.
 *
 * @param path - File path.
 * @returns Modification time in ms since the epoch.
 */
export function mtimeOf(path: string): number {
  return statSync(path).mtimeMs;
}

/**
 * Run the sandbox's copy of the script with a minimal environment.
 *
 * @param sandbox - Sandbox to run in.
 * @param args - Arguments after the script path.
 * @param env - Extra environment variables.
 * @returns Exit status (-1 when killed) and both output streams.
 */
export function runPatcher(
  sandbox: ISandbox,
  args: readonly string[],
  env: Readonly<Record<string, string>> = {},
): IRun {
  const script = join(sandbox.root, 'scripts', SCRIPT_NAME);
  const fullEnv = { PATH: process.env.PATH ?? '', HOME: sandbox.root, ...env };
  const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env: fullEnv });
  return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

/**
 * Join lines as the script prints them.
 *
 * @param lines - Expected lines.
 * @returns Text with a newline after each line.
 */
export function linesOf(lines: readonly string[]): string {
  return lines.map((line): string => `${line}\n`).join('');
}

/**
 * The `GUARD-SITES` line `--strict` prints for one guard off the reviewed count.
 *
 * @param index - Index into the script's `GUARDS`.
 * @param found - Guarded sites of that read after patching.
 * @returns Expected line.
 */
export function sitesLine(index: number, found: number): string {
  return `${SITES_TAG} ${String(index)} ${String(found)}/${String(REVIEWED_SITES)} ${UNGUARDED[index]}`;
}

/**
 * The `GUARD-SITES` line of every guard, all with the same found count.
 *
 * @param found - Guarded sites of each read after patching.
 * @returns Expected lines, in `GUARDS` order.
 */
export function allSitesLines(found: number): string[] {
  return UNGUARDED.map((_read, index): string => sitesLine(index, found));
}

/**
 * The `GUARD-LEFT` line `--strict` prints when unguarded reads remain after patching.
 *
 * @param left - `pageError.location` member reads still unguarded after patching.
 * @returns Expected line.
 */
export function leftLine(left: number): string {
  return `${LEFT_TAG} ${String(left)} unguarded pageError.location read(s)`;
}

/**
 * The three report lines every run prints: guard, shim, then Set-Cookie split.
 *
 * @param guard - Guard outcome.
 * @param shim - Shim outcome.
 * @param cookie - Set-Cookie split outcome.
 * @returns Expected stdout.
 */
export function reportOf(guard: string, shim: string, cookie: string): string {
  return linesOf([PREFIX + guard, SHIM_PREFIX + shim, COOKIE_PREFIX + cookie]);
}
