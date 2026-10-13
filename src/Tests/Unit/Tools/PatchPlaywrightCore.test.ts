/**
 * Unit test for `scripts/patch-playwright-core.mjs`.
 *
 * <p>The patcher null-guards three `pageError.location` reads inside the
 * installed playwright-core. Postinstall must never fail an install, so the
 * default mode always exits 0 — which is exactly why a playwright-core bump
 * that renames one read would drop the fix silently. `--strict` is the CI
 * proof: exit 0 only when every guarded form is present after patching,
 * checked per guard so one lost form cannot hide behind the other two.
 *
 * <p>Every case runs the real script as a consumer's install does: a copy
 * sits in `<root>/scripts/` and resolves `playwright-core` from a synthetic
 * `<root>/node_modules/`. No test-only hook exists in the published script.
 * `HOME` points at the sandbox so Node's global module folders cannot leak
 * a real playwright-core into the "not resolvable" case.
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
const REPO_ROOT = join(THIS_DIR, '../../../../');
const SCRIPT_NAME = 'patch-playwright-core.mjs';
const SCRIPT = join(REPO_ROOT, 'scripts', SCRIPT_NAME);
const PACKAGE_JSON = join(REPO_ROOT, 'package.json');

/** The reads upstream ships unguarded, in the script's `GUARDS` order. */
const UNGUARDED = [
  'url: pageError.location.url',
  'line: pageError.location.lineNumber',
  'column: pageError.location.columnNumber',
] as const;

/** The guarded form of each read, index-aligned with `UNGUARDED`. */
const GUARDED = [
  'url: (pageError.location?.url ?? "")',
  'line: (pageError.location?.lineNumber ?? 0)',
  'column: (pageError.location?.columnNumber ?? 0)',
] as const;

/** A future build that renamed the read: same field, a name no guard targets. */
const RENAMED = [
  'url: pageError.location.href',
  'line: pageError.location.line',
  'column: pageError.location.col',
] as const;

const PREFIX = 'playwright-core pageError guard: ';
const NOT_APPLIED = 'NOT APPLIED — no known pageError.location read in this build';
const OPT_OUT_ENV = 'SKIP_PLAYWRIGHT_CORE_PATCH';

/** A fixed past mtime; any write by the script moves it to "now". */
const UNTOUCHED_MTIME = new Date('2000-01-01T00:00:00Z');
const UNTOUCHED_MS = UNTOUCHED_MTIME.getTime();

