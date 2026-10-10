/**
 * Worker-count contract for `npm run test:pipeline`.
 *
 * <p>`test:pipeline` reads `jest.pipeline.suite.config.cjs`, which is the
 * shared `jest.pipeline.config.cjs` plus a `maxWorkers` that CI raises through
 * `JEST_MAX_WORKERS`. Each link fails silently when it breaks. A `--maxWorkers`
 * flag in the script beats the config and switches the knob off. A
 * `maxWorkers` in the shared config changes the Memory gate's workload. A value
 * Jest cannot parse becomes one worker. So this suite pins every link: the
 * script, the shared config, the resolved config, and the CI job that sets the
 * variable.
 *
 * Rules:
 *   PWG-1  `test:pipeline` uses the suite config and sets no worker flag
 *   PWG-2  `test:memory` and the shared config stay free of a worker count
 *   PWG-3  the suite config is the shared config plus `JEST_MAX_WORKERS` (default 2)
 *   PWG-4  a value Jest would quietly turn into one worker fails the config load
 *   PWG-5  the `unit-tests` job sets `JEST_MAX_WORKERS` to 4, which the config accepts
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

const THIS_FILE_URL = import.meta.url;
const THIS_FILE_PATH = fileURLToPath(THIS_FILE_URL);
const THIS_DIR = dirname(THIS_FILE_PATH);
const REPO_ROOT = join(THIS_DIR, '../../../../../');
const PR_YAML = join(REPO_ROOT, '.github/workflows/pr.yml');
const PACKAGE_JSON = join(REPO_ROOT, 'package.json');
const BASE_CONFIG = 'jest.pipeline.config.cjs';
const SUITE_CONFIG = 'jest.pipeline.suite.config.cjs';
const KNOB = 'JEST_MAX_WORKERS';

/** Any Jest CLI flag that fixes the worker count and so overrides the config. */
const WORKER_FLAG = /(?:^|\s)(?:--maxWorkers|-w|--runInBand|-i)(?:[=\s]|$)/;

/** Loads both configs in a fresh process and reports how the suite one differs. */
const PROBE = [
  `const base = require('./${BASE_CONFIG}');`,
  `const { maxWorkers, ...rest } = require('./${SUITE_CONFIG}');`,
  'const sameAsBase = JSON.stringify(rest) === JSON.stringify(base);',
  "process.stdout.write(JSON.stringify({ maxWorkers, sameAsBase, baseHasWorkers: 'maxWorkers' in base }));",
].join('\n');

/** Leaves `JEST_MAX_WORKERS` out of the child's environment. */
const UNSET: Readonly<Record<string, string>> = {};

/** `[label, resolved maxWorkers, child env overrides]`. */
type AcceptedCase = readonly [string, string, Readonly<Record<string, string>>];

/** Unset falls back to 2; every accepted spelling passes through unchanged. */
const ACCEPTED: readonly AcceptedCase[] = [
  ['unset', '2', UNSET],
  ...['1', '4', '16', '50%', '100%'].map((value): AcceptedCase => [
    value,
    value,
    { [KNOB]: value },
  ]),
];

/** Values Jest's `parseWorkers` would turn into 1 worker or a surprise. */
const REJECTED = ['', 'four', '0', '-1', '0%', '101%', ' 4', '4.5'] as const;

/** What the probe printed. */
interface IProbe {
  readonly maxWorkers: string;
  readonly sameAsBase: boolean;
  readonly baseHasWorkers: boolean;
}

/** How one probe run ended. */
interface IProbeRun {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Workflow fields this suite reads. */
interface IPrYamlDoc {
  readonly jobs: Readonly<
    Record<string, { readonly env?: Readonly<Record<string, string | number>> }>
  >;
}

/**
 * One npm script from `package.json`.
 * @param name - Script name.
 * @returns Its command line.
 */
function npmScript(name: string): string {
  const text = readFileSync(PACKAGE_JSON, 'utf8');
  const pkg = JSON.parse(text) as { readonly scripts: Readonly<Record<string, string>> };
  return pkg.scripts[name];
}

/**
 * The current environment without the knob, plus these overrides.
 * @param overrides - Variables to set; pass {@link UNSET} to leave the knob out.
 * @returns A copy of the current environment.
 */
function envWith(overrides: Readonly<Record<string, string>>): NodeJS.ProcessEnv {
  const entries = Object.entries(process.env).filter(([key]): boolean => key !== KNOB);
  const inherited: NodeJS.ProcessEnv = Object.fromEntries(entries);
  return { ...inherited, ...overrides };
}

/**
 * Load both configs in a child Node process.
 * @param overrides - Variables to set; pass {@link UNSET} to leave the knob out.
 * @returns How the load ended.
 */
function runProbe(overrides: Readonly<Record<string, string>>): IProbeRun {
  const env = envWith(overrides);
  const options = { cwd: REPO_ROOT, encoding: 'utf8' as const, env };
  const run = spawnSync(process.execPath, ['-e', PROBE], options);
  return { status: run.status ?? -1, stdout: run.stdout, stderr: run.stderr };
}

/**
 * Load both configs and parse the report, failing on a bad exit.
 * @param overrides - Variables to set; pass {@link UNSET} to leave the knob out.
 * @returns The probe's report.
 */
function probe(overrides: Readonly<Record<string, string>>): IProbe {
  const run = runProbe(overrides);
  if (run.status !== 0) throw new RangeError(`config load failed: ${run.stderr}`);
  return JSON.parse(run.stdout) as IProbe;
}

/**
 * The `unit-tests` job's `JEST_MAX_WORKERS`, as Actions hands it to the step.
 * @returns The value as a string; empty when the job does not set it.
 */
function ciWorkers(): string {
  const text = readFileSync(PR_YAML, 'utf8');
  const doc = parse(text) as IPrYamlDoc;
  const value = doc.jobs['unit-tests'].env?.[KNOB] ?? '';
  return String(value);
}

describe('PipelineWorkersGate — test:pipeline worker count', () => {
  it('PWG-1: test:pipeline reads the suite config and sets no worker flag', () => {
    const script = npmScript('test:pipeline');
    expect(script).toContain(`--config=${SUITE_CONFIG}`);
    expect(script).not.toMatch(WORKER_FLAG);
  });

  it('PWG-2: test:memory reads the shared config, which sets no worker count', () => {
    const script = npmScript('test:memory');
    expect(script).toContain(`--config=${BASE_CONFIG}`);
    expect(script).not.toMatch(WORKER_FLAG);
    expect(probe(UNSET).baseHasWorkers).toBe(false);
  });

  it.each(ACCEPTED)(
    'PWG-3: %s resolves to maxWorkers %p over the shared config',
    (_label, want, overrides) => {
      const report = probe(overrides);
      expect(report).toEqual({ maxWorkers: want, sameAsBase: true, baseHasWorkers: false });
    },
  );

  it.each(REJECTED)('PWG-4: %p fails the config load', value => {
    const run = runProbe({ [KNOB]: value });
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain(`${KNOB} must be a positive integer or 1-100%`);
  });

  it('PWG-5: the unit-tests job sets 4 workers, and the config accepts it', () => {
    const value = ciWorkers();
    expect(value).toBe('4');
    expect(probe({ [KNOB]: value }).maxWorkers).toBe('4');
  });
});
