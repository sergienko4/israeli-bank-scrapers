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
 * Write the body into a directory, removing the directory if the write fails.
 * @param dir - Directory to write into.
 * @param body - Markdown source.
 * @returns Path of the written file.
 */
function writeOrClean(dir: string, body: string): string {
  const file = path.join(dir, 'body.md');
  try {
    fs.writeFileSync(file, body, 'utf8');
  } catch (error) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw error;
  }
  return file;
}

/**
 * Make a throwaway directory holding a Markdown body.
 * @param body - Markdown source to check.
 * @returns Directory path and the file written into it.
 */
function writeBody(body: string): { dir: string; file: string } {
  const tmp = os.tmpdir();
  const prefix = path.join(tmp, 'doc-paths-');
  const dir = fs.mkdtempSync(prefix);
  const file = writeOrClean(dir, body);
  return { dir, file };
}

/**
 * Run the gate as a child process.
 *
 * `process.execPath` is used rather than a bare `node` so the spawn cannot
 * silently pick a different runtime, and a spawn failure throws instead of
 * being coerced to 1 — which would let the rejection cases pass for the
 * wrong reason.
 * @param file - Markdown file to check.
 * @param root - Working directory to resolve cited paths against.
 * @returns Exit status, with `-1` for a signalled exit, and stdout.
 */
function spawnGate(file: string, root: string): { status: number; stdout: string } {
  const options = { encoding: 'utf8', cwd: root } as const;
  const result = spawnSync(process.execPath, [GATE, file], options);
  if (result.error) throw result.error;
  return { status: result.status ?? -1, stdout: result.stdout };
}

/**
 * Run the gate against a body, in a chosen working directory.
 * @param body - Markdown source to check.
 * @param root - Working directory to resolve cited paths against.
 * @returns Exit code the gate reported.
 */
function runGateIn(body: string, root: string): number {
  const written = writeBody(body);
  try {
    return spawnGate(written.file, root).status;
  } finally {
    fs.rmSync(written.dir, { recursive: true, force: true });
  }
}

/**
 * Run the gate in a throwaway repository carrying a chosen manifest.
 *
 * The manifest is written verbatim rather than serialised, so a caller can
 * supply text that parses to something which is not a manifest at all.
 * @param body - Markdown source to check.
 * @param manifest - Raw `package.json` contents.
 * @returns Exit status and stdout the gate reported.
 */
