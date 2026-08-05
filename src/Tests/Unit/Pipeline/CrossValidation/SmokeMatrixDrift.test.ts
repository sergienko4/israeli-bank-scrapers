/**
 * E2E-smoke matrix drift guard.
 *
 * <p>The `e2e-smoke` job in `pr.yml` hard-codes one matrix entry per bank and
 * selects that bank with `jest --testNamePattern`. Two silent failure modes
 * follow from that design, and this suite pins both.
 *
 * <p><b>1. Silent-green drift.</b> A `--testNamePattern` that matches nothing
 * is not an error to jest: every test reports as "skipped" and the process
 * exits 0. A matrix entry that drifts out of sync with a `SMOKE_BANKS`
 * `displayName` therefore yields a GREEN cell that executed no test at all.
 *
 * <p><b>2. Cross-bank substring capture.</b> `--testNamePattern` is a
 * substring regex. The original unanchored pattern `Leumi \(invalid login\)`
 * also matched `Beinleumi (invalid login)`, so the Leumi cell ran two banks
 * and reported Beinleumi's result as Leumi's. Anchoring at `^E2E Smoke: `
 * plus the trailing ` (invalid login)` makes the match exact — but only for
 * as long as the `describe.each` title template keeps that exact shape, which
 * is why the template itself is pinned here.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

import { SMOKE_BANKS } from '../../../E2eSmoke/SmokeConfig.js';

const THIS_FILE_PATH = fileURLToPath(import.meta.url);
const THIS_DIR = dirname(THIS_FILE_PATH);
const REPO_ROOT = join(THIS_DIR, '../../../../../');
const PR_YAML = join(REPO_ROOT, '.github/workflows/pr.yml');
const SMOKE_SPEC = join(REPO_ROOT, 'src/Tests/E2eSmoke/InvalidLogin.e2e-smoke.test.ts');

/**
 * The `describe.each` title template the workflow's anchored
 * `--testNamePattern` targets. Changing it breaks every matrix cell.
 */
const DESCRIBE_TEMPLATE = 'E2E Smoke: $displayName (invalid login)';

/** The anchored selector each matrix cell must use. */
const ANCHORED_PATTERN = '--testNamePattern="^E2E Smoke: ${BANK} \\(invalid login\\)"';

/** Step that runs the bank's smoke test. */
const SMOKE_STEP = 'E2E smoke';

/** Step that fails the cell when the pattern matched zero tests. */
const ASSERT_STEP = 'Assert the bank test actually ran';

interface IPrYamlStep {
  readonly name?: string;
  readonly run?: string;
  readonly 'continue-on-error'?: boolean;
}

interface IPrYamlJob {
  readonly strategy?: { readonly matrix?: { readonly bank?: readonly string[] } };
  readonly steps?: readonly IPrYamlStep[];
}

interface IPrYaml {
  readonly jobs: Readonly<Record<string, IPrYamlJob>>;
}

/**
 * Parse the `e2e-smoke` job out of the PR workflow.
 * @returns The parsed job definition.
 */
function smokeJob(): IPrYamlJob {
  const source = readFileSync(PR_YAML, 'utf8');
  const yaml = parse(source) as IPrYaml;
  return yaml.jobs['e2e-smoke'];
}

/**
 * Read the bank list from the smoke matrix.
 * @returns Bank display names declared in `pr.yml`.
 */
function matrixBanks(): readonly string[] {
  return smokeJob().strategy?.matrix?.bank ?? [];
}

/**
 * Find a step by name prefix within the smoke job.
 * @param prefix - Leading text of the step name.
 * @returns The matching step.
 */
function requireStep(prefix: string): IPrYamlStep {
  const steps = smokeJob().steps ?? [];
  const found = steps.find(step => step.name?.startsWith(prefix) === true);
  expect(found).toBeDefined();
  // The assertion above already fails the test when the step is missing;
  // the empty fallback exists only to satisfy the non-nullable return type.
  return found ?? {};
}

/**
 * Every smoke describe-block title, as jest registers them.
 * @returns One title per configured bank.
 */
function smokeTitles(): readonly string[] {
  return SMOKE_BANKS.map(bank => `E2E Smoke: ${bank.displayName} (invalid login)`);
}

describe('E2E smoke matrix vs SMOKE_BANKS', () => {
  it('declares exactly the banks SMOKE_BANKS defines', () => {
    const declared = [...matrixBanks()].sort();
    const expected = SMOKE_BANKS.map(bank => bank.displayName).sort();
    expect(declared).toStrictEqual(expected);
  });

  it('declares each bank exactly once', () => {
    const declared = matrixBanks();
    const unique = new Set(declared);
    expect(unique.size).toBe(declared.length);
  });
});

describe('E2E smoke name-pattern anchoring', () => {
  it('pins the describe.each title template the pattern relies on', () => {
    const spec = readFileSync(SMOKE_SPEC, 'utf8');
    expect(spec).toContain(DESCRIBE_TEMPLATE);
  });

  it('anchors the pattern so one bank cannot capture another', () => {
    const run = requireStep(SMOKE_STEP).run ?? '';
    expect(run).toContain(ANCHORED_PATTERN);
  });

  it('keeps every display name unambiguous under the anchored pattern', () => {
    const titles = smokeTitles();
    const captured = titles.filter(title =>
      titles.some(other => other !== title && other.startsWith(title)),
    );
    expect(captured).toStrictEqual([]);
  });
});

describe('E2E smoke zero-test guard', () => {
  it('runs the assert-ran step', () => {
    const run = requireStep(ASSERT_STEP).run ?? '';
    expect(run).toContain('assert-smoke-ran.sh');
  });

  it('never lets the assert-ran step be swallowed by continue-on-error', () => {
    const step = requireStep(ASSERT_STEP);
    expect(step['continue-on-error']).toBeUndefined();
  });
});
