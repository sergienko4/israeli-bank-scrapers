/**
 * Unit test for `scripts/patch-playwright-core.mjs` across playwright-core copies.
 *
 * <p>camoufox-js takes playwright-core as a peer and imports it from its own
 * location, and that copy drives the browser. A consumer's tree can hold a
 * second copy — nested under camoufox-js beside a hoisted one, or two pnpm
 * store entries — so patching only the copy this package resolves would
 * leave the browser-driving copy unguarded while `--strict` reported proof.
 * Each case builds a real layout under a sandbox root and runs the real
 * script: every distinct real copy is patched, a shared or symlinked copy is
 * patched once with the single-copy output, and `--strict` fails when any
 * one copy is unproven.
 */

import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import {
  allSitesLines,
  atBothSites,
  bundleOf,
  COOKIE_PREFIX,
  type ISandbox,
  leftLine,
  linesOf,
  makeRoot,
  NOT_APPLIED,
  patchedBundleOf,
  PREFIX,
  removeRoots,
  RENAMED,
  RESPONSE_164,
  runPatcher,
  SENT_164,
  SHIM_PREFIX,
  UNGUARDED,
} from '../../Helpers/PatchPlaywrightCoreSandbox.js';

/** Sandbox-relative paths in native separators, as the script's copy labels are. */
const CAMOUFOX_DIR = join('node_modules', '@hieutran094', 'camoufox-js');
const HOISTED_COPY = join('node_modules', 'playwright-core');
const NESTED_COPY = join(CAMOUFOX_DIR, HOISTED_COPY);
const PNPM_COPY_1 = join('node_modules', '.pnpm', 'playwright-core@1.63.0', HOISTED_COPY);
const PNPM_COPY_2 = join('node_modules', '.pnpm', 'playwright-core@1.64.0', HOISTED_COPY);
const PNPM_STORE = join('node_modules', '.pnpm', '@hieutran094+camoufox-js@0.0.0', 'node_modules');
const PNPM_CAMOUFOX = join(PNPM_STORE, '@hieutran094', 'camoufox-js');
const PNPM_PEER = join(PNPM_STORE, 'playwright-core');
const COPY_PREFIX = 'playwright-core copy: ';

/** Outcomes of patching an upstream 1.64 bundle: six reads, one send, one response. */
const UPSTREAM_GUARDED = 'guarded 6 pageError.location read(s)';
const UPSTREAM_SHIMMED = 'dropped bypassServiceWorker from 1 call(s)';
const UPSTREAM_SPLIT = 'split Set-Cookie at 1 response site(s)';

/** Every outcome of an upstream 1.64 copy, in report order. */
const UPSTREAM_OUTCOMES = [UPSTREAM_GUARDED, UPSTREAM_SHIMMED, UPSTREAM_SPLIT];

/** Upstream 1.64's reads at both sites, every one unguarded. */
const UPSTREAM_SITES = atBothSites(UNGUARDED);

/** A copy whose reads were renamed, so no guard applies. */
const RENAMED_SITES = atBothSites(RENAMED);

/** One dependency layout and the copies the script must report. */
interface ILayoutCase {
  readonly id: string;
  readonly what: string;
  /** Real playwright-core directories, each written with an upstream 1.64 bundle. */
  readonly copies: readonly string[];
  /** Real camoufox-js directory. */
  readonly camoufox: string;
  /** `[target, link]` directory symlinks, both relative to the root. */
  readonly links: readonly (readonly [string, string])[];
  /** Expected copy labels in report order; one empty label for a single copy. */
  readonly reported: readonly string[];
}

