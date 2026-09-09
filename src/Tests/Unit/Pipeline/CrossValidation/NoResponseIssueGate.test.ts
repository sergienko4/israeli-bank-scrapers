/**
 * No-response issue-triage wiring test.
 *
 * <p>Issues that ask the reporter for evidence and never get an answer
 * accumulate forever. This lane closes them: a maintainer applies
 * `needs-info`, and if the reporter stays silent for seven days the issue is
 * closed as `not_planned` and labelled `closed-no-response`.
 *
 * <p>`actions/stale` keys off `updated_at`, so it knows only that an issue is
 * quiet — never *whose* turn it is. The label is therefore the state machine:
 * the clock runs only while `needs-info` is present. That has two consequences
 * this test exists to pin, because both fail silently and invisibly:
 *
 * <ul>
 *   <li>Something must remove the label the moment the reporter answers.
 *       `labels-to-remove-when-unstale` fires only for an issue that was
 *       already marked stale, so it does not cover a reply inside the first
 *       seven days. Without the companion workflow, an issue the reporter
 *       *did* answer still gets closed.</li>
 *   <li>The lane must not share the `Stale` label with the pre-existing
 *       60-day inactivity job in the same file, or the two fight over one
 *       marker.</li>
 * </ul>
 *
 * <p>"Close at seven days with no warning" is expressed as a seven-day stale
 * window plus a zero-day close window. That is not a guess: `_markStale` sets
 * `issue.updated_at = new Date().toString()` before the close check, and
 * `Date.toString()` keeps only whole seconds, so the elapsed value the check
 * sees is 1-999 ms and never satisfies `<= 0`. The issue closes in the same
 * run. A close window of 1 would instead defer closure by a day.
 *
 * <p>Omitting `stale-issue-message` would disable the lane outright rather
 * than merely silence it — `actions/stale` documents that with no message it
 * "will not mark issues stale" — so its presence is asserted too.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

const THIS_FILE_PATH = fileURLToPath(import.meta.url);
const THIS_DIR = dirname(THIS_FILE_PATH);
const REPO_ROOT = join(THIS_DIR, '../../../../../');
const STALE_YAML = join(REPO_ROOT, '.github/workflows/stale.yml');
const CLEAR_YAML = join(REPO_ROOT, '.github/workflows/issue-needs-info-clear.yml');

/** Job running the seven-day, label-scoped lane. */
const NO_RESPONSE_JOB_KEY = 'no-response';

/** Job running the pre-existing 60-day inactivity policy. */
const GENERIC_JOB_KEY = 'stale';

/** Label a maintainer applies to start the clock. */
const NEEDS_INFO_LABEL = 'needs-info';

/** Label recording why the issue was closed. */
const CLOSED_LABEL = 'closed-no-response';

/** Days of silence tolerated before the issue closes. */
const DAYS_BEFORE_STALE = 7;

/**
 * Close window. Zero closes in the same run the issue is marked, which is
 * what "no warning period" means for a mark-then-close processor.
 */
const DAYS_BEFORE_CLOSE = 0;

/** Sentinel disabling a timer entirely. This lane never touches PRs. */
const DISABLED = -1;

/** Timings of the pre-existing general-inactivity lane, asserted unchanged. */
const GENERIC_DAYS_BEFORE_STALE = 60;
const GENERIC_DAYS_BEFORE_CLOSE = 14;

/**
 * Interpolations that would splice attacker-controlled text into the shell.
 * `issue_comment` is reachable by anyone on a public repository and the job
 * holds `issues: write`, so a title or comment body reaching `run:` would be
 * a template-injection foothold.
 */
