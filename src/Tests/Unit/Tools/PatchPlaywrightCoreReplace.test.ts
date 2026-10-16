/**
 * Unit test for how `scripts/patch-playwright-core.mjs` writes `coreBundle.js`.
 *
 * <p>The patcher runs in `postinstall` and absorbs every failure, so a write
 * that truncated the bundle and then failed — a full disk, a killed install —
 * would pass as a skip and leave a bundle that no longer parses. The patcher
 * therefore writes a uniquely named scratch file beside the bundle and renames
 * it over the bundle: a reader sees the whole old file or the whole new one.
 *
 * <p>A full disk is reproduced with a one-block file-size limit (`ulimit -f 1`)
 * on a bundle larger than that block, so the write fails part-way with `EFBIG`.
 * That limit is set through `/bin/bash`, so those cases stand down on Windows.
 */

import { chmodSync, linkSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { canRunPosixBash } from '../../Helpers/HostCapabilities.js';
import {
  atBothSites,
  bundleOf,
  type IRun,
  type ISandbox,
  patchedBundleOf,
  PREFIX,
  readBundle,
  removeRoots,
  reportOf,
  RESPONSE_164,
  runPatcher,
  runPatcherWithFullDisk,
  sandboxWithoutBundle,
  SENT_164,
  UNGUARDED,
} from '../../Helpers/PatchPlaywrightCoreSandbox.js';

/** A comment far larger than one block, so a capped write of the bundle fails part-way. */
const PADDING = `/* ${'x'.repeat(8192)} */\n`;

/** Both reviewed sites, each with every read upstream ships unguarded. */
const UNGUARDED_SITES = atBothSites(UNGUARDED);

/** An unpatched 1.64 bundle: every guard, the shim and the split are missing. */
const ORIGINAL = bundleOf(UNGUARDED_SITES, [SENT_164], [RESPONSE_164]) + PADDING;

/** The same bundle after a correct patch. */
const PATCHED = patchedBundleOf(UNGUARDED_SITES, [SENT_164], [RESPONSE_164]) + PADDING;

/**
 * Permission bits with an execute bit, which a newly created file never gets
 * from the umask, so on POSIX only a kept mode can show them. Windows records
 * only the write bit, so the test compares against the mode the host recorded.
 */
const BUNDLE_MODE = 0o740;

/** Bits of `st_mode` that `chmod` sets. */
const PERMISSION_BITS = 0o777;

/**
 * Read the permission bits of a file.
 *
 * @param path - File to inspect.
 * @returns The `chmod` bits of its mode.
 */
function permissionBitsOf(path: string): number {
  return statSync(path).mode & PERMISSION_BITS;
}

/**
 * Run the script in default mode, as `postinstall` does.
 *
 * @param sandbox - Sandbox to run in.
 * @returns Exit status and both output streams.
 */
function runDefault(sandbox: ISandbox): IRun {
  return runPatcher(sandbox, []);
}

/** Whether this host can cap file sizes through `/bin/bash`. */
const canCapFiles = canRunPosixBash(process.platform);

/** A run of the patcher, by how its write ends, and whether this host can run it. */
const WRITES: readonly (readonly [string, (sandbox: ISandbox) => IRun, boolean])[] = [
  ['cut short', runPatcherWithFullDisk, canCapFiles],
  ['completed', runDefault, true],
];

/**
 * Create a sandbox holding the unpatched bundle.
 *
 * @returns The sandbox.
 */
function sandboxToPatch(): ISandbox {
  const sandbox = sandboxWithoutBundle();
  writeFileSync(sandbox.bundle, ORIGINAL);
  return sandbox;
}

/**
 * List the files in the bundle's directory.
 *
 * @param sandbox - Sandbox whose bundle directory to list.
 * @returns File names, sorted.
 */
function filesBesideBundle(sandbox: ISandbox): string[] {
  const bundleDir = dirname(sandbox.bundle);
  const files = readdirSync(bundleDir);
  return files.sort();
}

afterEach(() => {
  removeRoots();
});

describe('patch-playwright-core write cut short', () => {
  it('[PPC-86] leaves the original bundle whole', () => {
    if (canCapFiles) {
      const sandbox = sandboxToPatch();
      runPatcherWithFullDisk(sandbox);
      const text = readBundle(sandbox);
      expect(text).toBe(ORIGINAL);
    }
  });

  it('[PPC-87] still exits 0 and reports the write error as a skip', () => {
    if (canCapFiles) {
      const sandbox = sandboxToPatch();
      const run = runPatcherWithFullDisk(sandbox);
      const [guardLine = ''] = run.stdout.split('\n');
      const outcome = guardLine.slice(PREFIX.length);
      const expectedOut = reportOf(outcome, outcome, outcome);
      expect(run).toEqual({ status: 0, stdout: expectedOut, stderr: '' });
      expect(outcome).toMatch(/^skipped \(EFBIG: /u);
    }
  });
});

describe('patch-playwright-core bundle replacement', () => {
  it.each(WRITES)(
    '[PPC-88] a write %s leaves no scratch file beside the bundle',
    (_how, run, canRun) => {
      if (canRun) {
        const sandbox = sandboxToPatch();
        run(sandbox);
        const files = filesBesideBundle(sandbox);
        expect(files).toEqual(['coreBundle.js']);
      }
    },
  );

  it('[PPC-89] writes a new file, so a hard link to the old one keeps the unpatched text', () => {
    const sandbox = sandboxToPatch();
    const linked = join(sandbox.root, 'linked-coreBundle.js');
    linkSync(sandbox.bundle, linked);
    runPatcher(sandbox, []);
    const texts = { bundle: readBundle(sandbox), linked: readFileSync(linked, 'utf8') };
    expect(texts).toEqual({ bundle: PATCHED, linked: ORIGINAL });
  });

  it('[PPC-90] keeps the permission bits of the bundle it replaces', () => {
    const sandbox = sandboxToPatch();
    chmodSync(sandbox.bundle, BUNDLE_MODE);
    const recorded = permissionBitsOf(sandbox.bundle);
    runPatcher(sandbox, []);
    const mode = permissionBitsOf(sandbox.bundle);
    expect({ mode, text: readBundle(sandbox) }).toEqual({ mode: recorded, text: PATCHED });
  });
});
