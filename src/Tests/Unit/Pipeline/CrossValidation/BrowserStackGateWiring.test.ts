/**
 * Browser stack contract wiring in `pr.yml`.
 *
 * <p>The `browser-stack` job runs the patch-anchor and Juggler-protocol checks
 * before E2E mocked and the Integration shards spend runners on a Camoufox
 * build that cannot drive the resolved playwright-core. It is step-gated: the
 * job always runs after `changes` and only its steps read `critical_deps`, so
 * without a browser-stack change it succeeds as a no-op and the heavy jobs
 * keep their own `if:`. A job-level `if:` would skip it on those PRs instead,
 * and a skipped need skips both heavy jobs with it.
 *
 * Rules:
 *   BSW-1  the job needs only `changes`, has no job-level `if:` and reads only
 *          the repository
 *   BSW-2  it checks out without credentials, sets up Node, installs without
 *          lifecycle scripts, then runs the strict patcher and the contract check
 *   BSW-3  every step runs only when `critical_deps` is true
 *   BSW-4  E2E mocked and the Integration shards need it, and so does Validate
 *   BSW-5  the real conditions give the modelled results on every row of the
 *          truth table
 *   BSW-6  every wiring mutant changes at least one row
 *   BSW-7  the commands it runs exist: the `lint:browser-stack` script and the
 *          patcher's `--strict` flag
 *   BSW-8  E2E mocked runs the runtime contract file alone, unconditionally,
 *          before its full suite, and that file exists
 *   BSW-9  that file's setup, which takes the job's first Camoufox launch, is
 *          bounded only by the shared first-launch bound, read from the syntax
 *          tree, and that bound outlasts the one the launcher applies, default
 *          or raised by `CAMOUFOX_LAUNCH_TIMEOUT_MS`, so a slow launch fails
 *          with the launcher's error
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as ts from 'typescript';
import { parse } from 'yaml';

import {
  CAMOUFOX_LAUNCH_TIMEOUT_ENV,
  DEFAULT_CAMOUFOX_LAUNCH_TIMEOUT_MS,
  resolveLaunchTimeoutMs,
} from '../../../../Scrapers/Pipeline/Mediator/Browser/CamoufoxLauncher.js';
import { firstLaunchHookTimeoutMs } from '../../../E2eMocked/Helpers/BrowserFixture.js';
import { captureEnvVar, restoreEnvVar } from '../../../Helpers/AmbientEnv.js';
import type { IGhaStatus, INeed } from '../../../Helpers/GhaExpression.js';
import { evaluateIf, jobStatus } from '../../../Helpers/GhaExpression.js';

const THIS_FILE_PATH = fileURLToPath(import.meta.url);
const THIS_DIR = dirname(THIS_FILE_PATH);
const REPO_ROOT = join(THIS_DIR, '../../../../../');

const GATE = 'browser-stack';
const ROOT = 'changes';
const HEAVY_JOBS = ['e2e-mocked', 'integration'] as const;
const STEP_IF = "needs.changes.outputs.critical_deps == 'true'";
const NO_IF = 'success()';
const PATCHER = 'scripts/patch-playwright-core.mjs';
const CHECK_SCRIPT = 'lint:browser-stack';

/** The gate's steps: the action each uses, or the command each runs. */
const EXPECTED_STEPS = [
  'actions/checkout',
  'actions/setup-node',
  'npm ci --ignore-scripts --no-audit --no-fund',
  `node ${PATCHER} --strict`,
  `npm run ${CHECK_SCRIPT}`,
];

/** The steps whose outcome is the gate's verdict. */
const CHECK_STEPS = EXPECTED_STEPS.slice(3);

/** The runtime contract E2E mocked runs on its own first. */
const CONTRACT_TEST = 'src/Tests/E2eMocked/BrowserStackContract.e2e-mocked.test.ts';

/** The fixture function that takes the shared browser's first launch. */
const SHARED_LAUNCH = 'getSharedBrowser';

/** The Jest hook a file launches the shared browser in. */
const SETUP_HOOK = 'beforeAll';

/** A launching hook bounded at 1 ms, with the expected bound only in a comment. */
const PLANTED_COMMENT_BOUND = [
  'beforeAll(async () => {',
  '  browser = await getSharedBrowser();',
  '  /* keep:',
  '}, firstLaunchHookTimeoutMs());',
  '  */',
  '}, 1);',
].join('\n');

/** A launch bound raised above the default, as docs/quick-start.md allows on a slow link. */
const RAISED_LAUNCH_MS = 600_000;