const UNSAFE_INTERPOLATION =
  /\$\{\{\s*github\.event\.(?:issue\.(?:title|body)|comment\.(?:body|user))/;

interface IWorkflowStep {
  readonly uses?: string;
  readonly run?: string;
  readonly with?: Readonly<Record<string, string | number | boolean>>;
}

interface IWorkflowJob {
  readonly needs?: string | readonly string[];
  readonly if?: string;
  readonly permissions?: Readonly<Record<string, string>>;
  readonly steps?: readonly IWorkflowStep[];
}

interface IWorkflowTriggers {
  readonly issue_comment?: { readonly types?: readonly string[] };
}

interface IWorkflowDoc {
  readonly on?: IWorkflowTriggers;
  readonly jobs?: Readonly<Record<string, IWorkflowJob>>;
}

/**
 * Parse a workflow file.
 *
 * @param path - Absolute path to the workflow.
 * @returns Parsed workflow document, or an empty document when absent.
 */
function loadWorkflow(path: string): IWorkflowDoc {
  if (!existsSync(path)) {
    return {};
  }
  const raw = readFileSync(path, 'utf8');
  return parse(raw) as IWorkflowDoc;
}

/**
 * A job from the staleness workflow.
 *
 * @param key - Job key to read.
 * @returns The job, or an empty job when it no longer exists.
 */
function staleJob(key: string): IWorkflowJob {
  const doc = loadWorkflow(STALE_YAML);
  return doc.jobs?.[key] ?? {};
}

/**
 * The `actions/stale` step of a job.
 *
 * @param key - Job key to read.
 * @returns The step, or an empty step when the job no longer uses the action.
 */
function staleStep(key: string): IWorkflowStep {
  const job = staleJob(key);
  const steps = job.steps ?? [];
  return steps.find(item => item.uses?.startsWith('actions/stale@') === true) ?? {};
}

/**
 * One input handed to `actions/stale`, as a trimmed string.
 *
 * @param key - Job key to read.
 * @param name - Input name.
 * @returns The input rendered as a string, or an empty string when unset.
 */
function inputOf(key: string, name: string): string {
  const step = staleStep(key);
  const inputs = step.with ?? {};
  return String(inputs[name] ?? '').trim();
}

/**
 * One input of the no-response job.
 *
 * @param name - Input name.
 * @returns The input rendered as a string, or an empty string when unset.
 */
function input(name: string): string {
  return inputOf(NO_RESPONSE_JOB_KEY, name);
}

/**
 * The only job of the companion label-clearing workflow.
 *
 * @returns The job, or an empty job when the workflow is absent.
 */
function clearJob(): IWorkflowJob {
  const doc = loadWorkflow(CLEAR_YAML);
  const jobs = doc.jobs ?? {};
  return Object.values(jobs)[0] ?? {};
}

/**
 * Guard expression of the companion label-clearing job.
 *
 * @returns The job's `if` condition, whitespace collapsed.
 */
function clearCondition(): string {
  const job = clearJob();
  const condition = job.if ?? '';
  return condition.replace(/\s+/g, ' ').trim();
}

describe('No-response issue triage', () => {
  it('[NRI-1] scopes the lane to the needs-info label', () => {
    const labels = input('only-issue-labels');
    expect(labels).toBe(NEEDS_INFO_LABEL);
  });

  it('[NRI-2] waits seven days before acting', () => {
    const raw = input('days-before-issue-stale');
    const days = Number(raw);
    expect(days).toBe(DAYS_BEFORE_STALE);
  });

  it('[NRI-3] closes in the same run, giving no warning period', () => {
    const raw = input('days-before-issue-close');
    const days = Number(raw);
    expect(days).toBe(DAYS_BEFORE_CLOSE);
  });

  it('[NRI-4] closes as not planned, so it never reads as fixed', () => {
    const reason = input('close-issue-reason');
    expect(reason).toBe('not_planned');
  });

  it('[NRI-5] never touches pull requests', () => {
    const staleRaw = input('days-before-pr-stale');
    const closeRaw = input('days-before-pr-close');
    const stale = Number(staleRaw);
    const close = Number(closeRaw);
    expect(stale).toBe(DISABLED);
    expect(close).toBe(DISABLED);
  });

  it('[NRI-6] labels the closure so it stays auditable', () => {
    const label = input('stale-issue-label');
    expect(label).toBe(CLOSED_LABEL);
  });

  it('[NRI-7] does not share a label with the 60-day lane', () => {
    const generic = inputOf(GENERIC_JOB_KEY, 'stale-issue-label') || 'Stale';
    const fast = input('stale-issue-label');
    expect(fast).not.toBe(generic);
  });

  it('[NRI-8] clears the waiting label as it closes', () => {
    const removed = input('labels-to-remove-when-stale');
    expect(removed).toContain(NEEDS_INFO_LABEL);
  });

  /*
   * The seven days must be counted from the moment the label went on, not from
   * the moment the issue was opened. `ignore-issue-updates` swaps the reference
   * date to `created_at` (actions/stale v11 `issues-processor.ts`), so enabling
   * it would close every issue older than a week the instant it is labelled,
   * giving the reporter no time at all. Labelling bumps `updated_at`, which is
   * exactly the clock we want, so this option must stay off.
   */
  it('[NRI-9] counts the reporter deadline from the label, not the open date', () => {
    const ignore = input('ignore-issue-updates');
    expect(ignore).not.toBe('true');
  });

  it('[NRI-10] carries a stale message, without which it would never mark', () => {
    const message = input('stale-issue-message');
    expect(message.length).toBeGreaterThan(0);
  });

  it('[NRI-11] honours the not-stale escape hatch', () => {
    const exempt = input('exempt-issue-labels');
    expect(exempt).toContain('not-stale');
  });

  it('[NRI-12] pins the action by commit, matching the 60-day lane', () => {
    const fast = staleStep(NO_RESPONSE_JOB_KEY);
    const generic = staleStep(GENERIC_JOB_KEY);
    expect(fast.uses).toMatch(/^actions\/stale@[0-9a-f]{40}\b/);
    expect(fast.uses).toBe(generic.uses);
  });

  it('[NRI-13] runs after the 60-day lane so the two cannot race', () => {
    const job = staleJob(NO_RESPONSE_JOB_KEY);
    const needs = [job.needs ?? []].flat();
    expect(needs).toContain(GENERIC_JOB_KEY);
  });

  it('[NRI-14] asks only for permission to write issues', () => {
    const job = staleJob(NO_RESPONSE_JOB_KEY);
    expect(job.permissions).toEqual({ issues: 'write' });
  });

  it('[NRI-15] leaves the 60-day lane on its own timings', () => {
    const staleRaw = inputOf(GENERIC_JOB_KEY, 'days-before-stale');
    const closeRaw = inputOf(GENERIC_JOB_KEY, 'days-before-close');
    const stale = Number(staleRaw);
    const close = Number(closeRaw);
    expect(stale).toBe(GENERIC_DAYS_BEFORE_STALE);
    expect(close).toBe(GENERIC_DAYS_BEFORE_CLOSE);
  });
});

describe('Clearing the waiting label when the reporter replies', () => {
  it('[NRI-16] reacts to new comments', () => {
    const doc = loadWorkflow(CLEAR_YAML);
    const types = doc.on?.issue_comment?.types ?? [];
    expect(types).toContain('created');
  });

  it('[NRI-17] ignores pull-request comments, which share the event', () => {
    const condition = clearCondition();
    expect(condition).toContain('github.event.issue.pull_request == null');
  });

  it('[NRI-18] acts only when the commenter is the reporter', () => {
    const condition = clearCondition();
    expect(condition).toContain('github.event.comment.user.login');
    expect(condition).toContain('github.event.issue.user.login');
  });

  it('[NRI-19] acts only on issues actually awaiting a reply', () => {
    const condition = clearCondition();
    expect(condition).toContain(NEEDS_INFO_LABEL);
  });

  it('[NRI-20] asks only for permission to write issues', () => {
    const job = clearJob();
    expect(job.permissions).toEqual({ issues: 'write' });
  });

  it('[NRI-21] keeps attacker-controlled text out of the shell', () => {
    const job = clearJob();
    const steps = job.steps ?? [];
    const runs = steps.map(step => step.run ?? '');
    const hasUnsafe = runs.some(run => UNSAFE_INTERPOLATION.test(run));
    expect(hasUnsafe).toBe(false);
  });
});
