/**
 * Consumer-install gate wiring test.
 *
 * <p>Issue #552 shipped two defects that every existing CI job was
 * structurally incapable of seeing: the published package resolved a
 * devDependency at runtime, and the pipeline abandoned its own scrape.
 * Both need a production install and an unset `CI` to appear, and no
 * job that runs from the working tree can provide either.
 *
 * <p>`.github/scripts/ci/consumer-install.sh` closes that hole. This
 * test pins the four properties that make it a real gate rather than a
 * decorative step — because each one can be removed by a well-meaning
 * edit without anything else going red:
 *
 * <ul>
 *   <li>the job is wired into the `Validate` aggregator, so it can block a merge;</li>
 *   <li>it installs without devDependencies, or `pino-pretty` resolves and the gate is vacuous;</li>
 *   <li>it runs with `CI`/`NODE_ENV` unset, the one environment CI cannot otherwise reach;</li>
 *   <li>the consumer program holds no timer of its own, or it would mask the abandonment defect.</li>
 * </ul>
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

const THIS_FILE_PATH = fileURLToPath(import.meta.url);
const THIS_DIR = dirname(THIS_FILE_PATH);
const REPO_ROOT = join(THIS_DIR, '../../../../../');
const PR_YAML = join(REPO_ROOT, '.github/workflows/pr.yml');
const GATE_SCRIPT = join(REPO_ROOT, '.github/scripts/ci/consumer-install.sh');
const SMOKE_PROGRAM = join(REPO_ROOT, '.github/scripts/ci/consumer-smoke.cjs');

/** YAML job key the workflow uses for the gate. */
const GATE_JOB_KEY = 'consumer-install';

/** Aggregator whose `needs` list decides what can block a merge. */
const VALIDATE_JOB_KEY = 'validate';

/** Job-level shape this test reads — everything else is irrelevant. */
interface IWorkflowJob {
  readonly needs?: readonly string[] | string;
  readonly steps?: readonly { readonly run?: string }[];
}

interface IWorkflowDoc {
  readonly jobs?: Readonly<Record<string, IWorkflowJob>>;
}

/**
 * Parse the pull-request workflow.
 *
 * @returns Parsed workflow document.
 */
function loadWorkflow(): IWorkflowDoc {
  const raw = readFileSync(PR_YAML, 'utf8');
  return parse(raw) as IWorkflowDoc;
}

/**
 * Read a repository file as text.
 *
 * @param path - Absolute path to read.
 * @returns File contents.
 */
function readText(path: string): string {
  return readFileSync(path, 'utf8');
}

/**
 * Normalise a job's `needs` clause, which YAML allows as a scalar or a list.
 *
 * @param doc - Parsed workflow document.
 * @param jobKey - YAML job key to inspect.
 * @returns Job keys the named job depends on.
 */
function needsOf(doc: IWorkflowDoc, jobKey: string): readonly string[] {
  const needs = doc.jobs?.[jobKey]?.needs;
  if (typeof needs === 'string') return [needs];
  return needs ?? [];
}

describe('consumer-install CI gate', () => {
  it('[CIG-1] pr.yml defines the gate as a job', () => {
    const doc = loadWorkflow();
    const jobKeys = Object.keys(doc.jobs ?? {});
    expect(jobKeys).toContain(GATE_JOB_KEY);
  });

  it('[CIG-2] the Validate aggregator blocks on the gate', () => {
    const doc = loadWorkflow();
    const validateNeeds = needsOf(doc, VALIDATE_JOB_KEY);
    expect(validateNeeds).toContain(GATE_JOB_KEY);
  });

  it('[CIG-3] installs without devDependencies, so pino-pretty cannot resolve', () => {
    const script = readText(GATE_SCRIPT);
    expect(script).toContain('--omit=dev');
  });

  it('[CIG-4] runs the consumer program with CI and NODE_ENV unset', () => {
    const script = readText(GATE_SCRIPT);
    expect(script).toContain('-u CI -u NODE_ENV');
  });

  it('[CIG-5] treats a silent exit as a failure rather than as no output', () => {
    const script = readText(GATE_SCRIPT);
    expect(script).toContain('the scrape never settled');
  });

  it('[CIG-6] the consumer program holds no timer that would mask abandonment', () => {
    const smoke = readText(SMOKE_PROGRAM);
    const hasKeepalive = smoke.includes('setInterval') || smoke.includes('setTimeout');
    expect(hasKeepalive).toBe(false);
  });

  it('[CIG-7] the consumer program reads no environment, so no real credential can leak in', () => {
    const smoke = readText(SMOKE_PROGRAM);
    expect(smoke).not.toContain('process.env');
  });
});
