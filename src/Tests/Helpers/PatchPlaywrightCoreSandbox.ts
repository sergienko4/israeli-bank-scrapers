/**
 * Sandbox for `scripts/patch-playwright-core.mjs` tests: a copy of the real
 * script under `<root>/scripts/`, a synthetic `<root>/node_modules/`, and a
 * run with a minimal environment. Shared by the single-copy and the
 * multi-copy suites so both drive the script exactly as an install does.
 */

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
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
export const NOT_APPLIED = 'NOT APPLIED — no known pageError.location read in this build';
const SITES_TAG = 'GUARD-SITES';

/** pageError sites in the reviewed playwright-core: the dispatcher and the trace recorder. */
export const REVIEWED_SITES = 2;

/** The interception payload every released Camoufox accepts, as playwright-core 1.63 sends it. */
export const SENT_163 = '"Network.setRequestInterception", { enabled }';

/** playwright-core 1.64's payload, whose `bypassServiceWorker` no released Camoufox accepts. */
export const SENT_164 = '"Network.setRequestInterception", { enabled, bypassServiceWorker }';

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
 * then the network manager's interception sends.
 *
 * @param sites - Location fields of each site, one per line.
 * @param calls - Interception sends; one 1.63 send by default.
 * @returns Synthetic `coreBundle.js` text.
 */
export function bundleOf(
  sites: readonly (readonly string[])[],
  calls: readonly string[] = [SENT_163],
): string {
  const builders = sites.map((reads): string => {
    const fields = reads.join(',\n        ');
    return `_onPageError(pageError, page) {\n  const event = {\n    params: {\n      location: {\n        ${fields}\n      },\n    },\n  };\n}\n`;
  });
  const sends = calls.map((call): string => `this._session.send(${call});\n`);
  return [...builders, ...sends].join('');
}

/**
 * The bundle text after a correct patch: every known read guarded, every
 * 1.64 send shimmed.
 *
 * @param sites - Reads of each site of the original bundle.
 * @param calls - Interception sends of the original bundle.
 * @returns Expected text.
 */
export function patchedBundleOf(
  sites: readonly (readonly string[])[],
  calls: readonly string[] = [SENT_163],
): string {
  const guarded = sites.map((reads): string[] =>
    reads.map((read): string => {
      const index = UNGUARDED.findIndex((form): boolean => form === read);
      return index < 0 ? read : GUARDED[index];
    }),
  );
  const shimmed = calls.map((call): string => (call === SENT_164 ? SENT_163 : call));
  return bundleOf(guarded, shimmed);
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
 * The two report lines every run prints, guard first.
 *
 * @param guard - Guard outcome.
 * @param shim - Shim outcome.
 * @returns Expected stdout.
 */
export function reportOf(guard: string, shim: string): string {
  return linesOf([PREFIX + guard, SHIM_PREFIX + shim]);
}
