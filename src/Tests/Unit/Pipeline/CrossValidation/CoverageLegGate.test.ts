/**
 * Coverage-leg contract for the `unit-tests` matrix in `pr.yml`.
 *
 * <p>Only one Node leg collects coverage, enforces the thresholds and uploads
 * `coverage-report`; the other legs run the same suite with `--coverage=false`.
 * The leg is picked at run time by comparing `matrix.node` with `.nvmrc`, which
 * `scripts/check-node-support.mjs` already ties to the `engines.node` floor and
 * to one matrix leg. If the picker matched no leg, the thresholds would switch
 * off on every leg while CI stayed green. So this suite runs the real step
 * scripts under the workflow's own shell, against the committed `.nvmrc`
 * bytes. That file is CRLF today.
 *
 * Rules:
 *   CLG-1  exactly one matrix leg picks coverage, and it is the `.nvmrc` version
 *   CLG-2  the picker ignores line endings, padding and a leading `v`
 *   CLG-3  the test step passes `--coverage=false` on every leg but the picked one
 *   CLG-4  the steps are wired in order, and the upload runs only on the picked leg
 */

import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

import { canRunPosixBash } from '../../../Helpers/HostCapabilities.js';

const THIS_FILE_URL = import.meta.url;
const THIS_FILE_PATH = fileURLToPath(THIS_FILE_URL);
const THIS_DIR = dirname(THIS_FILE_PATH);
const REPO_ROOT = join(THIS_DIR, '../../../../../');
const PR_YAML = join(REPO_ROOT, '.github/workflows/pr.yml');
const NVMRC = join(REPO_ROOT, '.nvmrc');

const PICK_STEP = 'Pick the coverage leg';
const TEST_STEP = 'Unit tests';
const UPLOAD_STEP = 'Upload coverage artifact';
const UPLOAD_IF = "always() && steps.leg.outputs.coverage == 'true'";

/** Arguments the test step hands to `npm`, keyed by the picker's verdict. */
const NPM_ARGS = {
  true: 'run test:pipeline',
  false: 'run test:pipeline -- --coverage=false',
} as const;

/** `[verdict, npm arguments]` rows for `it.each`. */
const NPM_CASES = Object.entries(NPM_ARGS);

/** `.nvmrc` spellings the picker must read as the same version. */
const NVMRC_SPELLINGS = ['v22.14.0\r\n', 'v22.14.0\n', '22.14.0', '  v22.14.0 \n'] as const;

/** Step fields this suite reads. */
interface IStep {
  readonly name?: string;
  readonly id?: string;
  readonly if?: string;
  readonly run?: string;
  readonly env?: Readonly<Record<string, string>>;
}

/** Workflow fields this suite reads. */
interface IPrYamlDoc {
  readonly defaults?: { readonly run?: { readonly shell?: string } };
  readonly jobs: Readonly<
    Record<
      string,
      {
        readonly strategy?: { readonly matrix?: { readonly node?: readonly string[] } };
        readonly steps: readonly IStep[];
      }
    >
  >;
}

/** What one step script printed and how it exited. */
interface IStepRun {
  readonly status: number;
  readonly stdout: string;
}

/**
 * Parse the PR workflow.
 * @returns The parsed document.
 */
function loadPrYaml(): IPrYamlDoc {
  const text = readFileSync(PR_YAML, 'utf8');
  return parse(text) as IPrYamlDoc;
}

/**
 * The `unit-tests` job's steps.
 * @param doc - Parsed workflow.
 * @returns Its steps, in order.
 */
function unitSteps(doc: IPrYamlDoc): readonly IStep[] {
  return doc.jobs['unit-tests'].steps;
}

/**
 * Index of the one `unit-tests` step with this name.
 * @param doc - Parsed workflow.
 * @param name - Step name.
 * @returns Its index; throws unless exactly one step carries the name.
 */
function stepIndex(doc: IPrYamlDoc, name: string): number {
  const steps = unitSteps(doc);
  const hits = steps.filter((step): boolean => step.name === name);
  if (hits.length !== 1)
    throw new RangeError(`expected one "${name}" step, found ${String(hits.length)}`);
  return steps.findIndex((step): boolean => step.name === name);
}

/**
 * The one `unit-tests` step with this name.
 * @param doc - Parsed workflow.
 * @param name - Step name.
 * @returns The step.
 */
function stepNamed(doc: IPrYamlDoc, name: string): IStep {
  const index = stepIndex(doc, name);
  return unitSteps(doc)[index];
}

/**
 * Node legs of the `unit-tests` matrix.
 * @param doc - Parsed workflow.
 * @returns The legs, in declaration order.
 */
function matrixLegs(doc: IPrYamlDoc): readonly string[] {
  return doc.jobs['unit-tests'].strategy?.matrix?.node ?? [];
}

/**
 * The floor version as `scripts/check-node-support.mjs` reads `.nvmrc`.
 * @param raw - `.nvmrc` contents.
 * @returns The version without padding or a leading `v`.
 */
function floorOf(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.replace(/^v/u, '');
}

/**
 * Run a step script the way Actions does: from a file, under `defaults.run.shell`.
 * @param doc - Parsed workflow, for the shell argv.
 * @param script - The step's `run:` body.
 * @param env - Extra environment, including the step's `env:` values.
 * @returns Exit status and stdout.
 */