/** Launcher bounds the hook must outlast: label, env value, resulting bound. */
const LAUNCH_BOUNDS = [
  ['the default', undefined, DEFAULT_CAMOUFOX_LAUNCH_TIMEOUT_MS],
  ['a raised', String(RAISED_LAUNCH_MS), RAISED_LAUNCH_MS],
] as const;

/** E2E mocked's commands: the runtime contract alone, then the full suite. */
const E2E_MOCKED_RUNS = [
  `npm run test:e2e:mock -- --ci --verbose --runTestsByPath ${CONTRACT_TEST}`,
  'npm run test:e2e:mock -- --ci --verbose',
];

/** Where a step's `if:` is checked: every earlier step succeeded. */
const STEP_STATUS: IGhaStatus = { success: true, failure: false, cancelled: false };

type CheckOutcome = 'success' | 'failure' | 'cancelled';

interface IStep {
  readonly uses?: string;
  readonly run?: string;
  readonly if?: string;
  readonly with?: Readonly<Record<string, unknown>>;
}

interface IJob {
  readonly needs?: string | readonly string[];
  readonly if?: string;
  readonly permissions?: unknown;
  readonly steps?: readonly IStep[];
}

type Jobs = Readonly<Record<string, IJob>>;

/** One PR shape; `expected` is `[gate result, E2E mocked, Integration]`. */
interface IRow {
  readonly name: string;
  readonly changes: string;
  readonly outputs: Readonly<Record<string, string>>;
  readonly check: CheckOutcome;
  readonly expected: readonly string[];
}

/**
 * The `changes` outputs the conditions read.
 *
 * @param criticalDeps - `critical_deps`.
 * @param fullSuite - `full_suite`.
 * @param deps - `deps`.
 * @returns The outputs, as the strings GitHub passes.
 */
function flags(criticalDeps: boolean, fullSuite: boolean, deps: boolean): Record<string, string> {
  return { critical_deps: String(criticalDeps), full_suite: String(fullSuite), deps: String(deps) };
}

/** `check` is what the two checks would conclude if they ran. */
const ROWS: readonly IRow[] = [
  {
    name: 'src-only PR whose check would fail',
    changes: 'success',
    outputs: flags(false, true, false),
    check: 'failure',
    expected: ['success', 'ran', 'ran'],
  },
  {
    name: 'browser-stack PR, contract holds',
    changes: 'success',
    outputs: flags(true, true, true),
    check: 'success',
    expected: ['success', 'ran', 'ran'],
  },
  {
    name: 'browser-stack PR, contract broken',
    changes: 'success',
    outputs: flags(true, true, true),
    check: 'failure',
    expected: ['failure', 'skipped', 'skipped'],
  },
  {
    name: 'browser-stack PR, run cancelled mid-check',
    changes: 'success',
    outputs: flags(true, true, true),
    check: 'cancelled',
    expected: ['cancelled', 'skipped', 'skipped'],
  },
  {
    name: 'dependency-only PR outside the stack',
    changes: 'success',
    outputs: flags(false, false, true),
    check: 'failure',
    expected: ['success', 'ran', 'skipped'],
  },
  {
    name: 'docs-only PR',
    changes: 'success',
    outputs: flags(false, false, false),
    check: 'failure',
    expected: ['success', 'skipped', 'skipped'],
  },
  {
    name: 'Detect changes failed',
    changes: 'failure',
    outputs: flags(true, true, true),
    check: 'success',
    expected: ['skipped', 'skipped', 'skipped'],
  },
];

const EXPECTED_ROWS = ROWS.map(row => [row.name, row.expected] as const);
const EXPECTED_TABLE = Object.fromEntries(EXPECTED_ROWS);

/**
 * The jobs of `pr.yml`.
 *
 * @returns Jobs by key.
 */
function prJobs(): Jobs {
  const path = join(REPO_ROOT, '.github/workflows/pr.yml');
  const text = readFileSync(path, 'utf8');
  const doc = parse(text) as { readonly jobs?: Jobs };
  return doc.jobs ?? {};
}

/**
 * A job's `needs`, as a list.
 *
 * @param job - The job.
 * @returns The job keys it waits for.
 */
function needsOf(job: IJob): readonly string[] {
  const needs = job.needs ?? [];
  return typeof needs === 'string' ? [needs] : needs;
}

/**
 * What one step does: the action it uses, or the command it runs.
 *
 * @param step - The step.
 * @returns The action without its pin, or the trimmed command.
 */
