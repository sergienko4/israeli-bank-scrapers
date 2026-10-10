/**
 * Concurrency contract for the workflows that run on every PR push.
 *
 * <p>A push to a PR supersedes the runs of the previous head, so these
 * workflows cancel them. The group decides which runs count as "the same
 * PR". Keyed on `head_ref`, a fork reusing a branch name would cancel another
 * PR's required checks; keyed without the event name, a PR number could
 * equal a `run_id`; and a group string shared with another workflow would
 * cancel or deadlock that workflow too — including a `main-pipeline.yml`
 * call into `codeql.yml`.
 *
 * Rules:
 *   WCG-1  each PR workflow cancels superseded runs at the workflow level
 *   WCG-2  its group joins the same PR's runs and nothing else
 *   WCG-3  no concurrency group anywhere keys on `head_ref`
 *   WCG-4  no workflow-level group prefix is a prefix of another's
 *   WCG-5  no workflow calls a PR workflow twice — both calls would share
 *          the caller's `run_id` and the second would cancel the first
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

const THIS_FILE_URL = import.meta.url;
const THIS_FILE_PATH = fileURLToPath(THIS_FILE_URL);
const THIS_DIR = dirname(THIS_FILE_PATH);
const REPO_ROOT = join(THIS_DIR, '../../../../../');
const WORKFLOWS_DIR = join(REPO_ROOT, '.github/workflows');

/** `[workflow file, literal group prefix]` for every workflow a PR push starts. */
const PR_WORKFLOWS = [
  ['pr.yml', 'pr-validation-'],
  ['pr-title.yml', 'pr-title-'],
  ['pr-body-check.yml', 'pr-body-check-'],
  ['codeql.yml', 'codeql-'],
] as const;

/** Context paths a rendered group may read. */
type ContextPath = 'github.event_name' | 'github.event.pull_request.number' | 'github.run_id';

/** One run's context, flattened to the paths a group may read. */
type RunContext = Readonly<Record<ContextPath, string>>;

/** The paths `render` resolves; any other expression fails the suite. */
const CONTEXT_PATHS: readonly string[] = [
  'github.event_name',
  'github.event.pull_request.number',
  'github.run_id',
];

/**
 * Build one run's context.
 * @param event - `github.event_name`.
 * @param pr - The PR number, `''` when the run is not for a PR.
 * @param runId - `github.run_id`.
 * @returns The context.
 */
function runOf(event: string, pr: string, runId: string): RunContext {
  return {
    'github.event_name': event,
    'github.event.pull_request.number': pr,
    'github.run_id': runId,
  };
}

/** Two runs and whether Actions should treat them as one PR's runs. */
interface IPair {
  readonly label: string;
  readonly first: RunContext;
  readonly second: RunContext;
  readonly shouldShare: boolean;
}

/**
 * Build one scenario row.
 * @param label - Test label.
 * @param runs - The two runs.
 * @param shouldShare - Whether they belong in one group.
 * @returns The row.
 */
function pairOf(
  label: string,
  runs: readonly [RunContext, RunContext],
  shouldShare: boolean,
): IPair {
  return { label, first: runs[0], second: runs[1], shouldShare };
}

const PR_7_PUSH_1 = runOf('pull_request', '7', '101');
const PR_7_PUSH_2 = runOf('pull_request', '7', '102');
const PR_8_PUSH = runOf('pull_request', '8', '102');
const PR_42_PUSH = runOf('pull_request', '42', '101');
const MAIN_CALL_42 = runOf('push', '', '42');
const MAIN_CALL_201 = runOf('push', '', '201');
const MAIN_CALL_202 = runOf('push', '', '202');
const SCHEDULE_301 = runOf('schedule', '', '301');
const SCHEDULE_302 = runOf('schedule', '', '302');

const PAIRS: readonly IPair[] = [
  pairOf('two pushes to one PR', [PR_7_PUSH_1, PR_7_PUSH_2], true),
  pairOf('two PRs on one branch name', [PR_7_PUSH_1, PR_8_PUSH], false),
  pairOf('a PR number equal to a run id', [PR_42_PUSH, MAIN_CALL_42], false),
  pairOf('two main-pipeline calls', [MAIN_CALL_201, MAIN_CALL_202], false),
  pairOf('two scheduled runs', [SCHEDULE_301, SCHEDULE_302], false),
];

/** Concurrency fields this suite reads. */
interface IConcurrency {
  readonly group?: string;
  readonly 'cancel-in-progress'?: boolean;
}

/** Workflow fields this suite reads. */
interface IWorkflowDoc {
  readonly concurrency?: IConcurrency;
  readonly jobs?: Readonly<Record<string, IJobDoc>>;
}

/** Job fields this suite reads. */
interface IJobDoc {
  readonly concurrency?: IConcurrency;
  readonly uses?: string;
}

/**
 * Parse one workflow file.
 * @param file - File name under `.github/workflows`.
 * @returns The parsed document.
 */
function loadWorkflow(file: string): IWorkflowDoc {
  const path = join(WORKFLOWS_DIR, file);
  const text = readFileSync(path, 'utf8');
  return parse(text) as IWorkflowDoc;
}

