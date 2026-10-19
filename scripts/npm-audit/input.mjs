export const SEVERITIES = ['info', 'low', 'moderate', 'high', 'critical'];
const PACKAGE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i;
const ADVISORY = /^https:\/\/github\.com\/advisories\/GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/;

export function requireAudit(condition, code = 'AUDIT_SCHEMA') {
  if (!condition) throw new Error(code);
}

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const packageName = value =>
  typeof value === 'string' && value.length <= 214 && value.trim() === value && PACKAGE.test(value);
const severity = value => SEVERITIES.includes(value);

function validFix(value) {
  if (typeof value === 'boolean') return true;
  return (
    record(value) &&
    packageName(value.name) &&
    typeof value.version === 'string' &&
    value.version.length > 0 &&
    typeof value.isSemVerMajor === 'boolean'
  );
}

function validateVia(via, entries) {
  if (typeof via === 'string') return requireAudit(Object.hasOwn(entries, via));
  requireAudit(record(via) && typeof via.url === 'string');
  requireAudit(via.url.trim() === via.url && ADVISORY.test(via.url) && severity(via.severity));
}

function validateEntry(name, entry, entries) {
  requireAudit(packageName(name) && record(entry) && entry.name === name);
  requireAudit(severity(entry.severity) && validFix(entry.fixAvailable));
  requireAudit(Array.isArray(entry.via) && entry.via.length > 0);
  entry.via.forEach(via => validateVia(via, entries));
}

function validateCounts(counts, entries) {
  requireAudit(record(counts));
  for (const key of [...SEVERITIES, 'total']) {
    requireAudit(Number.isSafeInteger(counts[key]) && counts[key] >= 0);
  }
  const values = Object.values(entries);
  requireAudit(counts.total === values.length);
  for (const key of SEVERITIES)
    requireAudit(counts[key] === values.filter(e => e.severity === key).length);
}

function advisoryUrls(name, state) {
  if (state.memo.has(name)) return state.memo.get(name);
  requireAudit(!state.active.has(name) && state.active.size < 100);
  state.active.add(name);
  const urls = state.entries[name].via.flatMap(via => referencedUrls(via, state));
  state.active.delete(name);
  state.memo.set(name, new Set(urls));
  return state.memo.get(name);
}

function referencedUrls(via, state) {
  return typeof via === 'string' ? [...advisoryUrls(via, state)] : [via.url];
}

function mergeAdvisory(result, via) {
  const previous = result.get(via.url);
  if (SEVERITIES.indexOf(previous?.severity) >= SEVERITIES.indexOf(via.severity)) return;
  result.set(via.url, { severity: via.severity, packages: new Set(), fixes: new Set() });
}

function directAdvisories(entries) {
  const direct = Object.values(entries)
    .flatMap(entry => entry.via)
    .filter(via => typeof via !== 'string');
  const result = new Map();
  direct.forEach(via => mergeAdvisory(result, via));
  return result;
}

function addAffected(advisories, urls, entry) {
  for (const url of urls) {
    advisories.get(url).packages.add(entry.name);
    advisories.get(url).fixes.add(entry.fixAvailable);
  }
}

function indexAdvisories(entries) {
  const advisories = directAdvisories(entries);
  const state = { entries, memo: new Map(), active: new Set() };
  for (const [name, entry] of Object.entries(entries)) {
    addAffected(advisories, advisoryUrls(name, state), entry);
  }
  return advisories;
}

/** Validates npm's v2 package graph before deriving any clean/reportable state. */
export function parseAudit(input) {
  requireAudit(record(input) && !Object.hasOwn(input, 'error') && input.auditReportVersion === 2);
  requireAudit(record(input.vulnerabilities) && record(input.metadata));
  const entries = input.vulnerabilities;
  Object.entries(entries).forEach(([name, entry]) => validateEntry(name, entry, entries));
  validateCounts(input.metadata.vulnerabilities, entries);
  return { names: new Set(Object.keys(entries)), advisories: indexAdvisories(entries) };
}
