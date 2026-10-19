import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import {
  type AuditRunner,
  collectAuditReport,
  type IAuditLimits,
} from '../../../../scripts/npm-audit/scan.mjs';
import { cleanAudit, toolingAudit } from '../../Helpers/NpmAuditFixtures.js';
import { createTempRepo, writeTempFile } from '../../Helpers/TempRepoTree.js';

const CLEAN = cleanAudit();
const TOOLING = toolingAudit();
const CLEAN_JSON = JSON.stringify(CLEAN);
const TOOLING_JSON = JSON.stringify(TOOLING);

describe('npm audit process boundary', () => {
  it('[NAS-1] accepts exit 1 findings and forces complete versus production lockfile scopes', () => {
    const calls: string[][] = [];
    const bounds: IAuditLimits[] = [];
    /**
     * Answers based on the requested dependency scope.
     * @param args npm arguments.
     * @param limits Process limits.
     * @returns Recorded npm outcome.
     */
    const run: AuditRunner = (args, limits) => {
      calls.push(args);
      bounds.push(limits);
      const isProduction = args.includes('--omit=dev');
      return {
        status: isProduction ? 0 : 1,
        stdout: isProduction ? CLEAN_JSON : TOOLING_JSON,
      };
    };
    const report = collectAuditReport(run);
    expect(report.clean).toBe(false);
    const scopes = calls.map(args => args.at(-1));
    expect(scopes).toEqual(['--include=dev', '--omit=dev']);
    for (const args of calls) {
      expect(args).toContain('audit');
      expect(args).toContain('--package-lock-only');
      expect(args).toContain('--ignore-scripts');
      expect(args).toContain('--json');
      expect(args).toContain('--audit-level=info');
      expect(args).toContain('--include=optional');
      expect(args).toContain('--include=peer');
      expect(args).not.toContain('install');
      expect(args).not.toContain('fix');
    }
    expect(bounds).toEqual([
      { encoding: 'utf8', timeout: 120_000, maxBuffer: 8 * 1024 * 1024 },
      { encoding: 'utf8', timeout: 120_000, maxBuffer: 8 * 1024 * 1024 },
    ]);
  });

  it.each([
    { status: null, stdout: '', error: new Error('timeout') },
    { status: 2, stdout: CLEAN_JSON },
    { status: 1, stdout: '{"error":{"code":"ENOAUDIT"}}' },
    { status: 1, stdout: 'not JSON' },
    { status: 1, stdout: CLEAN_JSON },
    { status: 0, stdout: TOOLING_JSON },
  ])('[NAS-2] fails closed on command, schema, JSON or exit inconsistency: %j', result => {
    expect(() => collectAuditReport(() => result)).toThrow(/AUDIT_/u);
  });

  it('[NAS-3] rejects a second-scan outage rather than publishing the first result', () => {
    let calls = 0;
    /**
     * Returns a clean first scan then a registry outage.
     * @returns Simulated npm output.
     */
    const run: AuditRunner = () => ({
      status: 0,
      stdout: ++calls === 1 ? CLEAN_JSON : '',
    });
    expect(() => collectAuditReport(run)).toThrow('AUDIT_JSON');
  });

  it('[NAS-5] the real CLI writes a failure summary and preserves output on scan failure', () => {
    const root = createTempRepo();
    try {
      const out = writeTempFile(root, 'report.md', 'previous report');
      const summary = join(root, 'summary.md');
      const env = {
        ...process.env,
        GITHUB_STEP_SUMMARY: summary,
        GITHUB_OUTPUT: join(root, 'outputs'),
      };
      const cwd = process.cwd();
      const cli = join(cwd, 'scripts/npm-audit-watch.mjs');
      const result = spawnSync(process.execPath, [cli, '--out', out], {
        cwd: root,
        env,
        encoding: 'utf8',
        timeout: 30_000,
      });
      expect(result.status).toBe(2);
      const previous = readFileSync(out, 'utf8');
      const failure = readFileSync(summary, 'utf8');
      expect(previous).toBe('previous report');
      expect(failure).toContain('scan is unverified');
      expect(result.stdout).not.toContain('No known npm advisories');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
