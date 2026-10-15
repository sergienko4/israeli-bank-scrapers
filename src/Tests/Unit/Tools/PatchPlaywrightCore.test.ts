/**
 * Unit test for `scripts/patch-playwright-core.mjs`.
 *
 * <p>The patcher null-guards three `pageError.location` reads inside the
 * installed playwright-core, and shims Juggler's request-interception call
 * back to the payload every released Camoufox accepts. Postinstall must
 * never fail an install, so the default mode always exits 0 — which is
 * exactly why a playwright-core bump that renames one read, or reshapes the
 * interception call, would drop the fix silently. `--strict` is the CI
 * proof: exit 0 only when, after patching, each guarded form appears at
 * exactly the reviewed number of sites, no `pageError.location` read is left
 * unguarded in any layout, and every interception call is one of the
 * reviewed sends with the shimmed payload; every mention of the method counts
 * as a send, whatever its quoting or line breaks. Guards are checked per
 * guard and per site, so one lost read cannot hide behind the other two,
 * nor behind its own copy at the other site. Any argument other than a
 * single `--strict` is a usage error that touches nothing, so a mistyped
 * flag cannot pass as an unproven run.
 *
 * <p>Every case runs the real script as a consumer's install does: a copy
 * sits in `<root>/scripts/` and resolves `playwright-core` from a synthetic
 * `<root>/node_modules/`. No test-only hook exists in the published script.
 * `HOME` points at the sandbox so Node's global module folders cannot leak
 * a real playwright-core into the "not resolvable" case.
 */

import { mkdirSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  allSitesLines,
  atBothSites,
  bundleOf,
  GUARDED,
  type IRun,
  type ISandbox,
  leftLine,
  linesOf,
  makeRoot,
  NOT_APPLIED,
  patchedBundleOf,
  PREFIX,
  removeRoots,
  RENAMED,
  reportOf,
  runPatcher,
  SCRIPT,
  SCRIPT_NAME,
  SENT_163,
  SENT_164,
  SHIM_PREFIX,
  sitesLine,
  UNGUARDED,
} from '../../Helpers/PatchPlaywrightCoreSandbox.js';

const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = dirname(THIS_FILE);
const REPO_ROOT = join(THIS_DIR, '../../../../');
const PACKAGE_JSON = join(REPO_ROOT, 'package.json');

const SHIM_CLEAN = 'no bypassServiceWorker sent';
const OPT_OUT_ENV = 'SKIP_PLAYWRIGHT_CORE_PATCH';
const SHIM_TAG = 'SHIM-SITES';

/** Interception sends in the reviewed playwright-core: the Firefox network manager's one. */
const REVIEWED_CALLS = 1;

/** A future payload the shim does not know. */
const SENT_UNKNOWN = '"Network.setRequestInterception", { enabled, bypassServiceWorker: true }';

/** A send whose payload starts on the next line, a layout the exact rewrite does not read. */
const SENT_164_SPLIT =
  '"Network.setRequestInterception",\n  { enabled, bypassServiceWorker: true }';

/** A 1.64 send in single quotes, a quoting the exact rewrite does not read. */
const SENT_164_SINGLE = "'Network.setRequestInterception', { enabled, bypassServiceWorker }";

/** Upstream's reads without the space after the colon, a layout the exact guards do not read. */
const COMPACT = UNGUARDED.map((read): string => read.replace(': ', ':'));

/** A fixed past mtime; any write by the script moves it to "now". */
const UNTOUCHED_MTIME = new Date('2000-01-01T00:00:00Z');
const UNTOUCHED_MS = UNTOUCHED_MTIME.getTime();

/** Arguments the CLI must reject: a typo, a positional, extras. */
const BAD_ARGS: readonly { readonly args: readonly string[] }[] = [
  { args: ['--strcit'] },
  { args: ['strict'] },
  { args: ['--strict', '--strict'] },
  { args: ['--strict', 'extra'] },
];

/** A synthetic bundle, the outcome line it yields, and the lines `--strict` adds. */
interface IBundleCase {
  readonly id: string;
  readonly what: string;
  readonly sites: readonly (readonly string[])[];
  readonly outcome: string;
  readonly strict: readonly string[];
}

