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

/** Best-effort diagnostics sink — must never fail a required gate. */
const UPLOAD_STEP = 'Upload smoke diagnostics';

/** The `validate` aggregator step that decides the required check. */
const VERIFY_STEP = 'Verify all gates green';
/** Opening delimiter of a GitHub Actions expression, built to avoid literal use. */
const INTERPOLATION_OPEN = '$'.concat('{{');

interface IPrYamlStep {
  readonly name?: string;
  readonly run?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly 'continue-on-error'?: boolean;
}

interface IPrYamlJob {
  readonly needs?: readonly string[] | string;
  readonly strategy?: { readonly matrix?: { readonly bank?: readonly string[] } };
  readonly steps?: readonly IPrYamlStep[];
}

interface IPrYaml {
  readonly jobs: Readonly<Record<string, IPrYamlJob>>;
}

/**
 * Parse a job out of the PR workflow.
 * @param id - Job key under `jobs:`.
 * @returns The parsed job definition.
 */
function job(id: string): IPrYamlJob {
  const source = readFileSync(PR_YAML, 'utf8');
  const yaml = parse(source) as IPrYaml;
  return yaml.jobs[id];
}

/**
 * Parse the `e2e-smoke` job out of the PR workflow.
 * @returns The parsed job definition.
 */
function smokeJob(): IPrYamlJob {
  return job('e2e-smoke');
}

/**
 * Normalise a job's `needs` into a list.
 * @param id - Job key under `jobs:`.
 * @returns Declared upstream job ids.
 */
function needsOf(id: string): readonly string[] {
  const declared = job(id).needs ?? [];
  return typeof declared === 'string' ? [declared] : declared;
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

describe('E2E smoke is a required gate', () => {
  it('feeds the Validate aggregator that branch protection requires', () => {
    const validateNeeds = needsOf('validate');
    expect(validateNeeds).toContain('e2e-smoke');
  });

  it('never lets a red bank be swallowed by continue-on-error', () => {
    const step = requireStep(SMOKE_STEP);
    expect(step['continue-on-error']).toBeUndefined();
  });

  it('does not depend on validate, which would be a dependency cycle', () => {
    const smokeNeeds = needsOf('e2e-smoke');
    expect(smokeNeeds).not.toContain('validate');
  });

  it('still runs after the cheap gates so a broken build skips 17 live runners', () => {
    const needs = needsOf('e2e-smoke');
    expect(needs).toContain('lint-and-types');
    expect(needs).toContain('unit-tests');
    expect(needs).toContain('build');
  });

  it('never lets the best-effort diagnostics upload fail a green bank', () => {
    const step = requireStep(UPLOAD_STEP);
    expect(step['continue-on-error']).toBe(true);
  });

  it('rejects a skipped smoke run when the full suite is on', () => {
    // `skipped` counts as green in the aggregator's failure filter, which is
    // correct for gates that do not apply to a docs-only PR. Without this
    // explicit check an `if: false` would skip all 17 cells and still report
    // Validate green — a required gate that proves nothing.
    const steps = job('validate').steps ?? [];
    const found = steps.find(step => step.name?.startsWith(VERIFY_STEP) === true);
    const run = found?.run ?? '';
    expect(run).toContain('"e2e-smoke".result');
    expect(run).toContain('!= "success"');
  });

  it('reads the full-suite flag from env, not inline interpolation', () => {
    // A `${{ ... }}` expansion inside a `run:` body is a template-injection
    // sink (zizmor / CodeQL): the expression is pasted into the shell before
    // the shell ever sees it. The repo convention is to bind it to `env:` and
    // dereference `$VAR`, which the shell treats as data. Asserting it here
    // stops a future edit from quietly reintroducing the sink.
    const steps = job('validate').steps ?? [];
    const found = steps.find(step => step.name?.startsWith(VERIFY_STEP) === true);
    const run = found?.run ?? '';
    const env = found?.env ?? {};
    expect(run).not.toContain(INTERPOLATION_OPEN);
    // Assert the exact binding, not merely that the key exists: a hard-coded
    // `true` or an unrelated expression would satisfy a presence check while
    // silently decoupling the gate from the real full_suite output.
    const expectedBinding = INTERPOLATION_OPEN.concat(' needs.changes.outputs.full_suite }}');
    expect(env.FULL_SUITE).toBe(expectedBinding);
    expect(run).toContain('"$FULL_SUITE"');
  });
});

describe('security gates stay independent of live-bank flakiness', () => {
  it('keeps dependency-review off the validate chain', () => {
    const needs = needsOf('dependency-review');
    expect(needs).not.toContain('validate');
  });
});
