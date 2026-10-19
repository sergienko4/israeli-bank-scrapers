import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

import { createTempRepo, writeTempFile } from '../../Helpers/TempRepoTree.js';

const ROOT = process.cwd();
const GATE = join(ROOT, 'scripts/check-node-support.mjs');
const MATRIX = ['24.22.0', '22', '24', '26'];

/**
 * Runs the support gate against a disposable policy.
 * @param dev Build pin.
 * @param matrix Unit matrix legs.
 * @param advertised README rows.
 * @returns Gate exit status.
 */
function checkPolicy(dev: string, matrix: string[], advertised: string[]): number {
  const root = createTempRepo();
  try {
    writePolicy(root, dev, matrix);
    const rows = advertised.map(version => `| \`${version}\` | tested |`).join('\n');
    writeTempFile(
      root,
      'README.md',
      `<!-- node-support:start -->\n${rows}\n<!-- node-support:end -->`,
    );
    const result = spawnSync(process.execPath, [GATE], { cwd: root, encoding: 'utf8' });
    if (result.error) throw result.error;
    return result.status ?? -1;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/**
 * Writes the support declarations.
 * @param root Fixture root.
 * @param dev Build pin.
 * @param matrix Unit matrix legs.
 * @returns Workflow fixture path.
 */
function writePolicy(root: string, dev: string, matrix: string[]): string {
  writeTempFile(root, '.nvmrc', `v${dev}\n`);
  const manifest = JSON.stringify({ engines: { node: '>=22.14.0' } });
  writeTempFile(root, 'package.json', manifest);
  const yaml = `  unit-tests:\n    strategy:\n      matrix:\n        node: ${JSON.stringify(matrix)}\n  next-job:\n`;
  return writeTempFile(root, '.github/workflows/pr.yml', yaml);
}

describe('separate build and consumer Node support', () => {
  it('accepts newer tooling without raising the consumer floor', () => {
    const result = checkPolicy('24.22.0', MATRIX, ['22.14.0', ...MATRIX]);
    expect(result).toBe(0);
  });

  it('rejects a tooling version missing from its test matrix', () => {
    const result = checkPolicy('24.22.0', ['22', '24', '26'], ['22.14.0', '22', '24', '26']);
    expect(result).toBe(1);
  });

  it('rejects an undocumented consumer floor', () => {
    const result = checkPolicy('24.22.0', MATRIX, MATRIX);
    expect(result).toBe(1);
  });

  it('rejects tooling below the supported consumer floor', () => {
    const result = checkPolicy('20.0.0', ['20.0.0'], ['22.14.0', '20.0.0']);
    expect(result).toBe(1);
  });

  it('rejects a malformed build pin instead of treating it as a compatible version', () => {
    const result = checkPolicy('latest', ['latest'], ['22.14.0', 'latest']);
    expect(result).toBe(1);
  });
});