const LAYOUT_CASES: readonly ILayoutCase[] = [
  {
    id: 'PPC-50',
    what: 'a copy nested under camoufox-js beside a hoisted copy',
    copies: [HOISTED_COPY, NESTED_COPY],
    camoufox: CAMOUFOX_DIR,
    links: [],
    reported: [HOISTED_COPY, NESTED_COPY],
  },
  {
    id: 'PPC-51',
    what: 'one hoisted copy shared with camoufox-js',
    copies: [HOISTED_COPY],
    camoufox: CAMOUFOX_DIR,
    links: [],
    reported: [''],
  },
  {
    id: 'PPC-52',
    what: 'only the copy nested under camoufox-js',
    copies: [NESTED_COPY],
    camoufox: CAMOUFOX_DIR,
    links: [],
    reported: [''],
  },
  {
    id: 'PPC-53',
    what: 'pnpm: both routes link one store copy',
    copies: [PNPM_COPY_1],
    camoufox: PNPM_CAMOUFOX,
    links: [
      [PNPM_COPY_1, HOISTED_COPY],
      [PNPM_COPY_1, PNPM_PEER],
      [PNPM_CAMOUFOX, CAMOUFOX_DIR],
    ],
    reported: [''],
  },
  {
    id: 'PPC-54',
    what: 'pnpm: camoufox-js peers a second store copy',
    copies: [PNPM_COPY_1, PNPM_COPY_2],
    camoufox: PNPM_CAMOUFOX,
    links: [
      [PNPM_COPY_1, HOISTED_COPY],
      [PNPM_COPY_2, PNPM_PEER],
      [PNPM_CAMOUFOX, CAMOUFOX_DIR],
    ],
    reported: [PNPM_COPY_1, PNPM_COPY_2],
  },
];

/**
 * Write a playwright-core copy's manifest and `lib/`, but no bundle.
 *
 * @param root - Sandbox root.
 * @param copy - Copy directory, relative to the root.
 * @returns The bundle path, which does not exist yet.
 */
function writeManifest(root: string, copy: string): string {
  const libDir = join(root, copy, 'lib');
  mkdirSync(libDir, { recursive: true });
  const manifest = join(root, copy, 'package.json');
  writeFileSync(manifest, '{"name":"playwright-core","version":"0.0.0"}');
  return join(libDir, 'coreBundle.js');
}

/**
 * Write one playwright-core copy with a bundle sending the 1.64 payload and
 * building the 1.64 response.
 *
 * @param root - Sandbox root.
 * @param copy - Copy directory, relative to the root.
 * @param sites - Reads of each site.
 * @returns The bundle path.
 */
function writeCopy(root: string, copy: string, sites = UPSTREAM_SITES): string {
  const bundle = writeManifest(root, copy);
  const text = bundleOf(sites, [SENT_164], [RESPONSE_164]);
  writeFileSync(bundle, text);
  return bundle;
}

/**
 * Write the camoufox-js manifest, the only file the script looks for.
 *
 * @param root - Sandbox root.
 * @param camoufox - Package directory, relative to the root.
 * @returns The manifest path.
 */
function writeCamoufox(root: string, camoufox: string): string {
  const dir = join(root, camoufox);
  mkdirSync(dir, { recursive: true });
  const manifest = join(dir, 'package.json');
  writeFileSync(manifest, '{"name":"@hieutran094/camoufox-js","version":"0.0.0"}');
  return manifest;
}

/**
 * Link a directory as pnpm does, creating the link's parent first.
 *
 * @param root - Sandbox root.
 * @param link - `[target, link]`, both relative to the root.
 * @returns The link path.
 */
function linkDir(root: string, link: readonly [string, string]): string {
  const [target, at] = link;
  const linkPath = join(root, at);
  const parent = dirname(linkPath);
  mkdirSync(parent, { recursive: true });
  const targetPath = join(root, target);
  symlinkSync(targetPath, linkPath, 'junction');
  return linkPath;
}

/**
 * Build a sandbox holding one layout.
 *
 * @param layout - Layout to build.
 * @returns The sandbox; `bundle` is the first copy's bundle.
 */
function sandboxWithLayout(layout: ILayoutCase): ISandbox {
  const root = makeRoot();
  const bundles = layout.copies.map((copy): string => writeCopy(root, copy));
  writeCamoufox(root, layout.camoufox);
  for (const link of layout.links) linkDir(root, link);
  return { root, bundle: bundles[0] };
}

