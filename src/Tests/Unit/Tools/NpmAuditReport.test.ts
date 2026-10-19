import { buildAuditReport } from '../../../../scripts/npm-audit/report.mjs';
import { AUDIT_URL, cleanAudit, toolingAudit } from '../../Helpers/NpmAuditFixtures.js';

/**
 * Builds the real report from isolated scenario inputs.
 * @param all Full graph.
 * @param production Production graph.
 * @returns Rendered report and clean state.
 */
function reportOf(
  all: unknown = toolingAudit(),
  production: unknown = cleanAudit(),
): ReturnType<typeof buildAuditReport> {
  return buildAuditReport(all, production);
}

const CLEAN = cleanAudit();

describe('npm advisory report', () => {
  it('[NAR-1] distinguishes inherited package counts from unique development advisories', () => {
    const report = reportOf();
    expect(report.clean).toBe(false);
    expect(report.body).toContain('Affected package entries: **3 all / 0 production**');
    expect(report.body).toContain(
      'Unique advisories: **1 all / 0 production / 1 development-only**',
    );
    const advisoryOccurrences = report.body.split(AUDIT_URL);
    expect(advisoryOccurrences).toHaveLength(2);
    expect(report.body).toContain('development-only');
    expect(report.body).toContain('No fix offered by npm');
  });

  it('[NAR-2] uses the production scan, not package flags, to classify scope', () => {
    const production = toolingAudit();
    const report = reportOf(undefined, production);
    expect(report.body).toContain('| production |');
    expect(report.body).toContain('**1 all / 1 production / 0 development-only**');
  });

  it('[NAR-3] reports verified clean only after both scans are clean', () => {
    const report = reportOf(CLEAN, CLEAN);
    expect(report.clean).toBe(true);
    expect(report.body).toContain('No known npm advisories');
  });

  it('[NAR-4] reports major-review fixes without executing them', () => {
    const all = toolingAudit();
    Object.values(all.vulnerabilities).forEach(entry => {
      entry.fixAvailable = { name: 'replacement', version: '2.0.0', isSemVerMajor: true };
    });
    const report = reportOf(all);
    expect(report.body).toContain('Fix offered; major-version review required');
  });

  it('[NAR-5] refuses production advisories absent from the full scan', () => {
    const production = toolingAudit();
    expect(() => reportOf(CLEAN, production)).toThrow('AUDIT_SCOPE');
  });

  it.each([
    null,
    { error: { code: 'ENOAUDIT' } },
    { ...cleanAudit(), auditReportVersion: 3 },
    { ...cleanAudit(), vulnerabilities: [] },
    { ...toolingAudit(), metadata: CLEAN.metadata },
  ])('[NAR-6] refuses malformed or unsupported data instead of reporting clean: %j', input => {
    expect(() => reportOf(input)).toThrow('AUDIT_SCHEMA');
  });

  it.each([
    'https://github.com.evil.invalid/advisories/GHSA-vfj7-8cjw-p6xm',
    `${AUDIT_URL}?injected=true`,
    `${AUDIT_URL}\n@maintainer`,
  ])('[NAR-7] refuses noncanonical advisory URLs: %s', url => {
    const all = toolingAudit();
    all.vulnerabilities.braces.via = [{ url, severity: 'high' }];
    expect(() => reportOf(all)).toThrow('AUDIT_SCHEMA');
  });

  it('[NAR-8] refuses missing references, cycles and invalid fix metadata', () => {
    const missing = toolingAudit();
    missing.vulnerabilities.braces.via = ['missing'];
    const cycle = toolingAudit();
    cycle.vulnerabilities.braces.via = ['micromatch'];
    const fix = toolingAudit();
    Reflect.deleteProperty(fix.vulnerabilities.braces, 'fixAvailable');
    for (const input of [missing, cycle, fix]) {
      expect(() => reportOf(input)).toThrow('AUDIT_SCHEMA');
    }
  });

  it.each([
    '<script>@maintainer</script> [click](https://evil.invalid)',
    '<SCRIPT>@maintainer</SCRIPT> [click](https://evil.invalid)',
  ])('[NAR-9] ignores untrusted advisory titles entirely: %s', title => {
    const all = toolingAudit();
    const expected = reportOf(all);
    const advisory = { url: AUDIT_URL, severity: 'high', title };
    all.vulnerabilities.braces.via = [advisory];
    const report = reportOf(all);
    expect(report).toEqual(expected);
  });

  it('[NAR-10] deduplicates repeated advisory objects across affected packages', () => {
    const all = toolingAudit();
    all.vulnerabilities.micromatch.via.push({ url: AUDIT_URL, severity: 'high' });
    const report = reportOf(all);
    const occurrences = report.body.split(AUDIT_URL);
    expect(occurrences).toHaveLength(2);
    expect(report.body).toContain('**1 all / 0 production / 1 development-only**');
  });

  it('[NAR-11] classifies individual advisories when one package has mixed scopes', () => {
    const all = toolingAudit();
    const production = toolingAudit();
    const second = 'https://github.com/advisories/GHSA-2345-6789-cfgh';
    all.vulnerabilities.braces.via.push({ url: second, severity: 'high' });
    const report = reportOf(all, production);
    expect(report.body).toContain('**2 all / 1 production / 1 development-only**');
    expect(report.body).toContain(`[GHSA-2345-6789-cfgh](${second}) | high | development-only |`);
  });
});
