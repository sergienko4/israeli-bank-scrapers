/**
 * Worker-count contract for `npm run test:pipeline`.
 *
 * <p>`test:pipeline` reads `jest.pipeline.suite.config.cjs`, which is the
 * shared `jest.pipeline.config.cjs` plus a `maxWorkers` a run can raise through
 * `JEST_MAX_WORKERS`. Each link fails silently when it breaks. A `--maxWorkers`
 * flag in the script beats the config and switches the knob off. A
 * `maxWorkers` in the shared config changes the Memory gate's workload. A value
 * Jest cannot parse becomes one worker. So this suite pins every link: the
 * script, the shared config, the resolved config, and CI's worker count.
 *
 * <p>CI stays on the default 2: a trial at 4 hit Jest's ESM "module not been
 * linked" race on the Node 22 leg (see the `unit-tests` job in `pr.yml`).
 *
 * Rules:
 *   PWG-1  `test:pipeline` uses the suite config and sets no worker flag
 *   PWG-2  `test:memory` and the shared config stay free of a worker count
 *   PWG-3  the suite config is the shared config plus `JEST_MAX_WORKERS` (default 2)
 *   PWG-4  a value Jest would quietly turn into one worker fails the config load
 *   PWG-5  no CI code line raises the worker count, so CI runs the default 2
 */

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_FILE_URL = import.meta.url;
const THIS_FILE_PATH = fileURLToPath(THIS_FILE_URL);
const THIS_DIR = dirname(THIS_FILE_PATH);
const REPO_ROOT = join(THIS_DIR, '../../../../../');
const PACKAGE_JSON = join(REPO_ROOT, 'package.json');
const BASE_CONFIG = 'jest.pipeline.config.cjs';
const SUITE_CONFIG = 'jest.pipeline.suite.config.cjs';
const KNOB = 'JEST_MAX_WORKERS';

/** Any Jest CLI flag that fixes the worker count and so overrides the config. */
const WORKER_FLAG = /(?:^|\s)(?:--maxWorkers|-w|--runInBand|-i)(?:[=\s]|$)/;

/** Every place a CI job's environment or command line can come from. */
const CI_DIRS = ['.github/workflows', '.github/actions', '.github/scripts'] as const;

/** A whole-line comment: YAML or shell `#`, JS `//`, or a block-comment line. */
const COMMENT_LINE = /^\s*(?:#|\/\/|\/?\*)/;

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
 * Every file under one CI directory.
 * @param dir - Directory relative to the repo root.
 * @returns Repo-relative file paths.
 */
function filesUnder(dir: string): string[] {
  const root = join(REPO_ROOT, dir);
  const names = readdirSync(root, { recursive: true, encoding: 'utf8' });
  const paths = names.map((name): string => join(dir, name));
  return paths.filter((path): boolean => isFile(path));
}

/**
 * Whether a repo-relative path is a regular file.
 * @param path - Repo-relative path.
 * @returns True for a file, false for a directory.
 */
function isFile(path: string): boolean {
  const absolute = join(REPO_ROOT, path);
  const stats = statSync(absolute);
  return stats.isFile();
}

/**
 * Whether a line, outside a comment, sets the knob or passes `test:pipeline`
 * a worker flag. Either route (job, step or workflow `env`, `$GITHUB_ENV`, a
 * script, the command line) takes CI off the default.
 * @param line - One line of a CI file.
 * @returns True when the line raises the worker count.
 */
function raisesWorkers(line: string): boolean {
  if (COMMENT_LINE.test(line)) return false;
  return line.includes(KNOB) || (line.includes('test:pipeline') && WORKER_FLAG.test(line));
}

/**
 * The lines in one CI file that raise the worker count.
 * @param path - Repo-relative file path.
 * @returns `path:line` for each offending line.
 */
function workerLines(path: string): string[] {
  const absolute = join(REPO_ROOT, path);
  const lines = readFileSync(absolute, 'utf8').split('\n');
  const hits = lines.map((line, index): string => {
    const lineNumber = String(index + 1);
    return raisesWorkers(line) ? `${path}:${lineNumber}` : '';
  });
  return hits.filter((hit): boolean => hit !== '');
}

/**
 * Every CI line that raises the worker count.
 * @returns `path:line` entries; empty when CI keeps the default.
 */
function ciWorkerLines(): string[] {
  const files = CI_DIRS.flatMap((dir): string[] => filesUnder(dir));
  return files.flatMap((path): string[] => workerLines(path));
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

  it('PWG-5: no CI code line raises the worker count, so CI runs the default 2', () => {
    const offenders = ciWorkerLines();
    expect(offenders).toEqual([]);
    expect(probe(UNSET).maxWorkers).toBe('2');
  });
});
