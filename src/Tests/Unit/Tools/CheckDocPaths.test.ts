/**
 * Regression test for the build-output exemption in
 * `scripts/check-doc-paths.mjs`.
 *
 * The gate resolves paths cited in Markdown. `lib/` is the build output and
 * is gitignored, so it is present on any machine that has run a build and
 * absent on a fresh CI checkout. Before the exemption, a PR body asserting
 * the published bundle was unchanged passed the pre-push hook locally and
 * failed the identical CI job — the pass-locally/fail-in-CI flake the
 * script's own `OPTIONAL_PATHS` comment warns about.
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
 * Run the gate over a throwaway Markdown body.
 *
 * The file is written to a temp directory and removed afterwards, so the
 * test leaves nothing behind and cannot be perturbed by a previous run.
 * @param body - Markdown source to check.
 * @returns Exit code the gate reported.
 */
function runGate(body: string): number {
  const tempRoot = os.tmpdir();
  const prefix = path.join(tempRoot, 'doc-paths-');
  const dir = fs.mkdtempSync(prefix);
  const file = path.join(dir, 'body.md');
  fs.writeFileSync(file, body, 'utf8');
  const result = spawnSync('node', [GATE, file], { encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  return result.status ?? 1;
}

describe('check-doc-paths — build output is exempt', () => {
  // Deliberately a file that never exists. Citing the real `lib/index.d.ts`
  // would pass with or without the exemption on any machine that has run a
  // build, which is the vacuous form of this test and proves nothing.
  it('exempts the whole build directory, not just files that happen to be built', () => {
    const code = runGate('The bundle at `lib/never-generated.d.ts` is out of scope.\n');
    expect(code).toBe(0);
  });

  it('accepts the citation the PR body actually makes', () => {
    const code = runGate('Public API unchanged: `lib/index.d.ts` SHA-256 matches.\n');
    expect(code).toBe(0);
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