/**
 * Every workflow file name.
 * @returns The `.yml` / `.yaml` files under `.github/workflows`.
 */
function workflowFiles(): readonly string[] {
  const names = readdirSync(WORKFLOWS_DIR);
  return names.filter((name): boolean => /\.ya?ml$/u.test(name)).sort();
}

/**
 * Evaluate one `a || b` expression against a run.
 * @param expression - The text inside `${{ }}`.
 * @param run - The run's context.
 * @returns The first non-empty operand; throws on any path it does not model.
 */
function evaluate(expression: string, run: RunContext): string {
  const operands = expression.split('||').map((operand): string => operand.trim());
  const unknown = operands.filter((operand): boolean => !CONTEXT_PATHS.includes(operand));
  if (unknown.length > 0) throw new RangeError(`unmodelled expression: ${unknown.join(', ')}`);
  const values = operands.map((operand): string => run[operand as ContextPath]);
  return values.find((value): boolean => value !== '') ?? '';
}

/**
 * Render a group the way Actions would for one run.
 * @param group - The `concurrency.group` template.
 * @param run - The run's context.
 * @returns The group name.
 */
function render(group: string, run: RunContext): string {
  return group.replace(/\$\{\{(.*?)\}\}/gu, (_match, expression: string): string =>
    evaluate(expression, run),
  );
}

/**
 * Every concurrency group in a workflow, workflow-level and job-level.
 * @param file - Workflow file name.
 * @returns `file: group` rows.
 */
function groupsIn(file: string): readonly string[] {
  const doc = loadWorkflow(file);
  const jobs = Object.values(doc.jobs ?? {});
  const jobGroups = jobs.map((job): string => job.concurrency?.group ?? '');
  const groups = [doc.concurrency?.group ?? '', ...jobGroups];
  return groups
    .filter((group): boolean => group !== '')
    .map((group): string => `${file}: ${group}`);
}

/**
 * The literal text before the first expression in each workflow-level group.
 * @returns `[file, prefix]` rows for every workflow that declares one.
 */
function workflowPrefixes(): readonly (readonly [string, string])[] {
  return workflowFiles().flatMap((file): (readonly [string, string])[] => {
    const group = loadWorkflow(file).concurrency?.group ?? '';
    if (group === '') return [];
    const prefix = group.split('${{')[0];
    return [[file, prefix]];
  });
}

/**
 * Every PR workflow a caller invokes more than once.
 * @param file - Caller workflow file name.
 * @returns `file: callee ×N` rows.
 */
function repeatedCalls(file: string): readonly string[] {
  const jobs = Object.values(loadWorkflow(file).jobs ?? {});
  const callees = jobs.map((job): string => job.uses ?? '');
  return PR_WORKFLOWS.flatMap(([callee]): string[] => {
    const count = callees.filter((uses): boolean => uses.endsWith(`/${callee}`)).length;
    return count > 1 ? [`${file}: ${callee} ×${String(count)}`] : [];
  });
}

describe('WorkflowConcurrencyGate', () => {
  it.each(PR_WORKFLOWS)('[WCG-1] %s_ShouldCancelSupersededRuns', (file, prefix) => {
    const concurrency = loadWorkflow(file).concurrency ?? {};
    const group = concurrency.group ?? '';
    const hasPrefix = group.startsWith(prefix);
    expect(concurrency['cancel-in-progress']).toBe(true);
    expect(hasPrefix).toBe(true);
  });

  describe.each(PR_WORKFLOWS)('[WCG-2] %s group', file => {
    it.each(PAIRS)('$label', ({ first, second, shouldShare }) => {
      const group = loadWorkflow(file).concurrency?.group ?? '';
      const firstGroup = render(group, first);
      const secondGroup = render(group, second);
      expect(firstGroup === secondGroup).toBe(shouldShare);
    });
  });

  it('[WCG-3] NoConcurrencyGroup_ShouldKeyOnHeadRef', () => {
    const groups = workflowFiles().flatMap((file): readonly string[] => groupsIn(file));
    const onHeadRef = groups.filter((row): boolean => row.includes('head_ref'));
    expect(groups.length).toBeGreaterThan(0);
    expect(onHeadRef).toEqual([]);
  });

  it('[WCG-4] WorkflowLevelPrefixes_ShouldNotOverlap', () => {
    const prefixes = workflowPrefixes();
    const overlaps = prefixes.flatMap(([file, prefix]): string[] => {
      const others = prefixes.filter(([other]): boolean => other !== file);
      const clashing = others.filter(([, otherPrefix]): boolean => otherPrefix.startsWith(prefix));
      return clashing.map(([other]): string => `${file} ⊂ ${other}`);
    });
    expect(prefixes.length).toBeGreaterThanOrEqual(PR_WORKFLOWS.length);
    expect(overlaps).toEqual([]);
  });

  it('[WCG-5] PrWorkflows_ShouldBeCalledAtMostOncePerCaller', () => {
    const repeats = workflowFiles().flatMap((file): readonly string[] => repeatedCalls(file));
    expect(repeats).toEqual([]);
  });
});
