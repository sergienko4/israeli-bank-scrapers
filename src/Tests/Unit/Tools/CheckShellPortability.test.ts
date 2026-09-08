/**
 * Regression test for symbolic-link handling in
 * `scripts/check-shell-portability.mjs`.
 *
 * The gate walks `.husky`, `.github/scripts` and `scripts` looking for shell
 * constructs that only work on GNU/bash-5. Its directory walk asked
 * `statSync(...).isDirectory()`, and `stat` FOLLOWS links. Two consequences,
 * both of which stop the gate doing its job:
 *
 *   - a broken link makes `stat` throw `ENOENT`, so the gate dies before
 *     scanning anything and every real violation goes unreported;
 *   - a link pointing back into the tree is walked as a directory, so the
 *     walk re-enters and never terminates.
 *
 * A quality gate that crashes is worse than one that reports nothing: it
 * fails the build for a reason unrelated to the code under review.
 *
 * The gate resolves its roots against the working directory, so each case
 * runs against a throwaway tree rather than this repo — asserting against
 * the real `scripts/` would prove nothing, since it holds no links.
 *
 * The test spawns the real CLI rather than importing, because the script
 * exports nothing: it is a gate, and its contract is its exit code.
 */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import ScraperError from '../../../Scrapers/Base/ScraperError.js';
import { canCreateSymlinks } from '../../Helpers/HostCapabilities.js';

/** The gate under test, resolved from the repo root. */
const REPO_ROOT = process.cwd();
const GATE = path.join(REPO_ROOT, 'scripts', 'check-shell-portability.mjs');

/** A construct the gate is required to reject — bash 4+ only. */
const NON_PORTABLE = '#!/usr/bin/env bash\ndeclare -A map\n';

/** A script that uses nothing the gate objects to. */
const PORTABLE = '#!/usr/bin/env bash\necho hello\n';

/**
 * Ceiling on a single gate run. A link the walk re-enters makes the gate
 * loop; without this the spec would hang CI instead of failing it.
 */
const GATE_TIMEOUT_MS = 30_000;

/**
 * Every tree this suite created, so none is left behind on disk.
 *
 * <p>These are real directories under the system temp dir. Left unremoved
 * they accumulate one `shell-portability-*` tree per spec per run, which on a
 * developer machine is silent litter and in CI is wasted image space.
 */
const CREATED: string[] = [];

/**
 * Create a throwaway tree with a `scripts/` root for the gate to walk.
 * @returns Absolute path to the tree root.
 */
function makeTree(): string {
  const tmp = os.tmpdir();
  const prefix = path.join(tmp, 'shell-portability-');
  const root = fs.mkdtempSync(prefix);
  CREATED.push(root);
  const scripts = path.join(root, 'scripts');
  fs.mkdirSync(scripts);
  return root;
}

afterAll(() => {
  for (const root of CREATED) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  // Not ceremony: this check is what fails the run if the removal above is
  // ever dropped, which is otherwise invisible from a green suite. It throws
  // rather than asserting because `expect` is not valid outside a test block.
  const survivors = CREATED.filter(root => fs.existsSync(root));
  const count = String(survivors.length);
  if (survivors.length > 0) throw new ScraperError(`left ${count} temp trees`);
});

/**
 * Run the gate with the tree as its working directory.
 * @param root - Tree to scan.
 * @returns Exit status, with `-1` for a signalled exit, and both streams.
 */
function spawnGate(root: string): { status: number; output: string } {
  const options = { encoding: 'utf8', cwd: root, timeout: GATE_TIMEOUT_MS } as const;
  const result = spawnSync(process.execPath, [GATE], options);
  if (result.error) throw result.error;
  const output = `${result.stdout}${result.stderr}`;
  return { status: result.status ?? -1, output };
}

/**
 * Absolute path to a file inside the tree's `scripts` root.
 * @param root - Tree root.
 * @param name - File name.
 * @returns The joined path.
 */
function scriptPath(root: string, name: string): string {
  return path.join(root, 'scripts', name);
}

describe('check-shell-portability — links never stop the gate running', () => {
  it('SHP-LINK-1 a broken symlink does not crash the walk', () => {
    // `stat` on a dangling link throws ENOENT. The gate must not die on a
    // link it was never responsible for.
    if (canCreateSymlinks(process.platform)) {
      const root = makeTree();
      const link = scriptPath(root, 'dangling.sh');
      const absent = scriptPath(root, 'absent.sh');
      fs.symlinkSync(absent, link);

      const { status, output } = spawnGate(root);

      expect(output).not.toContain('ENOENT');
      expect(status).toBe(0);
    }
  });

  it('SHP-LINK-2 a link pointing back into the tree does not re-enter it', () => {
    // Followed as a directory, this walks `scripts/loop/loop/loop/...` until
    // the process dies. Skipping links terminates.
    if (canCreateSymlinks(process.platform)) {
      const root = makeTree();
      const scripts = path.join(root, 'scripts');
      const loop = path.join(scripts, 'loop');
      fs.symlinkSync(scripts, loop);

      const { status } = spawnGate(root);

      expect(status).toBe(0);
    }
  });

  it('SHP-LINK-3 a real violation is still reported', () => {
    // The guard against fixing the crash by making the gate blind.
    if (canCreateSymlinks(process.platform)) {
      const root = makeTree();
      const bad = scriptPath(root, 'bad.sh');
      fs.writeFileSync(bad, NON_PORTABLE);
      const absent = scriptPath(root, 'absent.sh');
      const link = scriptPath(root, 'x.sh');
      fs.symlinkSync(absent, link);

      const { status, output } = spawnGate(root);

      expect(output).toContain('bad.sh');
      expect(status).toBe(1);
    }
  });

  it('SHP-LINK-4 a clean tree still passes', () => {
    // No link involved, so this case is required on every host.
    const root = makeTree();
    const good = scriptPath(root, 'good.sh');
    fs.writeFileSync(good, PORTABLE);

    const { status, output } = spawnGate(root);

    expect(output).toContain('PASS');
    expect(status).toBe(0);
  });
});
