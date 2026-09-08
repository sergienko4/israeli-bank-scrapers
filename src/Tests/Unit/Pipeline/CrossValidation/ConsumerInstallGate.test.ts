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

/** One property of the gate script that a single substring proves present. */
interface IGateScriptProperty {
  readonly id: string;
  readonly property: string;
  readonly needle: string;
}

/**
 * Properties whose absence would leave the gate running but vacuous. Each is
 * proved by one substring of the same script, so they belong in a single
 * parameterized test rather than in tests that differ only by a literal.
 */
const GATE_SCRIPT_PROPERTIES: readonly IGateScriptProperty[] = [
  {
    id: 'CIG-3',
    property: 'installs without devDependencies, so pino-pretty cannot resolve',
    needle: '--omit=dev',
  },
  {
    id: 'CIG-4',
    property: 'runs the consumer program with CI and NODE_ENV unset',
    needle: '-u CI -u NODE_ENV',
  },
  {
    id: 'CIG-5',
    property: 'treats a silent exit as a failure rather than as no output',
    needle: 'the scrape never settled',
  },
];

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

  it.each(GATE_SCRIPT_PROPERTIES)('[$id] $property', (row): void => {
    const script = readText(GATE_SCRIPT);
    expect(script).toContain(row.needle);
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

  /**
   * Accepting anything that merely settled would let an unrelated regression
   * inside the package report success — a TypeError on import settles too.
   * The gate has to name the outcome it expects.
   */
  it('[CIG-8] requires the expected environment failure, not merely any settled outcome', () => {
    const script = readText(GATE_SCRIPT);
    expect(script).toContain('EXPECTED_OUTCOME=');
    expect(script).toContain('assert_expected_outcome');
  });

  /**
   * A scrape reports failure by returning a result, so an exception reaching
   * the consumer is a defect. The smoke program has to surface that in its
   * exit status, and the gate has to read the status rather than discard it.
   */
  it('[CIG-9] fails the run when an exception escapes to the consumer', () => {
    const smoke = readText(SMOKE_PROGRAM);
    expect(smoke).toContain('process.exitCode = 1');
    const script = readText(GATE_SCRIPT);
    expect(script).toContain('an exception escaped to the consumer');
  });
});