function runStep(doc: IPrYamlDoc, script: string, env: Readonly<Record<string, string>>): IStepRun {
  const file = join(env.STEP_DIR, 'step.sh');
  writeFileSync(file, script);
  const argv = (doc.defaults?.run?.shell ?? '').split(' ').filter((token): boolean => token !== '');
  const [command, ...rest] = argv.map((token): string => (token === '{0}' ? file : token));
  const options = { cwd: env.STEP_DIR, encoding: 'utf8' as const, env: { ...process.env, ...env } };
  const result = spawnSync(command, rest, options);
  return { status: result.status ?? -1, stdout: result.stdout };
}

/**
 * Run a callback inside a throwaway directory, removing it afterwards.
 * @param body - Receives the directory path.
 * @returns What the callback returned.
 */
function inTempDir<T>(body: (dir: string) => T): T {
  const temp = tmpdir();
  const prefix = join(temp, 'clg-');
  const dir = mkdtempSync(prefix);
  try {
    return body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The picker's verdict for one leg against one `.nvmrc`.
 * @param doc - Parsed workflow.
 * @param leg - The `matrix.node` value.
 * @param nvmrc - `.nvmrc` contents, byte for byte.
 * @returns The `coverage=` value the step wrote to `$GITHUB_OUTPUT`, or `exit N` if it failed.
 */
function pickFor(doc: IPrYamlDoc, leg: string, nvmrc: string): string {
  return inTempDir((dir): string => {
    const nvmrcPath = join(dir, '.nvmrc');
    writeFileSync(nvmrcPath, nvmrc);
    const output = join(dir, 'github-output');
    const script = stepNamed(doc, PICK_STEP).run ?? '';
    const run = runStep(doc, script, { STEP_DIR: dir, NODE_LEG: leg, GITHUB_OUTPUT: output });
    if (run.status !== 0) return `exit ${String(run.status)}`;
    const written = readFileSync(output, 'utf8');
    return written.replace(/^coverage=/u, '').trim();
  });
}

/**
 * Legs the picker selects for coverage.
 * @param doc - Parsed workflow.
 * @param nvmrc - `.nvmrc` contents.
 * @returns Every leg whose verdict is `true`.
 */
function coverageLegs(doc: IPrYamlDoc, nvmrc: string): readonly string[] {
  return matrixLegs(doc).filter((leg): boolean => pickFor(doc, leg, nvmrc) === 'true');
}

/**
 * Arguments the test step passes to `npm`, captured by a stub on `PATH`.
 * @param doc - Parsed workflow.
 * @param coverage - The picker's verdict.
 * @returns The arguments, space-joined.
 */
function npmArgsFor(doc: IPrYamlDoc, coverage: string): string {
  return inTempDir((dir): string => {
    const stub = join(dir, 'npm');
    writeFileSync(stub, '#!/bin/sh\necho "$*"\n');
    chmodSync(stub, 0o755);
    const script = stepNamed(doc, TEST_STEP).run ?? '';
    const path = `${dir}${delimiter}${process.env.PATH ?? ''}`;
    const run = runStep(doc, script, { STEP_DIR: dir, PATH: path, COVERAGE: coverage });
    return run.stdout.trim();
  });
}

describe('CoverageLegGate', () => {
  it('[CLG-1] RealNvmrc_ShouldPickExactlyTheFloorLeg', () => {
    if (canRunPosixBash(process.platform)) {
      const doc = loadPrYaml();
      const nvmrc = readFileSync(NVMRC, 'utf8');
      const picked = coverageLegs(doc, nvmrc);
      const legs = matrixLegs(doc);
      const floor = floorOf(nvmrc);
      expect(legs).toContain(floor);
      expect(picked).toEqual([floor]);
    }
  });

  it.each(NVMRC_SPELLINGS)('[CLG-2] NvmrcSpelling_ShouldStillPickTheFloor: %j', spelling => {
    if (canRunPosixBash(process.platform)) {
      const doc = loadPrYaml();
      const onFloor = pickFor(doc, '22.14.0', spelling);
      const offFloor = pickFor(doc, '22', spelling);
      expect([onFloor, offFloor]).toEqual(['true', 'false']);
    }
  });

  it.each(NPM_CASES)('[CLG-3] TestStep_Coverage_%s_ShouldRun: %s', (coverage, expected) => {
    if (canRunPosixBash(process.platform)) {
      const doc = loadPrYaml();
      const args = npmArgsFor(doc, coverage);
      expect(args).toBe(expected);
    }
  });

  it('[CLG-4] Steps_ShouldBeWiredInOrder_AndUploadOnlyThePickedLeg', () => {
    const doc = loadPrYaml();
    const order = [PICK_STEP, TEST_STEP, UPLOAD_STEP].map((name): number => stepIndex(doc, name));
    const sorted = [...order].sort((left, right): number => left - right);
    expect(order).toEqual(sorted);
    const pick = stepNamed(doc, PICK_STEP);
    expect(pick).toMatchObject({ id: 'leg', env: { NODE_LEG: '${{ matrix.node }}' } });
    expect(stepNamed(doc, TEST_STEP).env).toEqual({
      COVERAGE: '${{ steps.leg.outputs.coverage }}',
    });
    expect(stepNamed(doc, UPLOAD_STEP).if).toBe(UPLOAD_IF);
  });
});