function gateWithManifest(body: string, manifest: string): { status: number; stdout: string } {
  const tmp = os.tmpdir();
  const prefix = path.join(tmp, 'doc-paths-repo-');
  const root = fs.mkdtempSync(prefix);
  const manifestPath = path.join(root, 'package.json');
  fs.writeFileSync(manifestPath, manifest, 'utf8');
  const written = writeBody(body);
  try {
    return spawnGate(written.file, root);
  } finally {
    fs.rmSync(written.dir, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
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
  const manifest = JSON.stringify(FIXTURE_MANIFEST);
  const result = gateWithManifest(body, manifest);
  return result.status;
}

/**
 * Run the gate against this repository.
 * @param body - Markdown source to check.
 * @returns Exit code the gate reported.
 */
function runGate(body: string): number {
  return runGateIn(body, REPO_ROOT);
}

/**
 * Capture what the gate prints, run against this repository.
 *
 * Exit codes cannot show which *spelling* reached the caller, and that is the
 * whole question: the removed-path set comes from git, which always reports a
 * path with no prefix and forward slashes. A citation echoed back in any other
 * form would never match it.
 * @param body - Markdown source to check.
 * @returns The gate's stdout.
 */
function gateOutput(body: string): string {
  const written = writeBody(body);
  try {
    return spawnGate(written.file, REPO_ROOT).stdout;
  } finally {
    fs.rmSync(written.dir, { recursive: true, force: true });
  }
}

/**
 * Entry points a manifest declares, each cited on its own.
 *
 * Every path here is absent from both the fixture's filesystem and the real
 * manifest, so dropping any one field from the derivation fails exactly its
 * own row rather than the whole group.
 */
const EXEMPT_CITATIONS = [
  { label: 'the path declared by `main`', citation: 'fixture-build/main.cjs' },
  {
    label: 'the path declared by `module`, which carries a `./` prefix',
    citation: 'fixture-build/module.mjs',
  },
  { label: 'the path declared by `types`', citation: 'fixture-build/types.d.ts' },
  {
    label: 'a target nested under an `exports` condition',
    citation: 'fixture-build/conditional.d.cts',
  },
  { label: 'a citation written with a `./` prefix', citation: './fixture-build/main.cjs' },
] as const;

/**
 * Build-directory citations the exemption must still reject.
 *
 * An `exports` KEY is a public specifier, not a file, so exempting one would
 * let a citation of a nonexistent path pass — the fail-open this exemption
 * exists to avoid. The other two are why the exempt set is derived from the
 * manifest rather than exempting the build directory wholesale: a typo there
 * is exactly what a reviewer wants flagged.
 */
const REJECTED_BUILD_CITATIONS = [
  {
    label: 'an `exports` subpath key, which is a specifier and not a file',
    citation: 'fixture-build/subpath-key.js',
  },
  { label: 'a typo in a declared entry point', citation: 'fixture-build/mian.cjs' },
  { label: 'an undeclared file inside the build directory', citation: 'fixture-build/extra.d.ts' },
] as const;

describe('check-doc-paths — published entry points are exempt', () => {
  it.each(EXEMPT_CITATIONS)('exempts $label', ({ citation }) => {
    const code = runGateWithoutBuild(`Bundle \`${citation}\` is unchanged.\n`);
    expect(code).toBe(0);
  });

  it.each(REJECTED_BUILD_CITATIONS)('still rejects $label', ({ citation }) => {
    const code = runGateWithoutBuild(`See \`${citation}\` for detail.\n`);
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

/**
 * Manifests that parse cleanly but cannot be read as a manifest.
 *
 * `JSON.parse` returns each of these without throwing, so the `try/catch`
 * around it never fires; only the shape guard after it stands between the gate
 * and a manifest it cannot use. The three are not equivalent. `null` is the one
 * that would raise a `TypeError` on dereferencing `exports`, aborting before a
 * single citation was checked. An array and a bare string dereference to
 * `undefined` instead, so they pin the fail-closed BEHAVIOUR rather than a
 * crash: the gate must report the citation unresolved, never treat an unusable
 * manifest as one that simply exports nothing.
 */
const UNUSABLE_MANIFESTS = [
  { label: 'a manifest that is literally `null`', manifest: 'null' },
  { label: 'a manifest that is an array', manifest: '[]' },
  { label: 'a manifest that is a bare string', manifest: '"nope"' },
] as const;

describe('check-doc-paths — an unusable manifest exempts nothing', () => {
  // Asserting on stdout, not just the exit code: an unhandled throw also exits
  // 1, so only reaching the report proves the guard held rather than crashed.
  it.each(UNUSABLE_MANIFESTS)('reports an undeclared build path given $label', ({ manifest }) => {
    const body = 'Bundle `fixture-build/main.cjs` is unchanged.\n';
    const result = gateWithManifest(body, manifest);
    expect(result.stdout).toContain('✗ fixture-build/main.cjs');
  });

  it.each(UNUSABLE_MANIFESTS)('fails closed given $label', ({ manifest }) => {
    const body = 'Bundle `fixture-build/main.cjs` is unchanged.\n';
    const result = gateWithManifest(body, manifest);
    expect(result.status).toBe(1);
  });
});

/**
 * Spellings of one missing path that must all report the form git uses.
 *
 * Git reports a removed path with no prefix and forward slashes, so a citation
 * echoed back in any other form would never match it and a legitimate deletion
 * would report as drift. The trailing separator is the one spelling whose
 * meaning is not preserved — POSIX reads it as a directory — so it is pinned
 * here to prove the leniency still cannot hide a file that does not exist.
 */
const EQUIVALENT_SPELLINGS = [
  { label: 'a `./` prefix', citation: './src/Nope/Missing.ts' },
  { label: 'a repeated `./` prefix', citation: '././src/Nope/Missing.ts' },
  { label: 'an interior `.` segment', citation: 'src/./Nope/Missing.ts' },
  { label: 'a doubled separator', citation: 'src//Nope/Missing.ts' },
  { label: 'a trailing separator', citation: 'src/Nope/Missing.ts/' },
] as const;

/**
 * Spellings of files that do exist, which must be counted rather than skipped.
 *
 * Exit 0 alone cannot tell recognition from a silent skip — the failure this
 * whole change exists to remove — so every row asserts the citation was
 * counted, not merely that the gate passed.
 */
const RESOLVING_SPELLINGS = [
  { label: '`\\` separators', citation: 'scripts\\check-doc-paths.mjs' },
  { label: 'a `./` prefix at the repository root', citation: './README.md' },
  { label: 'a trailing separator', citation: 'scripts/check-doc-paths.mjs/' },
] as const;

describe('check-doc-paths — one canonical spelling reaches every check', () => {
  it.each(EQUIVALENT_SPELLINGS)(
    'canonicalises a missing file cited with $label',
    ({ citation }) => {
      const out = gateOutput(`See \`${citation}\` for detail.\n`);
      expect(out).toContain('✗ src/Nope/Missing.ts');
    },
  );

  it.each(RESOLVING_SPELLINGS)('counts an existing file cited with $label', ({ citation }) => {
    const out = gateOutput(`See \`${citation}\` for detail.\n`);
    expect(out).toContain('1 cited, 0 unresolved');
  });

  it('applies the ignored-prefix list to a `./`-prefixed dependency path', () => {
    const code = runGate('Patched `./node_modules/pkg/never-installed.js` upstream.\n');
    expect(code).toBe(0);
  });

  // A `\`-separated citation matched no path shape, so a broken one was
  // silently skipped and the gate passed — fail-open, the exact failure this
  // gate exists to prevent.
  it('rejects a broken citation written with `\\` separators', () => {
    const code = runGate('See `src\\Nope\\Missing.ts` for detail.\n');
    expect(code).toBe(1);
  });

  it('still refuses to traverse upward through `\\` separators', () => {
    const code = runGate('See `..\\outside\\secrets.ts` for detail.\n');
    expect(code).toBe(0);
  });

  // Stripping `./` before the shape check reduces a root-level citation to a
  // bare filename, which `PATH_SHAPE` rejects for having no slash — so the
  // citation vanishes instead of being checked.
  it('still checks a `./`-prefixed file at the repository root', () => {
    const code = runGate('See `./DefinitelyMissing.md` for detail.\n');
    expect(code).toBe(1);
  });
});