/** One run of the patcher. */
interface IRun {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** A sandbox root and the bundle path the script resolves inside it. */
interface ISandbox {
  readonly root: string;
  readonly bundle: string;
}

/** A synthetic bundle, the outcome line it yields, and the guards it lacks after patching. */
interface IBundleCase {
  readonly id: string;
  readonly what: string;
  readonly reads: readonly string[];
  readonly outcome: string;
  readonly missing: readonly number[];
}

/** A run that never inspects the bundle, so `--strict` must fail closed. */
interface ISkipCase {
  readonly id: string;
  readonly what: string;
  readonly make: () => ISandbox;
  readonly env: Readonly<Record<string, string>>;
  readonly outcome: RegExp;
}

const ROOTS: string[] = [];

afterEach(() => {
  for (const root of ROOTS.splice(0)) rmSync(root, { recursive: true, force: true });
});

/**
 * Replace one read of a list, leaving the others as they are.
 *
 * @param reads - Base reads.
 * @param index - Position to replace.
 * @param read - Replacement read.
 * @returns A new list.
 */
function withRead(reads: readonly string[], index: number, read: string): string[] {
  return reads.map((current, at): string => (at === index ? read : current));
}

/**
 * Render reads as the `_onPageError` event-builder upstream ships.
 *
 * @param reads - Location fields, one per line.
 * @returns Synthetic `coreBundle.js` text.
 */
function bundleOf(reads: readonly string[]): string {
  const fields = reads.join(',\n        ');
  return `_onPageError(pageError, page) {\n  const event = {\n    params: {\n      location: {\n        ${fields}\n      },\n    },\n  };\n}\n`;
}

/**
 * The bundle text after a correct patch: every known read guarded.
 *
 * @param reads - Reads of the original bundle.
 * @returns Expected text.
 */
function patchedBundleOf(reads: readonly string[]): string {
  const guarded = reads.map((read): string => {
    const index = UNGUARDED.findIndex((form): boolean => form === read);
    return index < 0 ? read : GUARDED[index];
  });
  return bundleOf(guarded);
}

/**
 * Create a sandbox root holding a copy of the real script.
 *
 * @returns Absolute root path.
 */
function makeRoot(): string {
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
function sandboxWithoutBundle(): ISandbox {
  const root = makeRoot();
  const pkgDir = join(root, 'node_modules', 'playwright-core');
  const libDir = join(pkgDir, 'lib');
  mkdirSync(libDir, { recursive: true });
  const manifest = join(pkgDir, 'package.json');
  writeFileSync(manifest, '{"name":"playwright-core","version":"0.0.0"}');
  return { root, bundle: join(libDir, 'coreBundle.js') };
}

/**
 * Create a sandbox whose bundle holds the given reads, with a fixed past mtime.
 *
 * @param reads - Location reads written into the bundle.
 * @returns The sandbox.
 */
function sandboxWithBundle(reads: readonly string[]): ISandbox {
  const sandbox = sandboxWithoutBundle();
  const text = bundleOf(reads);
  writeFileSync(sandbox.bundle, text);
  utimesSync(sandbox.bundle, UNTOUCHED_MTIME, UNTOUCHED_MTIME);
  return sandbox;
}

/**
 * Create a sandbox whose bundle ships every read unguarded.
 *
 * @returns The sandbox.
 */
function sandboxUnguarded(): ISandbox {
  return sandboxWithBundle(UNGUARDED);
}

/**
 * Create a sandbox with no `node_modules` at all.
 *
 * @returns The sandbox; nothing resolves from it.
 */
function sandboxUnresolvable(): ISandbox {
  const root = makeRoot();
  return { root, bundle: join(root, 'node_modules', 'playwright-core', 'lib', 'coreBundle.js') };
}

/**
 * Run the sandbox's copy of the script with a minimal environment.
 *
 * @param sandbox - Sandbox to run in.
 * @param args - Arguments after the script path.
 * @param env - Extra environment variables.
 * @returns Exit status (-1 when killed) and both output streams.
 */
function runPatcher(
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
function linesOf(lines: readonly string[]): string {
  return lines.map((line): string => `${line}\n`).join('');
}

/**
 * The `MISSING-GUARD` line `--strict` prints for one absent guard.
 *
 * @param index - Index into the script's `GUARDS`.
 * @returns Expected line.
 */
function missingLine(index: number): string {
  return `MISSING-GUARD ${String(index)} ${UNGUARDED[index]}`;
}

/**
 * Read the sandbox's bundle text.
 *
 * @param sandbox - Sandbox whose bundle exists.
 * @returns Bundle text.
 */
function readBundle(sandbox: ISandbox): string {
  return readFileSync(sandbox.bundle, 'utf8');
}

/**
 * The outcome text of a run, without the fixed prefix and trailing newline.
 *
 * @param run - A patcher run.
 * @returns Outcome text.
 */
function outcomeOf(run: IRun): string {
  const rest = run.stdout.slice(PREFIX.length);
  return rest.trimEnd();
}

/**
 * Read a file's modification time.
 *
 * @param path - File path.
 * @returns Modification time in ms since the epoch.
 */
function mtimeOf(path: string): number {
  return statSync(path).mtimeMs;
}

const BUNDLE_CASES: readonly IBundleCase[] = [
  {
    id: 'PPC-1',
    what: 'unguarded',
    reads: UNGUARDED,
    outcome: 'guarded 3 pageError.location read(s)',
    missing: [],
  },
  { id: 'PPC-2', what: 'already guarded', reads: GUARDED, outcome: 'already guarded', missing: [] },
  {
    id: 'PPC-3',
    what: 'two unguarded sites, as upstream ships',
    reads: [...UNGUARDED, ...UNGUARDED],
    outcome: 'guarded 6 pageError.location read(s)',
    missing: [],
  },
  {
    id: 'PPC-4',
    what: 'one read guarded, two unguarded',
    reads: withRead(UNGUARDED, 0, GUARDED[0]),
    outcome: 'guarded 2 pageError.location read(s)',
    missing: [],
  },
  { id: 'PPC-5', what: 'no known reads', reads: RENAMED, outcome: NOT_APPLIED, missing: [0, 1, 2] },
  ...UNGUARDED.map((_read, index): IBundleCase => ({
    id: `PPC-${String(6 + index)}`,
    what: `partial loss: read ${String(index)} renamed, the others unguarded`,
    reads: withRead(UNGUARDED, index, RENAMED[index]),
    outcome: 'guarded 2 pageError.location read(s)',
    missing: [index],
  })),
  ...GUARDED.map((_read, index): IBundleCase => ({
    id: `PPC-${String(9 + index)}`,
    what: `partial loss: read ${String(index)} renamed, the others already guarded`,
    reads: withRead(GUARDED, index, RENAMED[index]),
    outcome: NOT_APPLIED,
    missing: [index],
  })),
];

const SKIP_CASES: readonly ISkipCase[] = [
  {
    id: 'PPC-20',
    what: `${OPT_OUT_ENV}=1`,
    make: sandboxUnguarded,
    env: { [OPT_OUT_ENV]: '1' },
    outcome: /^skipped \(SKIP_PLAYWRIGHT_CORE_PATCH set\)$/u,
  },
  {
    id: 'PPC-21',
    what: 'playwright-core not resolvable',
    make: sandboxUnresolvable,
    env: {},
    outcome: /^skipped \(playwright-core not resolvable\)$/u,
  },
  {
    id: 'PPC-22',
    what: 'bundle unreadable',
    make: sandboxWithoutBundle,
    env: {},
    outcome: /^skipped \(ENOENT: /u,
  },
];

describe('patch-playwright-core default mode (postinstall)', () => {
  it.each(BUNDLE_CASES)('[$id] $what → exit 0, "$outcome", no MISSING-GUARD', bundleCase => {
    const sandbox = sandboxWithBundle(bundleCase.reads);
    const run = runPatcher(sandbox, []);
    expect(run).toEqual({ status: 0, stdout: linesOf([PREFIX + bundleCase.outcome]), stderr: '' });
  });

  it.each(BUNDLE_CASES)('[$id] $what → every known read guarded in place', bundleCase => {
    const sandbox = sandboxWithBundle(bundleCase.reads);
    runPatcher(sandbox, []);
    const text = readBundle(sandbox);
    const expected = patchedBundleOf(bundleCase.reads);
    expect(text).toBe(expected);
  });

  it.each([
    ['already guarded', GUARDED],
    ['no known reads', RENAMED],
  ])('[PPC-12] never writes when there is nothing to guard (%s)', (_what, reads) => {
    const sandbox = sandboxWithBundle(reads);
    runPatcher(sandbox, []);
    const mtime = mtimeOf(sandbox.bundle);
    expect(mtime).toBe(UNTOUCHED_MS);
  });

  it('[PPC-13] is idempotent: the second run reports already guarded and rewrites nothing', () => {
    const sandbox = sandboxWithBundle(UNGUARDED);
    runPatcher(sandbox, []);
    const once = readBundle(sandbox);
    utimesSync(sandbox.bundle, UNTOUCHED_MTIME, UNTOUCHED_MTIME);
    const second = runPatcher(sandbox, ['--strict']);
    const twice = readBundle(sandbox);
    const mtime = mtimeOf(sandbox.bundle);
    const expectedOut = linesOf([`${PREFIX}already guarded`]);
    expect(second).toEqual({ status: 0, stdout: expectedOut, stderr: '' });
    expect(twice).toBe(once);
    expect(mtime).toBe(UNTOUCHED_MS);
  });
});

describe('patch-playwright-core --strict (CI proof)', () => {
  it.each(BUNDLE_CASES)(
    '[$id] $what → exit 1 iff a guard is missing, each one named',
    bundleCase => {
      const sandbox = sandboxWithBundle(bundleCase.reads);
      const run = runPatcher(sandbox, ['--strict']);
      const expected = [PREFIX + bundleCase.outcome, ...bundleCase.missing.map(missingLine)];
      const status = bundleCase.missing.length > 0 ? 1 : 0;
      expect(run).toEqual({ status, stdout: linesOf(expected), stderr: '' });
    },
  );

  it.each(BUNDLE_CASES)('[$id] $what → patches exactly as the default mode does', bundleCase => {
    const sandbox = sandboxWithBundle(bundleCase.reads);
    runPatcher(sandbox, ['--strict']);
    const text = readBundle(sandbox);
    const expected = patchedBundleOf(bundleCase.reads);
    expect(text).toBe(expected);
  });
});

describe('patch-playwright-core skips', () => {
  it.each(SKIP_CASES)('[$id] $what → default exits 0 and leaves the bundle alone', skipCase => {
    const sandbox = skipCase.make();
    const run = runPatcher(sandbox, [], skipCase.env);
    const outcome = outcomeOf(run);
    const hasPrefix = run.stdout.startsWith(PREFIX);
    expect({ status: run.status, stderr: run.stderr }).toEqual({ status: 0, stderr: '' });
    expect(hasPrefix).toBe(true);
    expect(outcome).toMatch(skipCase.outcome);
    expect(run.stdout).not.toContain('MISSING-GUARD');
  });

  it.each(SKIP_CASES)('[$id] $what → --strict fails closed: exit 1, nothing verified', skipCase => {
    const sandbox = skipCase.make();
    const run = runPatcher(sandbox, ['--strict'], skipCase.env);
    const outcome = outcomeOf(run);
    expect({ status: run.status, stderr: run.stderr }).toEqual({ status: 1, stderr: '' });
    expect(outcome).toMatch(skipCase.outcome);
    expect(run.stdout).not.toContain('MISSING-GUARD');
  });

  it('[PPC-23] the opt-out leaves an unguarded bundle untouched', () => {
    const sandbox = sandboxWithBundle(UNGUARDED);
    runPatcher(sandbox, ['--strict'], { [OPT_OUT_ENV]: '1' });
    const text = readBundle(sandbox);
    const original = bundleOf(UNGUARDED);
    const mtime = mtimeOf(sandbox.bundle);
    expect(text).toBe(original);
    expect(mtime).toBe(UNTOUCHED_MS);
  });
});

describe('patch-playwright-core packaging contract', () => {
  const pkgText = readFileSync(PACKAGE_JSON, 'utf8');
  const pkg = JSON.parse(pkgText) as {
    scripts: Record<string, string>;
    files: string[];
  };

  it('[PPC-30] postinstall runs the default mode and can never fail an install', () => {
    expect(pkg.scripts.postinstall).toBe('node scripts/patch-playwright-core.mjs || exit 0');
  });

  it('[PPC-31] the script ships to consumers and imports only Node built-ins', () => {
    const source = readFileSync(SCRIPT, 'utf8');
    const matches = source.matchAll(/\bfrom '([^']+)'/gu);
    const specifiers = Array.from(matches, (match): string => match[1]);
    const foreign = specifiers.filter((specifier): boolean => !specifier.startsWith('node:'));
    expect(pkg.files).toContain(`scripts/${SCRIPT_NAME}`);
    expect(specifiers.length).toBeGreaterThan(0);
    expect(foreign).toEqual([]);
    expect(source).not.toMatch(/\bimport\s*\(/u);
  });
});
