/**
 * Docs dependency pin gate.
 *
 * <p>The scheduled OpenSSF Scorecard scan raises `PinnedDependenciesID` for
 * every `pip install` that is not hash-pinned. The docs job is the only
 * Python consumer in the repository, and it installs
 * `requirements-docs.txt` in two workflows. Hash-pinning the lock and
 * installing it with `--require-hashes` closes the gap and keeps a
 * compromised package index from substituting a different archive.
 *
 * <p>This test is the regression guard: a requirement that loses its hashes,
 * or a workflow that drops the flag, fails here before the scheduled scan
 * has to notice.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = dirname(THIS_FILE);
const REPO_ROOT = join(THIS_DIR, '../../../');
const REQUIREMENTS = join(REPO_ROOT, 'requirements-docs.txt');
const WORKFLOWS = [
  join(REPO_ROOT, '.github/workflows/docs.yml'),
  join(REPO_ROOT, '.github/workflows/pr.yml'),
] as const;
const HASHED_INSTALL = 'pip install --require-hashes -r requirements-docs.txt';

/**
 * Join continuation lines into one logical requirement per package.
 * @param raw - Requirements file text.
 * @returns Logical requirement lines, without comments or blank lines.
 */
function logicalRequirements(raw: string): readonly string[] {
  const lines = raw
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#'));
  const logical: string[] = [];
  let current = '';
  for (const line of lines) {
    const isContinuation = line.endsWith('\\');
    const part = isContinuation ? line.slice(0, -1).trimEnd() : line;
    current = current.length > 0 ? `${current} ${part}` : part;
    if (!isContinuation) {
      logical.push(current);
      current = '';
    }
  }
  return logical;
}

describe('docs dependency pins', () => {
  it('hash-pins every package in requirements-docs.txt', () => {
    const raw = readFileSync(REQUIREMENTS, 'utf8');
    const requirements = logicalRequirements(raw);
    expect(requirements.length).toBeGreaterThan(0);
    for (const requirement of requirements) {
      expect(requirement).toMatch(/^[\w.-]+==\S+/);
      expect(requirement).toContain('--hash=sha256:');
    }
  });

  it('keeps the direct docs tools in the lock', () => {
    const raw = readFileSync(REQUIREMENTS, 'utf8');
    expect(raw).toMatch(/^zensical==/m);
    expect(raw).toMatch(/^pymdown-extensions==/m);
  });

  it.each(WORKFLOWS)('installs the docs lock with --require-hashes in %s', path => {
    const raw = readFileSync(path, 'utf8');
    expect(raw).toContain(HASHED_INSTALL);
  });
});