function signatureOf(step: IStep): string {
  const [action = ''] = (step.uses ?? '').split('@');
  return step.uses === undefined ? (step.run ?? '').trim() : action;
}

/**
 * The gate job's steps.
 *
 * @param jobs - All jobs.
 * @returns Its steps.
 */
function gateSteps(jobs: Jobs): readonly IStep[] {
  const job = jobOf(jobs, GATE);
  return job.steps ?? [];
}

/**
 * One job, or an empty one when it is missing.
 *
 * @param jobs - All jobs.
 * @param key - The job key.
 * @returns The job.
 */
function jobOf(jobs: Jobs, key: string): IJob {
  return jobs[key] ?? {};
}

/**
 * Whether a step is one of the two checks.
 *
 * @param step - The step.
 * @returns True for the strict patcher and the contract check.
 */
function isCheckStep(step: IStep): boolean {
  const signature = signatureOf(step);
  return CHECK_STEPS.includes(signature);
}

/**
 * The context `needs.*` exposes to one job.
 *
 * @param job - The job.
 * @param known - Every modelled job, as a need.
 * @returns Its needs; throws on a need the table does not model.
 */
function needsContext(job: IJob, known: Readonly<Record<string, INeed>>): Record<string, INeed> {
  const keys = needsOf(job);
  const unmodelled = keys.filter(key => !(key in known));
  if (unmodelled.length > 0) throw new RangeError(`unmodelled needs: ${unmodelled.join(', ')}`);
  const rows = keys.map(key => [key, known[key]] as const);
  return Object.fromEntries(rows);
}

/**
 * The gate's result on one row.
 *
 * @param jobs - All jobs.
 * @param row - The PR shape.
 * @returns `skipped`, `success` when no check runs, or the checks' outcome.
 */
function gateResult(jobs: Jobs, row: IRow): string {
  const job = jobOf(jobs, GATE);
  const needs = needsContext(job, { [ROOT]: { result: row.changes, outputs: row.outputs } });
  const status = jobStatus(needs, false);
  const isRun = evaluateIf(job.if ?? NO_IF, { needs, status });
  if (!isRun) return 'skipped';
  const checks = gateSteps(jobs).filter(isCheckStep);
  const isChecked = checks.some(step =>
    evaluateIf(step.if ?? NO_IF, { needs, status: STEP_STATUS }),
  );
  return isChecked ? row.check : 'success';
}

/**
 * Whether a heavy job runs on one row.
 *
 * @param job - The heavy job.
 * @param row - The PR shape.
 * @param gate - The gate's result on that row.
 * @returns `ran` or `skipped`.
 */
function heavyResult(job: IJob, row: IRow, gate: string): string {
  const changes = { result: row.changes, outputs: row.outputs };
  const needs = needsContext(job, { [ROOT]: changes, [GATE]: { result: gate, outputs: {} } });
  const status = jobStatus(needs, gate === 'cancelled');
  const isRun = evaluateIf(job.if ?? NO_IF, { needs, status });
  return isRun ? 'ran' : 'skipped';
}

/**
 * The gate's and the heavy jobs' results on one row.
 *
 * @param jobs - All jobs.
 * @param row - The PR shape.
 * @returns `[gate, E2E mocked, Integration]`.
 */
function resultsOf(jobs: Jobs, row: IRow): readonly string[] {
  const gate = gateResult(jobs, row);
  const heavy = HEAVY_JOBS.map((key): string => {
    const job = jobOf(jobs, key);
    return heavyResult(job, row, gate);
  });
  return [gate, ...heavy];
}

/**
 * The truth table the jobs produce.
 *
 * @param jobs - All jobs.
 * @returns Results by row name.
 */
function truthTable(jobs: Jobs): Readonly<Record<string, readonly string[]>> {
  const rows = ROWS.map(row => [row.name, resultsOf(jobs, row)] as const);
  return Object.fromEntries(rows);
}

const JOBS = prJobs();

/**
 * A copy of the jobs with one job patched.
 *
 * @param jobs - All jobs.
 * @param key - The job to patch.
 * @param patch - The fields to replace.
 * @returns The patched copy.
 */
function withJob(jobs: Jobs, key: string, patch: IJob): Jobs {
  const job = jobOf(jobs, key);
  return { ...jobs, [key]: { ...job, ...patch } };
}

/**
 * The gate's steps, each under another condition.
 *
 * @param condition - The new step `if:`.
 * @returns A patch for the gate job.
 */
