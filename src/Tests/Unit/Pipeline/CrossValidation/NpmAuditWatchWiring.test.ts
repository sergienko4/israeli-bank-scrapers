import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parse } from 'yaml';

interface IStep {
  readonly id?: string;
  readonly uses?: string;
  readonly run?: string;
  readonly if?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly with?: Readonly<Record<string, unknown>>;
}
interface IWorkflow {
  readonly on: {
    readonly schedule: readonly { cron: string }[];
    readonly workflow_dispatch: { inputs: { audit_dry_run: { type: string; default: boolean } } };
  };
  readonly permissions: object;
  readonly jobs: Record<
    string,
    {
      readonly needs?: unknown;
      readonly if?: string;
      readonly concurrency?: object;
      readonly permissions?: object;
      readonly steps: readonly IStep[];
    }
  >;
}

const ROOT = process.cwd();
const WORKFLOW_PATH = join(ROOT, '.github/workflows/scorecard.yml');
const DETECTOR_PATH = join(ROOT, '.github/scripts/ci/detect-changes.sh');
const WORKFLOW_TEXT = readFileSync(WORKFLOW_PATH, 'utf8');
const WORKFLOW = parse(WORKFLOW_TEXT) as IWorkflow;

describe('npm advisory monitor wiring', () => {
  it('[NAW-1] reuses the existing weekly/manual schedule with dry-run by default', () => {
    const triggers = Object.keys(WORKFLOW.on).sort();
    expect(triggers).toEqual(['schedule', 'workflow_dispatch']);
    expect(WORKFLOW.on.schedule).toEqual([{ cron: '30 2 * * 1' }]);
    expect(WORKFLOW.on.workflow_dispatch.inputs.audit_dry_run).toMatchObject({
      type: 'boolean',
      default: true,
    });
  });

  it('[NAW-2] isolates issue writes and concurrency from Scorecard and SARIF', () => {
    const job = WORKFLOW.jobs['npm-audit'];
    expect(WORKFLOW.permissions).toEqual({});
    expect(job.permissions).toEqual({ contents: 'read', issues: 'write' });
    expect(job.needs).toBeUndefined();
    expect(job.concurrency).toEqual({ group: 'npm-dependency-audit', 'cancel-in-progress': false });
    expect(job.if).toContain('github.event.repository.default_branch');
    expect(WORKFLOW.jobs.analysis.needs).toBe('scorecard');
  });

  it('[NAW-3] installs nothing, gives the scanner no token, and never bypasses failure', () => {
    const steps = WORKFLOW.jobs['npm-audit'].steps;
    const [checkout, setup, scan, publish] = steps;
    expect(steps).toHaveLength(4);
    expect(checkout.with).toEqual({ 'persist-credentials': false });
    expect(setup.with).toEqual({ 'node-version-file': '.nvmrc' });
    expect(scan.run).toContain(
      'node scripts/npm-audit-watch.mjs --out "$RUNNER_TEMP/npm-audit.md"',
    );
    expect(scan.env).toBeUndefined();
    const serialized = JSON.stringify(steps);
    expect(serialized).not.toMatch(/npm (?:ci|install)|continue-on-error|\|\| true/u);
    expect(publish.if).toBe('${{ !inputs.audit_dry_run }}');
    expect(publish.env?.AUDIT_CLEAN).toBe('${{ steps.audit.outputs.clean }}');
    expect(publish.uses).toMatch(/^actions\/github-script@[a-f0-9]{40}$/u);
    expect(publish.with?.script).toContain('updateAuditIssue');
    expect(publish.with?.['github-token']).toBe('${{ github.token }}');
    expect(publish.with?.retries).toBe(0);
  });

  it('[NAW-4] script-only edits trigger CI wiring tests', () => {
    const detector = readFileSync(DETECTOR_PATH, 'utf8');
    const lines = detector.split('\n').filter(line => line.includes('ci_scripts=true; fi'));
    const ciDetection = lines.join('\n');
    expect(ciDetection).toContain('scripts/npm-audit');
  });
});
