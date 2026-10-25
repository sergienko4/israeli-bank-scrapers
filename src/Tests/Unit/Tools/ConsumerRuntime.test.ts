import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { parse } from 'yaml';

import { canRunPosixBash } from '../../Helpers/HostCapabilities.js';
import { createTempRepo, writeTempFile } from '../../Helpers/TempRepoTree.js';

interface IActionStep {
  readonly id?: string;
  readonly run?: string;
  readonly uses?: string;
  readonly with?: Readonly<Record<string, string>>;
}

interface IAction {
  readonly outputs: Readonly<Record<string, { readonly value: string }>>;
  readonly runs: { readonly steps: readonly IActionStep[] };
}

const ROOT = process.cwd();
const ACTION_PATH = join(ROOT, '.github/actions/setup-consumer-runtime/action.yml');

/**
 * Reads the actual runtime-setup action.
 * @returns Parsed composite action.
 */
function action(): IAction {
  const source = readFileSync(ACTION_PATH, 'utf8');
  return parse(source) as IAction;
}

/**
 * Executes the action's floor extraction with an isolated manifest.
 * @param range Consumer engine range.
 * @returns Step exit status and output.
 */
function floorFor(range: string): { status: number; output: string } {
  const root = createTempRepo();
  try {
    const output = join(root, 'output');
    const manifest = JSON.stringify({ engines: { node: range } });
    writeTempFile(root, 'package.json', manifest);
    const run = action().runs.steps.find(step => step.id === 'floor')?.run ?? '';
    const result = spawnSync('bash', ['-euc', run], {
      cwd: root,
      env: { ...process.env, GITHUB_OUTPUT: output },
    });
    return {
      status: result.status ?? -1,
      output: result.status === 0 ? readFileSync(output, 'utf8') : '',
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('consumer runtime setup', () => {
  it.each(['24.11.0', '26.1.0'])(
    'derives %s from the manifest instead of a second pin',
    version => {
      if (canRunPosixBash(process.platform)) {
        const result = floorFor(`>= ${version}`);
        expect(result).toEqual({ status: 0, output: `version=${version}\n` });
      }
    },
  );

  it('rejects a range without an unambiguous supported floor', () => {
    if (canRunPosixBash(process.platform)) {
      const result = floorFor('^24 || ^26');
      expect(result.status).not.toBe(0);
    }
  });

  it('captures the floor binary before restoring the build runtime', () => {
    const steps = action().runs.steps;
    const sequence = steps.map(step => step.id ?? step.with);
    const outputs = action().outputs;
    expect(sequence).toEqual([
      'floor',
      { 'node-version': '${{ steps.floor.outputs.version }}' },
      'binary',
      { 'node-version-file': '.nvmrc' },
    ]);
    expect(steps[2].run).toContain("node -p 'process.execPath'");
    expect(outputs['node-path'].value).toBe('${{ steps.binary.outputs.path }}');
  });
});
