import { spawnSync } from 'node:child_process';

import { parseAudit, requireAudit } from './input.mjs';
import { buildAuditReport } from './report.mjs';

const FLAGS = [
  'audit',
  '--package-lock-only',
  '--ignore-scripts',
  '--json',
  '--audit-level=info',
  '--include=optional',
  '--include=peer',
];
const AUDIT_LIMITS = { encoding: 'utf8', timeout: 120_000, maxBuffer: 8 * 1024 * 1024 };

function runNpm(args, limits) {
  const windows = process.platform === 'win32';
  return spawnSync(windows ? 'npm.cmd' : 'npm', args, { ...limits, shell: windows });
}

function auditResult(result) {
  requireAudit(!result.error && [0, 1].includes(result.status), 'AUDIT_COMMAND');
  const json = parseJson(result.stdout);
  const parsed = parseAudit(json);
  requireAudit(result.status === Number(parsed.names.size > 0), 'AUDIT_EXIT_STATUS');
  return json;
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('AUDIT_JSON');
  }
}

/**
 * Scans the committed graph without installing packages or executing lifecycle scripts.
 * @param {import('./scan.d.mts').AuditRunner} run - Bounded npm process boundary.
 * @returns {import('./report.d.mts').IAuditReport} Report after both scans validate.
 * @throws {Error} Failed processes, malformed JSON, invalid schemas or inconsistent scans.
 */
export function collectAuditReport(run = runNpm) {
  const all = auditResult(run([...FLAGS, '--include=dev'], AUDIT_LIMITS));
  const production = auditResult(run([...FLAGS, '--omit=dev'], AUDIT_LIMITS));
  return buildAuditReport(all, production);
}
