import { parseAudit, requireAudit, SEVERITIES } from './input.mjs';

export const AUDIT_MARKER = '<!-- npm-dependency-audit:v1 -->';
const MAX_BODY_BYTES = 60_000;
const DOCUMENTATION =
  'https://github.com/sergienko4/israeli-bank-scrapers/blob/main/docs/workflow/code-scanning.md';
const DEPENDABOT = 'https://github.com/sergienko4/israeli-bank-scrapers/security/dependabot';

function fixText(fixes) {
  const values = [...fixes];
  if (values.every(fix => fix === false)) return 'No fix offered by npm';
  if (values.some(fix => fix === false)) return 'Fix unavailable for some affected paths';
  if (values.some(fix => typeof fix === 'object' && fix.isSemVerMajor)) {
    return 'Fix offered; major-version review required';
  }
  return 'Fix offered by npm; existing update bots handle remediation';
}

function advisoryRow(url, advisory, production) {
  const id = url.split('/').at(-1);
  const scope = production.advisories.has(url) ? 'production' : 'development-only';
  const packages = [...advisory.packages]
    .sort()
    .map(name => `\`${name}\``)
    .join(', ');
  return `| [${id}](${url}) | ${advisory.severity} | ${scope} | ${packages} | ${fixText(advisory.fixes)} |`;
}

function rows(all, production) {
  const entries = [...all.advisories.entries()].sort(
    ([a, left], [b, right]) =>
      SEVERITIES.indexOf(right.severity) - SEVERITIES.indexOf(left.severity) || a.localeCompare(b),
  );
  return entries.map(([url, advisory]) => advisoryRow(url, advisory, production));
}

const HEADER = [AUDIT_MARKER, '## npm dependency audit', ''];
const TABLE = [
  '| Advisory | Severity | Scope | Affected packages (including inherited) | npm remediation |',
  '|---|---|---|---|---|',
];
const FOOTER = [
  'Monitoring is not remediation. Dependabot handles security updates; Renovate maintains the lockfile.',
  'Advisories remain visible even when npm offers no fix or Scorecard accepts the risk.',
  `[Dependabot alerts](${DEPENDABOT}) · [Triage and accepted risks](${DOCUMENTATION})`,
];

function counts(all, production) {
  const total = all.advisories.size;
  const prod = production.advisories.size;
  return [
    `Affected package entries: **${all.names.size} all / ${production.names.size} production**.`,
    `Unique advisories: **${total} all / ${prod} production / ${total - prod} development-only**.`,
  ];
}

function reportLines(all, production) {
  const details =
    all.advisories.size === 0
      ? ['No known npm advisories in either verified scan.']
      : TABLE.concat(rows(all, production));
  return HEADER.concat(counts(all, production), '', details, '', FOOTER, '');
}

function requireSubset(all, production) {
  const namesMatch = [...production.names].every(name => all.names.has(name));
  const advisoriesMatch = [...production.advisories.keys()].every(url => all.advisories.has(url));
  requireAudit(namesMatch && advisoriesMatch, 'AUDIT_SCOPE');
}

/**
 * Reports validated all-dependency and production audits without suppressions.
 * @param {unknown} full - npm audit v2 JSON for the complete locked graph.
 * @param {unknown} productionOnly - npm audit v2 JSON omitting development dependencies.
 * @returns {{body: string, clean: boolean}} Bounded Markdown and verified clean status.
 * @throws {Error} Unsupported schemas, inconsistent scopes or oversized reports.
 */
export function buildAuditReport(full, productionOnly) {
  const all = parseAudit(full);
  const production = parseAudit(productionOnly);
  requireSubset(all, production);
  const body = reportLines(all, production).join('\n');
  requireAudit(Buffer.byteLength(body) <= MAX_BODY_BYTES, 'AUDIT_REPORT_TOO_LARGE');
  return { body, clean: all.advisories.size === 0 };
}
