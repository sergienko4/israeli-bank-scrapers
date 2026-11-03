/**
 * Name-filter contract for the real-bank E2E jobs in `pr.yml`.
 *
 * <p>Each `e2e-real-group-*` job runs Jest with a `--testPathPatterns` built
 * from `matrix.bank` and a `--testNamePattern` that keeps only the happy
 * path. When the name filter skips every test in the matched file, Jest
 * still exits 0, so renaming a happy-path test turns a live-bank gate green
 * with nothing scraped. These rules make that rename fail here instead.
 * Both filters are matched the way Jest matches them: as case-insensitive
 * regular expressions.
 *
 * Rules:
 *   E2E-NAME-1  every E2E-real group job runs a path- and name-filtered Jest step
 *   E2E-NAME-2  each matrix bank's path filter selects at least one suite file
 *   E2E-NAME-3  every selected suite declares a test the name filter keeps
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

const THIS_FILE_URL = import.meta.url;
const THIS_FILE_PATH = fileURLToPath(THIS_FILE_URL);
const THIS_DIR = dirname(THIS_FILE_PATH);
const REPO_ROOT = join(THIS_DIR, '../../../../../');
const PR_YAML = join(REPO_ROOT, '.github/workflows/pr.yml');
const E2E_REAL_DIR = join(REPO_ROOT, 'src/Tests/E2eReal');

/** YAML key of every credential-bearing E2E-real matrix job. */
const GROUP_JOB_KEY = /^e2e-real-group-[a-z]$/;
const PATH_FLAG = /--testPathPatterns="([^"]+)"/;
const NAME_FLAG = /--testNamePattern='([^']+)'/;
const MATRIX_BANK = '${{ matrix.bank }}';
const TEST_TITLE = /\b(?:it|test)\(\s*'([^']+)'/g;

/** The slice of a workflow job this gate reads. */
interface IGroupJob {
  readonly strategy?: { readonly matrix?: { readonly bank?: readonly string[] } };
  readonly steps?: readonly { readonly run?: string }[];
}

/** One matrix bank as its E2E-real job runs it. */
interface IBankRun {
  readonly job: string;
  readonly bank: string;
  readonly paths: RegExp;
  readonly names: RegExp;
}

/**
 * Every E2E-real group job, keyed by its YAML key.
 * @returns `[key, job]` rows.
 */
function groupJobs(): readonly (readonly [string, IGroupJob])[] {
  const raw = readFileSync(PR_YAML, 'utf8');
  const doc = parse(raw) as { readonly jobs?: Readonly<Record<string, IGroupJob>> };
  const rows = Object.entries(doc.jobs ?? {});
  return rows.filter(([key]): boolean => GROUP_JOB_KEY.test(key));
}

/**
 * The Jest command of a job — the step that carries a name filter.
 * @param job - Workflow job.
 * @returns The step's `run` script, `''` when no step filters by name.
 */
function jestStepOf(job: IGroupJob): string {
  const scripts = (job.steps ?? []).map((step): string => step.run ?? '');
  return scripts.find((script): boolean => NAME_FLAG.test(script)) ?? '';
}

/**
 * The filters one matrix bank runs under. Bash double quotes turn the
 * script's `\\` into the `\` Jest receives.
 * @param key - Job key.
 * @param script - The job's Jest command.
 * @param bank - Matrix bank.
 * @returns The bank's run.
 */
function bankRunOf(key: string, script: string, bank: string): IBankRun {
  const pathFlag = PATH_FLAG.exec(script)?.[1] ?? '';
  const nameFlag = NAME_FLAG.exec(script)?.[1] ?? '';
  const path = pathFlag.replace(MATRIX_BANK, bank).replaceAll('\\\\', '\\');
  return { job: key, bank, paths: new RegExp(path, 'i'), names: new RegExp(nameFlag, 'i') };
}

/**
 * Every matrix bank of every E2E-real group job.
 * @returns One run per job × bank.
 */
function bankRuns(): readonly IBankRun[] {
  return groupJobs().flatMap(([key, job]): IBankRun[] => {
    const script = jestStepOf(job);
    const banks = job.strategy?.matrix?.bank ?? [];
    return banks.map((bank): IBankRun => bankRunOf(key, script, bank));
  });
}

/**
 * The suite files a bank's path filter selects.
 * @param run - Bank run.
 * @returns `E2eReal/<file>` paths.
 */
function suitesOf(run: IBankRun): readonly string[] {
  const files = readdirSync(E2E_REAL_DIR).filter((file): boolean => file.endsWith('.test.ts'));
  const paths = files.map((file): string => `E2eReal/${file}`);
  return paths.filter((path): boolean => run.paths.test(path));
}

/**
 * Whether a suite declares a test the name filter keeps.
 * @param suite - `E2eReal/<file>` path.
 * @param names - The job's name filter.
 * @returns True when at least one test title matches.
 */
function keepsATest(suite: string, names: RegExp): boolean {
  const suitePath = join(E2E_REAL_DIR, '..', suite);
  const source = readFileSync(suitePath, 'utf8');
  const matches = source.matchAll(TEST_TITLE);
  const titles = Array.from(matches, (match): string => match[1]);
  return titles.some((title): boolean => names.test(title));
}

const RUNS = bankRuns();

describe('E2eRealNameFilterGate', () => {
  it('[E2E-NAME-1] EveryGroupJob_ShouldRunAPathAndNameFilteredJestStep', () => {
    const jobs = groupJobs();
    const scripts = jobs.map(([key, job]): readonly [string, string] => [key, jestStepOf(job)]);
    const unfiltered = scripts.filter(([, script]): boolean => !PATH_FLAG.test(script));
    expect(jobs.length).toBeGreaterThan(0);
    expect(unfiltered).toEqual([]);
  });

  it.each(RUNS)('[E2E-NAME-2] $job $bank: ShouldSelectASuite', run => {
    const suites = suitesOf(run);
    expect(suites.length).toBeGreaterThan(0);
  });

  it.each(RUNS)('[E2E-NAME-3] $job $bank: ShouldKeepAHappyPathTest', run => {
    const suites = suitesOf(run);
    const skippedWhole = suites.filter((suite): boolean => !keepsATest(suite, run.names));
    expect(skippedWhole).toEqual([]);
  });
});