/** A guarded bundle's interception sends, the shim outcome, and the lines `--strict` adds. */
interface IShimCase {
  readonly id: string;
  readonly what: string;
  readonly calls: readonly string[];
  readonly outcome: string;
  readonly strict: readonly string[];
}

/** A run that never inspects the bundle, so `--strict` must fail closed. */
interface ISkipCase {
  readonly id: string;
  readonly what: string;
  readonly make: () => ISandbox;
  readonly env: Readonly<Record<string, string>>;
  readonly outcome: RegExp;
}

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
 * Replace one read of a list, then place the result at both reviewed sites.
 *
 * @param reads - Base reads.
 * @param index - Position to replace.
 * @param read - Replacement read.
 * @returns Two sites with the replaced reads.
 */
function bothSitesWithRead(
  reads: readonly string[],
  index: number,
  read: string,
): readonly (readonly string[])[] {
  const site = withRead(reads, index, read);
  return atBothSites(site);
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
 * Create a sandbox whose bundle holds the given sites and sends, with a fixed past mtime.
 *
 * @param sites - Location reads of each site written into the bundle.
 * @param calls - Interception sends written into the bundle.
 * @returns The sandbox.
 */
function sandboxWithBundle(
  sites: readonly (readonly string[])[],
  calls: readonly string[] = [SENT_163],
): ISandbox {
  const sandbox = sandboxWithoutBundle();
  const text = bundleOf(sites, calls);
  writeFileSync(sandbox.bundle, text);
  utimesSync(sandbox.bundle, UNTOUCHED_MTIME, UNTOUCHED_MTIME);
  return sandbox;
}

/**
 * Create a sandbox whose bundle ships as upstream 1.64 does: every read
 * unguarded at both sites, the interception send carrying `bypassServiceWorker`.
 *
 * @returns The sandbox.
 */
function sandboxUnguarded(): ISandbox {
  const sites = atBothSites(UNGUARDED);
  return sandboxWithBundle(sites, [SENT_164]);
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
 * The `SHIM-SITES` line `--strict` prints when the sends differ from the review.
 *
 * @param shimmed - Sends carrying the shimmed payload after patching.
 * @param sent - All interception sends after patching.
 * @returns Expected line.
 */
function shimLine(shimmed: number, sent: number): string {
  return `${SHIM_TAG} ${String(shimmed)}/${String(REVIEWED_CALLS)} (${String(sent)} sent) ${SENT_163}`;
}

/**
 * The shim outcome when some interception send is in no known form.
 *
 * @param shimmed - Sends carrying the shimmed payload after patching.
 * @param sent - All interception sends after patching.
 * @returns Expected outcome text.
 */
function shimNotApplied(shimmed: number, sent: number): string {
  const known = `${String(shimmed)} of ${String(sent)} Network.setRequestInterception send(s)`;
  return `NOT APPLIED — ${known} in a known form`;
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
 * The outcome text of each report line of a run, without the fixed prefixes.
 *
 * @param run - A patcher run.
 * @returns The guard outcome and the shim outcome.
 */
function outcomesOf(run: IRun): readonly [string, string] {
  const [guardLine = '', shimText = ''] = run.stdout.split('\n');
  return [guardLine.slice(PREFIX.length), shimText.slice(SHIM_PREFIX.length)];
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
    what: 'unguarded at both sites, as upstream ships',
    sites: atBothSites(UNGUARDED),
    outcome: 'guarded 6 pageError.location read(s)',
    strict: [],
  },
  {
    id: 'PPC-2',
    what: 'already guarded',
    sites: atBothSites(GUARDED),
    outcome: 'already guarded',
    strict: [],
  },
  {
    id: 'PPC-3',
    what: 'a build with one site only',
    sites: [UNGUARDED],
    outcome: 'guarded 3 pageError.location read(s)',
    strict: allSitesLines(1),
  },
  {
    id: 'PPC-4',
    what: 'one read guarded, two unguarded',
    sites: bothSitesWithRead(UNGUARDED, 0, GUARDED[0]),
    outcome: 'guarded 4 pageError.location read(s)',
    strict: [],
  },
  {
    id: 'PPC-5',
    what: 'no known reads',
    sites: atBothSites(RENAMED),
    outcome: NOT_APPLIED,
    strict: [...allSitesLines(0), leftLine(6)],
  },
  ...UNGUARDED.map((_read, index): IBundleCase => ({
    id: `PPC-${String(6 + index)}`,
    what: `partial loss: read ${String(index)} renamed at both sites, the others unguarded`,
    sites: bothSitesWithRead(UNGUARDED, index, RENAMED[index]),
    outcome: 'guarded 4 pageError.location read(s)',
    strict: [sitesLine(index, 0), leftLine(2)],
  })),
  ...GUARDED.map((_read, index): IBundleCase => ({
    id: `PPC-${String(9 + index)}`,
    what: `partial loss: read ${String(index)} renamed at both sites, the others guarded`,
    sites: bothSitesWithRead(GUARDED, index, RENAMED[index]),
    outcome: NOT_APPLIED,
    strict: [sitesLine(index, 0), leftLine(2)],
  })),
  ...UNGUARDED.map((_read, index): IBundleCase => ({
    id: `PPC-${String(14 + index)}`,
    what: `site loss: read ${String(index)} renamed at one site, the rest unguarded`,
    sites: [withRead(UNGUARDED, index, RENAMED[index]), UNGUARDED],
    outcome: 'guarded 5 pageError.location read(s)',
    strict: [sitesLine(index, 1), leftLine(1)],
  })),
  ...GUARDED.map((_read, index): IBundleCase => ({
    id: `PPC-${String(17 + index)}`,
    what: `site loss: read ${String(index)} renamed at one site, the rest guarded`,
    sites: [GUARDED, withRead(GUARDED, index, RENAMED[index])],
    outcome: 'already guarded',
    strict: [sitesLine(index, 1), leftLine(1)],
  })),
  {
    id: 'PPC-24',
    what: 'a third site the review never saw',
    sites: [UNGUARDED, UNGUARDED, UNGUARDED],
    outcome: 'guarded 9 pageError.location read(s)',
    strict: allSitesLines(3),
  },
  {
    id: 'PPC-26',
    what: 'a third site in a layout the guards do not read',
    sites: [UNGUARDED, UNGUARDED, COMPACT],
    outcome: 'guarded 6 pageError.location read(s)',
    strict: [leftLine(3)],
  },
];

/** Both pageError sites already guarded, so only the shim varies. */
const GUARDED_SITES = atBothSites(GUARDED);

const SHIM_CASES: readonly IShimCase[] = [
  { id: 'PPC-40', what: 'a 1.63 send', calls: [SENT_163], outcome: SHIM_CLEAN, strict: [] },
  {
    id: 'PPC-41',
    what: 'a 1.64 send carrying bypassServiceWorker',
    calls: [SENT_164],
    outcome: 'dropped bypassServiceWorker from 1 call(s)',
    strict: [],
  },
  {
    id: 'PPC-42',
    what: 'a payload the shim does not know',
    calls: [SENT_UNKNOWN],
    outcome: shimNotApplied(0, 1),
    strict: [shimLine(0, 1)],
  },
  {
    id: 'PPC-43',
    what: 'no interception send at all',
    calls: [],
    outcome: shimNotApplied(0, 0),
    strict: [shimLine(0, 0)],
  },
  {
    id: 'PPC-44',
    what: 'a second 1.64 send the review never saw',
    calls: [SENT_164, SENT_164],
    outcome: 'dropped bypassServiceWorker from 2 call(s)',
    strict: [shimLine(2, 2)],
  },
  {
    id: 'PPC-45',
    what: 'a 1.64 send beside an unknown one',
    calls: [SENT_164, SENT_UNKNOWN],
    outcome: 'dropped bypassServiceWorker from 1 call(s)',
    strict: [shimLine(1, 2)],
  },
  {
    id: 'PPC-46',
    what: 'a 1.63 send beside an unknown one',
    calls: [SENT_163, SENT_UNKNOWN],
    outcome: shimNotApplied(1, 2),
    strict: [shimLine(1, 2)],
  },
  {
    id: 'PPC-60',
    what: 'a 1.64 send beside one split across lines',
    calls: [SENT_164, SENT_164_SPLIT],
    outcome: 'dropped bypassServiceWorker from 1 call(s)',
    strict: [shimLine(1, 2)],
  },
  {
    id: 'PPC-61',
    what: 'a 1.63 send beside a 1.64 one split across lines',
    calls: [SENT_163, SENT_164_SPLIT],
    outcome: shimNotApplied(1, 2),
    strict: [shimLine(1, 2)],
  },
  {
    id: 'PPC-62',
    what: 'a 1.64 send beside one in single quotes',
    calls: [SENT_164, SENT_164_SINGLE],
    outcome: 'dropped bypassServiceWorker from 1 call(s)',
    strict: [shimLine(1, 2)],
  },
  {
    id: 'PPC-63',
    what: 'only a send split across lines',
    calls: [SENT_164_SPLIT],
    outcome: shimNotApplied(0, 1),
    strict: [shimLine(0, 1)],
  },
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

afterEach(() => {
  removeRoots();
});

describe('patch-playwright-core default mode (postinstall)', () => {
  it.each(BUNDLE_CASES)('[$id] $what → exit 0, "$outcome", no GUARD-SITES', bundleCase => {
    const sandbox = sandboxWithBundle(bundleCase.sites);
    const run = runPatcher(sandbox, []);
    const expectedOut = reportOf(bundleCase.outcome, SHIM_CLEAN);
    expect(run).toEqual({ status: 0, stdout: expectedOut, stderr: '' });
  });

  it.each(BUNDLE_CASES)('[$id] $what → every known read guarded in place', bundleCase => {
    const sandbox = sandboxWithBundle(bundleCase.sites);
    runPatcher(sandbox, []);
    const text = readBundle(sandbox);
    const expected = patchedBundleOf(bundleCase.sites);
    expect(text).toBe(expected);
  });

  it.each([
    ['already guarded', GUARDED],
    ['no known reads', RENAMED],
  ])('[PPC-12] never writes when there is nothing to guard (%s)', (_what, reads) => {
    const sites = atBothSites(reads);
    const sandbox = sandboxWithBundle(sites);
    runPatcher(sandbox, []);
    const mtime = mtimeOf(sandbox.bundle);
    expect(mtime).toBe(UNTOUCHED_MS);
  });

  it('[PPC-13] is idempotent: the second run reports nothing left to patch and rewrites nothing', () => {
    const sandbox = sandboxUnguarded();
    runPatcher(sandbox, []);
    const once = readBundle(sandbox);
    utimesSync(sandbox.bundle, UNTOUCHED_MTIME, UNTOUCHED_MTIME);
    const second = runPatcher(sandbox, ['--strict']);
    const twice = readBundle(sandbox);
    const mtime = mtimeOf(sandbox.bundle);
    const expectedOut = reportOf('already guarded', SHIM_CLEAN);
    expect(second).toEqual({ status: 0, stdout: expectedOut, stderr: '' });
    expect(twice).toBe(once);
    expect(mtime).toBe(UNTOUCHED_MS);
  });
});

describe('patch-playwright-core --strict (CI proof)', () => {
  it.each(BUNDLE_CASES)(
    '[$id] $what → exit 1 iff a guard is off the reviewed site count, each one named',
    bundleCase => {
      const sandbox = sandboxWithBundle(bundleCase.sites);
      const run = runPatcher(sandbox, ['--strict']);
      const expected = [
        PREFIX + bundleCase.outcome,
        SHIM_PREFIX + SHIM_CLEAN,
        ...bundleCase.strict,
      ];
      const status = bundleCase.strict.length > 0 ? 1 : 0;
      expect(run).toEqual({ status, stdout: linesOf(expected), stderr: '' });
    },
  );

  it.each(BUNDLE_CASES)('[$id] $what → patches exactly as the default mode does', bundleCase => {
    const sandbox = sandboxWithBundle(bundleCase.sites);
    runPatcher(sandbox, ['--strict']);
    const text = readBundle(sandbox);
    const expected = patchedBundleOf(bundleCase.sites);
    expect(text).toBe(expected);
  });
});

describe('patch-playwright-core interception shim', () => {
  it.each(SHIM_CASES)('[$id] $what → exit 0, "$outcome", no SHIM-SITES', shimCase => {
    const sandbox = sandboxWithBundle(GUARDED_SITES, shimCase.calls);
    const run = runPatcher(sandbox, []);
    const expectedOut = reportOf('already guarded', shimCase.outcome);
    expect(run).toEqual({ status: 0, stdout: expectedOut, stderr: '' });
  });

  it.each(SHIM_CASES)(
    '[$id] $what → --strict exits 1 iff the sends differ from the review, named once',
    shimCase => {
      const sandbox = sandboxWithBundle(GUARDED_SITES, shimCase.calls);
      const run = runPatcher(sandbox, ['--strict']);
      const expected = [
        `${PREFIX}already guarded`,
        SHIM_PREFIX + shimCase.outcome,
        ...shimCase.strict,
      ];
      const status = shimCase.strict.length > 0 ? 1 : 0;
      expect(run).toEqual({ status, stdout: linesOf(expected), stderr: '' });
    },
  );

  it.each(SHIM_CASES)('[$id] $what → only 1.64 sends are rewritten', shimCase => {
    const sandbox = sandboxWithBundle(GUARDED_SITES, shimCase.calls);
    runPatcher(sandbox, ['--strict']);
    const text = readBundle(sandbox);
    const expected = patchedBundleOf(GUARDED_SITES, shimCase.calls);
    expect(text).toBe(expected);
  });

  it.each([
    ['a 1.63 send', SENT_163],
    ['an unknown send', SENT_UNKNOWN],
  ])('[PPC-47] never writes when no send needs the shim (%s)', (_what, call) => {
    const sandbox = sandboxWithBundle(GUARDED_SITES, [call]);
    runPatcher(sandbox, []);
    const mtime = mtimeOf(sandbox.bundle);
    expect(mtime).toBe(UNTOUCHED_MS);
  });
});

describe('patch-playwright-core skips', () => {
  it.each(SKIP_CASES)('[$id] $what → default exits 0 and leaves the bundle alone', skipCase => {
    const sandbox = skipCase.make();
    const run = runPatcher(sandbox, [], skipCase.env);
    const [outcome] = outcomesOf(run);
    const expectedOut = reportOf(outcome, outcome);
    expect({ status: run.status, stderr: run.stderr }).toEqual({ status: 0, stderr: '' });
    expect(run.stdout).toBe(expectedOut);
    expect(outcome).toMatch(skipCase.outcome);
  });

  it.each(SKIP_CASES)('[$id] $what → --strict fails closed: exit 1, nothing verified', skipCase => {
    const sandbox = skipCase.make();
    const run = runPatcher(sandbox, ['--strict'], skipCase.env);
    const [outcome] = outcomesOf(run);
    const expectedOut = reportOf(outcome, outcome);
    expect({ status: run.status, stderr: run.stderr }).toEqual({ status: 1, stderr: '' });
    expect(run.stdout).toBe(expectedOut);
    expect(outcome).toMatch(skipCase.outcome);
  });

  it('[PPC-23] the opt-out leaves an unpatched 1.64 bundle untouched', () => {
    const sandbox = sandboxUnguarded();
    runPatcher(sandbox, ['--strict'], { [OPT_OUT_ENV]: '1' });
    const text = readBundle(sandbox);
    const unguardedSites = atBothSites(UNGUARDED);
    const original = bundleOf(unguardedSites, [SENT_164]);
    const mtime = mtimeOf(sandbox.bundle);
    expect(text).toBe(original);
    expect(mtime).toBe(UNTOUCHED_MS);
  });
});

describe('patch-playwright-core arguments', () => {
  it.each(BAD_ARGS)('[PPC-25] $args → usage error: exit 2, bundle untouched', ({ args }) => {
    const sandbox = sandboxUnguarded();
    const run = runPatcher(sandbox, args);
    const mtime = mtimeOf(sandbox.bundle);
    expect({ status: run.status, stdout: run.stdout }).toEqual({ status: 2, stdout: '' });
    expect(run.stderr).toMatch(/^usage: .* \[--strict\]\n$/u);
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
