/**
 * Regression test for the published-entry-point exemption in
 * `scripts/check-doc-paths.mjs`.
 *
 * The gate resolves paths cited in Markdown. The declared entry points under
 * `lib/` are gitignored build output, so they are present on any machine that
 * has run a build and absent on a fresh CI checkout. Before the exemption, a
 * PR body asserting the published bundle was unchanged passed the pre-push
 * hook locally and failed the identical CI job — the pass-locally/fail-in-CI
 * flake the script's own `OPTIONAL_PATHS` comment warns about.
 *
 * The exemption cases run against a temp fixture that has a manifest but no
 * build output, because asserting them against this repo would be vacuous:
 * `lib/index.d.ts` exists here whenever a build has run, so it would pass with
 * or without the exemption and prove nothing.
 *
 * The fixture deliberately names paths that appear NOWHERE in the real
 * manifest. An earlier version reused `lib/index.cjs` and friends, which was
 * vacuous in a subtler way: a gate that hardcoded this repo's four entry
 * points, or read `package.json` relative to the script instead of the working
 * directory, would still have passed every case. Unique names make each
 * assertion a fact about *manifest derivation*, and each manifest field is
 * asserted separately so dropping any one of them fails its own test.
 *
 * The test spawns the real CLI rather than importing, because the script
 * exports nothing: it is a gate, and its contract is its exit code.
 */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/** The gate under test, resolved from the repo root. */
const REPO_ROOT = process.cwd();
const GATE = path.join(REPO_ROOT, 'scripts', 'check-doc-paths.mjs');

/**
 * A manifest shaped like ours, naming entry points that exist neither on disk
 * nor in the real `package.json`.
 *
 * `module` is spelled with a leading `./` and `main` without, because a
 * manifest may legally use either and the gate must canonicalise both. The
 * `exports` entry pairs a path-shaped *key* with a different *target*: the key
 * is a public specifier, not a file, so exempting it would be a fail-open bug.
 */
const FIXTURE_MANIFEST = {
  name: 'fixture',
  main: 'fixture-build/main.cjs',
  module: './fixture-build/module.mjs',
  types: 'fixture-build/types.d.ts',
  exports: {
    './fixture-build/subpath-key.js': {
      require: { types: './fixture-build/conditional.d.cts' },
    },
  },
};

/**
 * Make a throwaway directory holding a Markdown body.
 * @param body - Markdown source to check.
 * @returns Directory path and the file written into it.
 */
function writeBody(body: string): { dir: string; file: string } {
  const tmp = os.tmpdir();
  const prefix = path.join(tmp, 'doc-paths-');
  const dir = fs.mkdtempSync(prefix);
  const file = path.join(dir, 'body.md');
  try {
    fs.writeFileSync(file, body, 'utf8');
  } catch (error) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw error;
  }
  return { dir, file };
}

/**
 * Run the gate over a body, resolving cited paths against `root`.
 *
 * `process.execPath` is used rather than a bare `node` so the spawn cannot
 * silently pick a different runtime, and a spawn failure throws instead of
 * being coerced to 1 — which would let the rejection cases pass for the
 * wrong reason.
 * @param body - Markdown source to check.
 * @param root - Working directory the gate resolves against.
 * @returns Exit code the gate reported.
 */
function runGateIn(body: string, root: string): number {
  const written = writeBody(body);
  try {
    const options = { encoding: 'utf8', cwd: root } as const;
    const result = spawnSync(process.execPath, [GATE, written.file], options);
    if (result.error) throw result.error;
    return result.status ?? -1;
  } finally {
    fs.rmSync(written.dir, { recursive: true, force: true });
  }
}

/**
 * Run the gate against a fixture that declares entry points but has no build.
 *
 * This is what makes the exemption cases non-vacuous: none of the fixture's
 * declared paths exist on disk, and none of them appear in the real manifest,
 * so a pass can only come from reading the fixture's own `package.json`.
 * @param body - Markdown source to check.
 * @returns Exit code the gate reported.
 */
function runGateWithoutBuild(body: string): number {
  const tmp = os.tmpdir();
  const prefix = path.join(tmp, 'doc-paths-repo-');
  const root = fs.mkdtempSync(prefix);
  try {
    const manifest = JSON.stringify(FIXTURE_MANIFEST);
    const manifestPath = path.join(root, 'package.json');
    fs.writeFileSync(manifestPath, manifest, 'utf8');
    return runGateIn(body, root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/**
 * Run the gate against this repository.
 * @param body - Markdown source to check.
 * @returns Exit code the gate reported.
 */
function runGate(body: string): number {
  return runGateIn(body, REPO_ROOT);
}

describe('check-doc-paths — published entry points are exempt', () => {
  // Each manifest field is asserted on its own, against paths that appear in
  // neither the fixture's filesystem nor the real manifest. Dropping any one
  // field from the derivation therefore fails exactly its own test.
  it('exempts the path declared by `main`', () => {
    const code = runGateWithoutBuild('Bundle `fixture-build/main.cjs` is unchanged.\n');
    expect(code).toBe(0);
  });

  it('exempts the path declared by `module`, which carries a `./` prefix', () => {
    const code = runGateWithoutBuild('Bundle `fixture-build/module.mjs` is unchanged.\n');
    expect(code).toBe(0);
  });

  it('exempts the path declared by `types`', () => {
    const code = runGateWithoutBuild('Types `fixture-build/types.d.ts` are unchanged.\n');
    expect(code).toBe(0);
  });

  it('exempts a target nested under an `exports` condition', () => {
    const code = runGateWithoutBuild('Types `fixture-build/conditional.d.cts` are unchanged.\n');
    expect(code).toBe(0);
  });

  it('exempts a citation written with a `./` prefix', () => {
    const code = runGateWithoutBuild('Bundle `./fixture-build/main.cjs` is unchanged.\n');
    expect(code).toBe(0);
  });

  // An `exports` KEY is a public specifier, not a file. Exempting one would
  // let a citation of a nonexistent path pass — the fail-open behaviour this
  // exemption exists to avoid.
  it('rejects an `exports` subpath key, which is a specifier and not a file', () => {
    const code = runGateWithoutBuild('See `fixture-build/subpath-key.js` for detail.\n');
    expect(code).toBe(1);
  });

  // The whole point of deriving the exempt set rather than exempting the build
  // directory wholesale: a typo there is exactly what a reviewer wants flagged.
  it('still rejects a typo in a declared entry point', () => {
    const code = runGateWithoutBuild('Bundle `fixture-build/mian.cjs` is unchanged.\n');
    expect(code).toBe(1);
  });

  it('still rejects an undeclared file inside the build directory', () => {
    const code = runGateWithoutBuild('The bundle `fixture-build/extra.d.ts` is out of scope.\n');
    expect(code).toBe(1);
  });

  it('still rejects a source path that does not resolve', () => {
    const code = runGate('See `src/Scrapers/Pipeline/NotAReal/Module.ts` for detail.\n');
    expect(code).toBe(1);
  });

  it('still accepts a source path that does resolve', () => {
    const code = runGate('See `scripts/check-doc-paths.mjs` for detail.\n');
    expect(code).toBe(0);
  });
});