function stepsUnder(condition: string): IJob {
  const steps = gateSteps(JOBS).map(step => ({ ...step, if: condition }));
  return { steps };
}

/**
 * A heavy job's `if:`, behind a status function.
 *
 * @param key - The heavy job.
 * @param prefix - The status-function conjunct, e.g. `!cancelled()`.
 * @returns A patch for that job.
 */
function ifBehind(key: string, prefix: string): IJob {
  const condition = jobOf(JOBS, key).if ?? NO_IF;
  return { if: `${prefix} && (${condition})` };
}

/** Wiring mistakes the truth table must catch: `[name, job, patch]`. */
const MUTANTS: readonly (readonly [string, string, IJob])[] = [
  ['E2E mocked opts out with !cancelled()', 'e2e-mocked', ifBehind('e2e-mocked', '!cancelled()')],
  ['Integration runs under always()', 'integration', ifBehind('integration', 'always()')],
  ['E2E mocked stops needing the gate', 'e2e-mocked', { needs: [ROOT] }],
  ['Integration stops needing the gate', 'integration', { needs: [ROOT] }],
  ['the gate is job-gated on critical_deps', GATE, { if: STEP_IF }],
  ['the checks run on every PR', GATE, stepsUnder('true')],
  ['the checks key on full_suite', GATE, stepsUnder("needs.changes.outputs.full_suite == 'true'")],
];

/**
 * Whether a node is a call to the named function.
 *
 * @param node - Any node.
 * @param name - Function name as written at the call.
 * @returns True for `name(...)`.
 */
function isCallTo(node: ts.Node, name: string): node is ts.CallExpression {
  return ts.isCallExpression(node) && node.expression.getText() === name;
}

/**
 * Whether a node or any descendant calls the named function.
 *
 * @param node - Root node.
 * @param name - Function name as written at the call.
 * @returns True when some call in the subtree is to `name`.
 */
function callsWithin(node: ts.Node, name: string): boolean {
  if (isCallTo(node, name)) return true;
  return node.getChildren().some((child): boolean => callsWithin(child, name));
}

/**
 * Whether a hook's setup function launches the shared browser.
 *
 * @param hook - A `beforeAll(...)` call.
 * @returns True when its first argument calls {@link SHARED_LAUNCH}.
 */
function launchesShared(hook: ts.CallExpression): boolean {
  const setup = hook.arguments.at(0);
  return setup !== undefined && callsWithin(setup, SHARED_LAUNCH);
}

/**
 * The bound a hook passes Jest, as written, following a top-level `const`
 * to its initializer.
 *
 * @param hook - A `beforeAll(...)` call.
 * @param consts - Top-level `const` initializers by name.
 * @returns The bound's source text; empty when the hook passes none.
 */
function boundOf(hook: ts.CallExpression, consts: ReadonlyMap<string, string>): string {
  const bound = hook.arguments.at(1);
  if (bound === undefined) return '';
  const text = bound.getText();
  return consts.get(text) ?? text;
}

/**
 * Whether a top-level variable statement declares with `const`.
 *
 * @param statement - A variable statement.
 * @returns True for `const`, false for `let` and `var`.
 */
function isConstStatement(statement: ts.VariableStatement): boolean {
  return statement.declarationList.getFirstToken()?.kind === ts.SyntaxKind.ConstKeyword;
}

/**
 * The initializer of every top-level `const`, by name, as written.
 *
 * @param file - Parsed source.
 * @returns Initializer source text by declared name.
 */
function constInitializers(file: ts.SourceFile): ReadonlyMap<string, string> {
  const statements = file.statements.filter(ts.isVariableStatement).filter(isConstStatement);
  const declarations = statements.flatMap(s => [...s.declarationList.declarations]);
  const entries = declarations.map((d): readonly [string, string] => {
    return [d.name.getText(), d.initializer?.getText() ?? ''];
  });
  return new Map(entries);
}

/**
 * The bounds of every top-level `beforeAll` that launches the shared browser,
 * read from the syntax tree so comments and strings cannot stand in for them.
 *
 * @param source - Jest file source.
 * @returns One bound per launching hook, in source order.
 */
function launchHookBounds(source: string): readonly string[] {
  const file = ts.createSourceFile('contract.ts', source, ts.ScriptTarget.Latest, true);
  const consts = constInitializers(file);
  const calls = file.statements.filter(ts.isExpressionStatement).map(s => s.expression);
  const hooks = calls.filter((call): call is ts.CallExpression => isCallTo(call, SETUP_HOOK));
  return hooks.filter(launchesShared).map(hook => boundOf(hook, consts));
}

