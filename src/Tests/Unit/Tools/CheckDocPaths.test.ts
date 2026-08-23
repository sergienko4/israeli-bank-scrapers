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
 * or without the exemption and prove nothing. The fixture also pins down that
 * the exempt set is *derived from the manifest*, not hardcoded.
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

/** A manifest shaped like ours, naming entry points that are not on disk. */
const FIXTURE_MANIFEST = {
  name: 'fixture',
  main: 'lib/index.cjs',
  module: 'lib/index.mjs',
  types: 'lib/index.d.ts',
  exports: { '.': { require: { types: './lib/index.d.cts', default: './lib/index.cjs' } } },
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
  fs.writeFileSync(file, body, 'utf8');
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
  const options = { encoding: 'utf8', cwd: root } as const;
  const result = spawnSync(process.execPath, [GATE, written.file], options);
  fs.rmSync(written.dir, { recursive: true, force: true });
  if (result.error) throw result.error;
  return result.status ?? -1;
}

/**
 * Run the gate against a fixture that declares entry points but has no build.
 *
 * This is what makes the exemption cases non-vacuous: nothing under `lib/`
 * exists in the fixture, so a pass can only come from the exemption.
 * @param body - Markdown source to check.
 * @returns Exit code the gate reported.
 */
function runGateWithoutBuild(body: string): number {
  const tmp = os.tmpdir();
  const prefix = path.join(tmp, 'doc-paths-repo-');
  const root = fs.mkdtempSync(prefix);
  const manifest = JSON.stringify(FIXTURE_MANIFEST);
  const manifestPath = path.join(root, 'package.json');
  fs.writeFileSync(manifestPath, manifest, 'utf8');
  const code = runGateIn(body, root);
  fs.rmSync(root, { recursive: true, force: true });
  return code;
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
  // Run against a fixture with NO build output, so a pass can only come from
  // the exemption. Asserting this against the repo would be vacuous.
  it('exempts a declared entry point that is absent', () => {
    const code = runGateWithoutBuild('Public API unchanged: `lib/index.d.ts` SHA-256 matches.\n');
    expect(code).toBe(0);
  });

  it('exempts every declared entry point, including nested export conditions', () => {
    const body = 'Bundles `lib/index.cjs`, `lib/index.mjs` and `lib/index.d.cts` are unchanged.\n';
    const code = runGateWithoutBuild(body);
    expect(code).toBe(0);
  });

  // The whole point of deriving the exempt set rather than exempting `lib/`
  // wholesale: a typo inside the build directory is exactly what a reviewer
  // wants flagged.
  it('still rejects a typo inside the build directory', () => {
    const code = runGateWithoutBuild('Public API unchanged: `lib/indexs.d.ts` matches.\n');
    expect(code).toBe(1);
  });

  it('still rejects an undeclared file inside the build directory', () => {
    const code = runGateWithoutBuild('The bundle at `lib/never-generated.d.ts` is out of scope.\n');
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
