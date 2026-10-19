/** npm audit v2 fixtures: one advisory inherited through three tooling packages. */
export const AUDIT_URL = 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm';

interface IVulnerability {
  name: string;
  severity: string;
  via: (string | { url: string; severity: string })[];
  fixAvailable: boolean | { name: string; version: string; isSemVerMajor: boolean };
}

export interface IAuditFixture {
  auditReportVersion: number;
  vulnerabilities: Record<string, IVulnerability>;
  metadata: { vulnerabilities: Record<string, number> };
}

/**
 * Builds an isolated clean audit report.
 * @returns A fresh, clean audit report.
 */
export function cleanAudit(): IAuditFixture {
  return {
    auditReportVersion: 2,
    vulnerabilities: {},
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 } },
  };
}

/**
 * Describes one vulnerable package.
 * @param name Affected package.
 * @param via Advisory or inherited reference.
 * @returns A vulnerable-package entry.
 */
function affected(name: string, via: IVulnerability['via']): IVulnerability {
  return { name, severity: 'high', via, fixAvailable: false };
}

/**
 * Builds the inherited tooling advisory graph.
 * @returns Three affected packages representing one advisory.
 */
export function toolingAudit(): IAuditFixture {
  const report = cleanAudit();
  report.vulnerabilities.braces = affected('braces', [{ url: AUDIT_URL, severity: 'high' }]);
  report.vulnerabilities.micromatch = affected('micromatch', ['braces']);
  report.vulnerabilities['eslint-plugin-check-file'] = affected('eslint-plugin-check-file', [
    'micromatch',
  ]);
  report.metadata.vulnerabilities.high = 3;
  report.metadata.vulnerabilities.total = 3;
  return report;
}