/**
 * Read one copy's bundle text.
 *
 * @param sandbox - Sandbox holding the copy.
 * @param copy - Copy directory, relative to the root.
 * @returns Bundle text.
 */
function readCopy(sandbox: ISandbox, copy: string): string {
  const bundle = join(sandbox.root, copy, 'lib', 'coreBundle.js');
  return readFileSync(bundle, 'utf8');
}

/**
 * The lines one copy prints: its header when labelled, then all three outcomes.
 *
 * @param label - Copy label; empty for a single copy.
 * @param outcomes - Guard, shim and Set-Cookie split outcomes, then any
 *   mismatch lines.
 * @returns Expected lines.
 */
function copyLines(label: string, outcomes: readonly string[]): string[] {
  const header = label === '' ? [] : [COPY_PREFIX + label];
  const [guard = '', shim = '', cookie = '', ...mismatches] = outcomes;
  const reported = [PREFIX + guard, SHIM_PREFIX + shim, COOKIE_PREFIX + cookie];
  return [...header, ...reported, ...mismatches];
}

/**
 * The report of a run where every copy held an upstream 1.64 bundle.
 *
 * @param labels - Copy labels in report order.
 * @returns Expected stdout.
 */
function copiesReport(labels: readonly string[]): string {
  const lines = labels.flatMap((label): string[] => copyLines(label, UPSTREAM_OUTCOMES));
  return linesOf(lines);
}

afterEach(() => {
  removeRoots();
});

describe('patch-playwright-core every copy', () => {
  it.each(LAYOUT_CASES)('[$id] $what → --strict proves each copy once', layout => {
    const sandbox = sandboxWithLayout(layout);
    const run = runPatcher(sandbox, ['--strict']);
    const expectedOut = copiesReport(layout.reported);
    expect(run).toEqual({ status: 0, stdout: expectedOut, stderr: '' });
  });

  it.each(LAYOUT_CASES)('[$id] $what → every copy patched in place', layout => {
    const sandbox = sandboxWithLayout(layout);
    runPatcher(sandbox, []);
    const texts = layout.copies.map((copy): string => readCopy(sandbox, copy));
    const patched = patchedBundleOf(UPSTREAM_SITES, [SENT_164], [RESPONSE_164]);
    const expected = layout.copies.map((): string => patched);
    expect(texts).toEqual(expected);
  });

  it('[PPC-55] one unproven copy fails --strict, named under its own header', () => {
    const root = makeRoot();
    writeCopy(root, HOISTED_COPY);
    const bundle = writeCopy(root, NESTED_COPY, RENAMED_SITES);
    writeCamoufox(root, CAMOUFOX_DIR);
    const run = runPatcher({ root, bundle }, ['--strict']);
    const nested = [
      NOT_APPLIED,
      UPSTREAM_SHIMMED,
      UPSTREAM_SPLIT,
      ...allSitesLines(0),
      leftLine(6),
    ];
    const lines = [
      ...copyLines(HOISTED_COPY, UPSTREAM_OUTCOMES),
      ...copyLines(NESTED_COPY, nested),
    ];
    expect(run).toEqual({ status: 1, stdout: linesOf(lines), stderr: '' });
  });

  it('[PPC-56] a copy that cannot be read is skipped, the others still patched', () => {
    const root = makeRoot();
    const bundle = writeCopy(root, HOISTED_COPY);
    writeManifest(root, NESTED_COPY);
    writeCamoufox(root, CAMOUFOX_DIR);
    const sandbox = { root, bundle };
    const runs = [runPatcher(sandbox, []), runPatcher(sandbox, ['--strict'])];
    const statuses = runs.map((run): number => run.status);
    const hoisted = readCopy(sandbox, HOISTED_COPY);
    const patched = patchedBundleOf(UPSTREAM_SITES, [SENT_164], [RESPONSE_164]);
    const nestedSkip = `${COPY_PREFIX + NESTED_COPY}\n${PREFIX}skipped (`;
    expect(statuses).toEqual([0, 1]);
    expect(hoisted).toBe(patched);
    expect(runs[1].stdout).toContain(nestedSkip);
  });
});