describe('BrowserStackGateWiring', () => {
  it('[BSW-1] needs only changes, has no job-level if and reads only the repository', () => {
    const job = jobOf(JOBS, GATE);
    const needs = needsOf(job);
    expect(needs).toStrictEqual([ROOT]);
    expect(job).not.toHaveProperty('if');
    expect(job.permissions).toStrictEqual({ contents: 'read' });
  });

  it('[BSW-2] checks out without credentials, installs without scripts, then checks', () => {
    const steps = gateSteps(JOBS);
    const signatures = steps.map(signatureOf);
    const [checkout, setup] = steps;
    expect(signatures).toStrictEqual(EXPECTED_STEPS);
    expect(checkout.with?.['persist-credentials']).toBe(false);
    expect(setup.with?.['node-version-file']).toBe('.nvmrc');
  });

  it('[BSW-3] runs every step only when critical_deps is true', () => {
    const steps = gateSteps(JOBS);
    const conditions = steps.map(step => step.if);
    expect(steps).toHaveLength(EXPECTED_STEPS.length);
    expect(new Set(conditions)).toStrictEqual(new Set([STEP_IF]));
  });

  it.each([...HEAVY_JOBS, 'validate'])('[BSW-4] %s needs the gate', key => {
    const job = jobOf(JOBS, key);
    const needs = needsOf(job);
    expect(needs).toContain(GATE);
    expect(needs).toContain(ROOT);
  });

  it('[BSW-5] the real conditions give the modelled truth table', () => {
    const table = truthTable(JOBS);
    expect(table).toStrictEqual(EXPECTED_TABLE);
  });

  it.each(MUTANTS)('[BSW-6] catches the mutant: %s', (_name, key, patch) => {
    const mutated = withJob(JOBS, key, patch);
    const table = truthTable(mutated);
    expect(mutated).not.toStrictEqual(JOBS);
    expect(table).not.toStrictEqual(EXPECTED_TABLE);
  });

  it('[BSW-7] the commands it runs exist', () => {
    const pkgPath = join(REPO_ROOT, 'package.json');
    const pkgText = readFileSync(pkgPath, 'utf8');
    const { scripts } = JSON.parse(pkgText) as { readonly scripts: Record<string, string> };
    const patcherPath = join(REPO_ROOT, PATCHER);
    const patcher = readFileSync(patcherPath, 'utf8');
    expect(scripts[CHECK_SCRIPT]).toBe('node scripts/check-browser-stack.mjs');
    expect(patcher).toContain("const STRICT_FLAG = '--strict';");
  });

  it('[BSW-8] E2E mocked runs the runtime contract alone before the full suite', () => {
    const job = jobOf(JOBS, 'e2e-mocked');
    const runSteps = (job.steps ?? []).filter(step => step.run !== undefined);
    const runs = runSteps.map(signatureOf);
    const contractKeys = Object.keys(runSteps[0] ?? {});
    const contractPath = join(REPO_ROOT, CONTRACT_TEST);
    const isContractPresent = existsSync(contractPath);
    expect(runs).toStrictEqual(E2E_MOCKED_RUNS);
    expect(contractKeys).toStrictEqual(['name', 'run']);
    expect(isContractPresent).toBe(true);
  });

  it('[BSW-9] the contract launches in one hook bounded by the shared bound', () => {
    const contractPath = join(REPO_ROOT, CONTRACT_TEST);
    const contract = readFileSync(contractPath, 'utf8');
    const bounds = launchHookBounds(contract);
    expect(bounds).toStrictEqual(['firstLaunchHookTimeoutMs()']);
  });

  it('[BSW-9] reads the bound the hook passes, not text in a comment', () => {
    const bounds = launchHookBounds(PLANTED_COMMENT_BOUND);
    expect(bounds).toStrictEqual(['1']);
  });

  it.each(LAUNCH_BOUNDS)(
    '[BSW-9] the shared bound outlasts %s launch bound',
    (_label, value, launcherMs) => {
      const ambient = captureEnvVar(CAMOUFOX_LAUNCH_TIMEOUT_ENV);
      restoreEnvVar({ name: CAMOUFOX_LAUNCH_TIMEOUT_ENV, value });
      const appliedMs = resolveLaunchTimeoutMs();
      const hookMs = firstLaunchHookTimeoutMs();
      restoreEnvVar(ambient);
      expect(appliedMs).toBe(launcherMs);
      expect(hookMs).toBeGreaterThan(launcherMs);
    },
  );
});
