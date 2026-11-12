import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';

import { parse } from 'yaml';

import { readRepoFile } from '../../Helpers/RepoFiles.js';
import { createTempRepo, writeTempFile } from '../../Helpers/TempRepoTree.js';

const ROOTS: string[] = [];
const MARKER = 'SYNTHETIC_PUBLISHED_MODULE_LOADED';
const MODULE = [
  "export const CompanyTypes = { Beinleumi: 'beinleumi' };",
  'export function createScraper() {}',
  `throw new RangeError('${MARKER}');`,
].join('\n');

interface IComparisonStep {
  readonly id?: string;
  readonly name?: string;
  readonly if?: string;
  readonly run?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly 'continue-on-error'?: boolean;
}

/**
 * Find a required step without treating absent wiring as an empty step.
 * @param steps Job steps.
 * @param key Step id or display name.
 * @returns The required step.
 */
function requireStep(steps: readonly IComparisonStep[], key: string): IComparisonStep {
  const found = steps.find(step => step.id === key || step.name === key);
  if (found === undefined) throw new RangeError(`missing comparison step: ${key}`);
  return found;
}

/**
 * Read the required environment of a comparison attempt.
 * @param step Attempt step.
 * @returns Its configured environment.
 */
function environmentOf(step: IComparisonStep): Readonly<Record<string, string>> {
  if (step.env === undefined) throw new RangeError('missing comparison environment');
  return step.env;
}

afterEach(() => {
  for (const root of ROOTS.splice(0)) rmSync(root, { recursive: true, force: true });
});

it('[FIBI-NPM-1] actually loads the selected artifact in the unchanged real-bank test', () => {
  const root = createTempRepo();
  ROOTS.push(root);
  const entry = writeTempFile(root, 'published.mjs', MODULE);
  const result = spawnSync(
    process.execPath,
    [
      '--experimental-vm-modules',
      'node_modules/jest/bin/jest.js',
      '--runTestsByPath',
      'src/Tests/E2eReal/Beinleumi.e2e-real.test.ts',
      '--testNamePattern=scrapes transactions successfully',
      '--runInBand',
    ],
    {
      env: {
        ...process.env,
        E2E_FIBI_PUBLISHED_ENTRY: entry,
        BEINLEUMI_USERNAME: '',
        BEINLEUMI_PASSWORD: '',
      },
      encoding: 'utf8',
      timeout: 60000,
    },
  );
  expect(result.status).toBe(1);
  const output = result.stdout + result.stderr;
  expect(output).toContain(MARKER);
});

it('[FIBI-NPM-2] compares both versions in Group B without masking either failure', () => {
  const raw = readRepoFile('.github/workflows/pr.yml');
  const workflow = parse(raw) as {
    jobs: Record<string, { steps: readonly IComparisonStep[]; 'timeout-minutes': string }>;
  };
  const job = workflow.jobs['e2e-real-group-b'];
  expect(job['timeout-minutes']).toBe("${{ matrix.bank == 'Beinleumi' && 40 || 30 }}");
  const steps = job.steps;
  const baseline = requireStep(steps, 'published_e2e');
  const current = requireStep(steps, 'E2E real (${{ matrix.bank }})');
  const baselineEnv = environmentOf(baseline);
  const currentEnv = environmentOf(current);
  expect(baseline.if).toBe("${{ matrix.bank == 'Beinleumi' }}");
  expect(baselineEnv.E2E_FIBI_PUBLISHED_ENTRY).toContain(
    '/fibi-npm-10.0.1/node_modules/@sergienko4/israeli-bank-scrapers/lib/index.mjs',
  );
  expect(currentEnv.E2E_FIBI_PUBLISHED_ENTRY).toBeUndefined();
  expect(current.if).toBe(
    "${{ !cancelled() && steps.test_config.outcome == 'success' && (matrix.bank != 'Beinleumi' || steps.published_install.outcome == 'success') }}",
  );
  expect(baseline.run).toBe(current.run);
  expect(baseline.run).toContain("--testNamePattern='scrapes transactions successfully'");
  expect(baseline['continue-on-error']).toBeUndefined();
  expect(current['continue-on-error']).toBeUndefined();
  expect(baselineEnv.RUNS_ROOT).toBe('/tmp/runs/pipeline/published-10.0.1');
  expect(currentEnv.RUNS_ROOT).toContain('/tmp/runs/pipeline/current-source');
  const install = requireStep(steps, 'published_install');
  expect(install.run).toContain('"@sergienko4/israeli-bank-scrapers":"10.0.1"');
  expect(install.run).toContain('--prefix "$baseline"');
  expect(install.run).toContain('--ignore-scripts');
});
