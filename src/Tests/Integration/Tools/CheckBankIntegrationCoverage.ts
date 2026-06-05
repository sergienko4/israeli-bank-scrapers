#!/usr/bin/env tsx
/**
 * Bank integration-coverage gate.
 *
 * Walks every directory under `src/Scrapers/Pipeline/Banks/` and
 * verifies that each pipeline bank has:
 * <ol>
 *   <li>A `*_LOGIN` export in `&lt;Name&gt;Pipeline.ts`.</li>
 *   <li>A matching row in `BankFixtureExpectations.ts`.</li>
 *   <li>An entry in `BankLoginConfigs.ts`.</li>
 *   <li>A non-empty fixtures directory under
 *       `src/Tests/Integration/fixtures/banks/&lt;bankId&gt;/`.</li>
 * </ol>
 *
 * API-direct providers (no DOM) are exempted via
 * {@link API_DIRECT_BANKS}.
 *
 * Wired into:
 * <ul>
 *   <li>`.husky/pre-commit` → `bg_gate "bank-coverage" ...`</li>
 *   <li>`.github/workflows/pr.yml` → `Bank integration coverage gate`</li>
 * </ul>
 *
 * Exits with code 0 when all gates pass, non-zero otherwise.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import BANK_FIXTURE_EXPECTATIONS from '../Banks/BankFixtureExpectations.js';
import BANK_LOGIN_CONFIGS from '../Banks/BankLoginConfigs.js';
import type { IBankFixtureExpectations } from '../Banks/FixtureExpectations.js';

const HERE_URL = import.meta.url;
const HERE_PATH = fileURLToPath(HERE_URL);
const HERE = dirname(HERE_PATH);
const REPO_ROOT = join(HERE, '..', '..', '..', '..');
const BANKS_ROOT = join(REPO_ROOT, 'src', 'Scrapers', 'Pipeline', 'Banks');
const FIXTURES_ROOT = join(REPO_ROOT, 'src', 'Tests', 'Integration', 'fixtures', 'banks');
const PENDING_REHARVEST_FILE = join(REPO_ROOT, '.github', 'banks-pending-reharvest.txt');

/**
 * Pipeline directories that wrap API-only providers — no DOM and
 * therefore no Mode-A integration fixture is possible.
 */
const API_DIRECT_BANKS: ReadonlySet<string> = new Set(['OneZero', 'PayBox', 'Pepper']);

/**
 * Canonical PascalCase folder → bankId override map.
 * For folders not listed, lower-first conversion is applied.
 */
const BANK_ID_OVERRIDES: Readonly<Partial<Record<string, string>>> = {
  OtsarHahayal: 'otsarHahayal',
  VisaCal: 'visaCal',
};

/** Findings for one bank — empty `missing` means the gate passes. */
interface IBankFinding {
  readonly folderName: string;
  readonly bankId: string;
  readonly missing: readonly string[];
}

/**
 * Convert a PascalCase folder name to its canonical bankId.
 * @param folderName - PascalCase folder name under Banks/.
 * @returns The canonical bankId (lower-first or override).
 */
function toBankId(folderName: string): string {
  const override = BANK_ID_OVERRIDES[folderName];
  if (override !== undefined) return override;
  return folderName.charAt(0).toLowerCase() + folderName.slice(1);
}

/**
 * Lists pipeline bank folder names in alphabetical order, filtering
 * out the API-direct allow-list.
 * @returns Array of folder names eligible for the Mode-A gate.
 */
function listPipelineBankFolders(): readonly string[] {
  const all = readdirSync(BANKS_ROOT, { withFileTypes: true });
  const dirs = all.filter(d => d.isDirectory()).map(d => d.name);
  const eligible = dirs.filter(name => !API_DIRECT_BANKS.has(name));
  return eligible.sort();
}

/**
 * Verify the bank's pipeline file exports a `<NAME>_LOGIN` const. Accepts
 * both styles: `export const X_LOGIN ...` AND `export { ..., X_LOGIN, ... }`.
 * @param folderName - PascalCase folder name under Banks/.
 * @returns True when the export string is present.
 */
function hasLoginExport(folderName: string): boolean {
  const pipelinePath = join(BANKS_ROOT, folderName, `${folderName}Pipeline.ts`);
  if (!existsSync(pipelinePath)) return false;
  const source = readFileSync(pipelinePath, 'utf8');
  const inlineExport = /export\s+const\s+\w+_LOGIN[: ]/;
  const namedExport = /export\s*\{[^}]*\b\w+_LOGIN\b[^}]*\}/;
  return inlineExport.test(source) || namedExport.test(source);
}

/**
 * Verify the fixtures directory exists and contains at least one
 * harvested step (sub-directory OR top-level *.html file).
 * @param bankId - Canonical bankId.
 * @returns True when fixtures are present.
 */
function hasFixtureDir(bankId: string): boolean {
  const fixtureDir = join(FIXTURES_ROOT, bankId);
  if (!existsSync(fixtureDir)) return false;
  const stat = statSync(fixtureDir);
  if (!stat.isDirectory()) return false;
  const inner = readdirSync(fixtureDir, { withFileTypes: true });
  const hasStep = inner.some(d => d.isDirectory() || d.name.endsWith('.html'));
  return hasStep;
}

/**
 * Load the bank's loginStep HTML if present.
 * @param bankId - Canonical bankId.
 * @param loginStep - Step name (matches `<step>.html` filename).
 * @returns HTML content or `''` when the file is missing.
 */
function loadLoginStepHtml(bankId: string, loginStep: string): string {
  const file = join(FIXTURES_ROOT, bankId, `${loginStep}.html`);
  if (!existsSync(file)) return '';
  return readFileSync(file, 'utf8');
}

/**
 * Heuristic: the loginStep HTML must contain at least one credential
 * input (type=password OR id=password OR id matching a well-known
 * masked-input pattern used by Hebrew banks).
 * @param html - LoginStep HTML.
 * @returns True when at least one credential input pattern is present.
 */
function hasCredentialInput(html: string): boolean {
  if (html === '') return false;
  const typePasswordRe = /<input[^>]*type="password"/i;
  const idPasswordRe = /<input[^>]*id="(?:password|tzPassword|otpLoginPwd)"/i;
  return typePasswordRe.test(html) || idPasswordRe.test(html);
}

/**
 * Load the pending-reharvest allow-list — banks whose harvester recipe
 * gap is being tracked under a separate operator workstream. Listed
 * banks fail the strict drive-readiness check but DO NOT fail the
 * commit gate. Used as a transitional measure while the operator
 * progressively harvests with updated click-tab recipes.
 *
 * <p>Format: one bankId per line; lines starting with `#` are comments.
 * @returns Set of bankIds currently on the allow-list.
 */
function loadPendingReharvestAllowlist(): ReadonlySet<string> {
  if (!existsSync(PENDING_REHARVEST_FILE)) return new Set();
  const content = readFileSync(PENDING_REHARVEST_FILE, 'utf8');
  const lines = content.split(/\r?\n/);
  const entries = lines.map(l => l.trim()).filter(l => l !== '' && !l.startsWith('#'));
  return new Set(entries);
}

/**
 * Pre-computed expectation lookup keyed by bankId.
 * @returns Map of bankId → expectations row.
 */
function buildExpectationIndex(): ReadonlyMap<string, IBankFixtureExpectations> {
  const entries: [string, IBankFixtureExpectations][] = [];
  for (const row of BANK_FIXTURE_EXPECTATIONS) entries.push([row.bankId, row]);
  return new Map(entries);
}

/**
 * Pre-computed config lookup keyed by bankId.
 * @returns Set of bankIds registered in BankLoginConfigs.
 */
function buildConfigIndex(): ReadonlySet<string> {
  const ids = Object.keys(BANK_LOGIN_CONFIGS);
  return new Set(ids);
}

/** Audit-args bundle (keeps {@link auditOneBank} under the max-params cap). */
interface IAuditArgs {
  readonly folderName: string;
  readonly expectations: ReadonlyMap<string, IBankFixtureExpectations>;
  readonly configs: ReadonlySet<string>;
  readonly pendingReharvest: ReadonlySet<string>;
}

/** Bundle for {@link checkModeADriveReadiness} — keeps params ≤3. */
interface IModeReadinessArgs {
  readonly bankId: string;
  readonly expectations: ReadonlyMap<string, IBankFixtureExpectations>;
  readonly pendingReharvest: ReadonlySet<string>;
}

/**
 * Build a "Mode A drive-readiness" failure message for the given step.
 * @param loginStep - The login step name lacking credential input.
 * @returns Failure message.
 */
function buildModeAFailureMessage(loginStep: string): string {
  return `Mode A drive-readiness: loginStep "${loginStep}" HTML lacks credential input`;
}

/**
 * Check Mode A drive-readiness: loginStep HTML present + has credential
 * input. Pending-reharvest entries are skipped silently.
 * @param args - Args bundle.
 * @returns Failure message or `''` when Mode A is drive-ready.
 */
function checkModeADriveReadiness(args: IModeReadinessArgs): string {
  const row = args.expectations.get(args.bankId);
  if (row === undefined) return '';
  if (args.pendingReharvest.has(args.bankId)) return '';
  const html = loadLoginStepHtml(args.bankId, row.loginStep);
  if (!hasCredentialInput(html)) return buildModeAFailureMessage(row.loginStep);
  return '';
}

/**
 * Build a "Mode B mirror-readiness" failure message for the given step.
 * @param loginStep - The login step name lacking credential input.
 * @returns Failure message.
 */
function buildModeBFailureMessage(loginStep: string): string {
  return `Mode B mirror-readiness: loginStep "${loginStep}" HTML lacks credential input for mirror replay`;
}

/**
 * Check Mode B mirror-readiness: same loginStep HTML is reused via the
 * MirrorInterceptor route, so the check is identical to Mode A.
 * @param args - Args bundle.
 * @returns Failure message or `''` when Mode B is mirror-ready.
 */
function checkModeBMirrorReadiness(args: IModeReadinessArgs): string {
  const row = args.expectations.get(args.bankId);
  if (row === undefined) return '';
  if (args.pendingReharvest.has(args.bankId)) return '';
  if (row.originUrl === '') return 'Mode B mirror-readiness: originUrl is empty';
  const html = loadLoginStepHtml(args.bankId, row.loginStep);
  if (!hasCredentialInput(html)) return buildModeBFailureMessage(row.loginStep);
  return '';
}

/**
 * Run the Mode A + Mode B readiness checks and append any failures.
 * @param bankId - Canonical bankId.
 * @param args - Audit-args bundle.
 * @param missing - Mutable failure accumulator.
 * @returns The same accumulator for chaining.
 */
function appendModeReadinessFailures(
  bankId: string,
  args: IAuditArgs,
  missing: string[],
): string[] {
  const readinessArgs: IModeReadinessArgs = {
    bankId,
    expectations: args.expectations,
    pendingReharvest: args.pendingReharvest,
  };
  const modeA = checkModeADriveReadiness(readinessArgs);
  if (modeA !== '') missing.push(modeA);
  const modeB = checkModeBMirrorReadiness(readinessArgs);
  if (modeB !== '') missing.push(modeB);
  return missing;
}

/**
 * Run all checks for one bank, collecting any missing artifacts.
 * @param args - Folder name + pre-computed expectation/config indexes + allow-list.
 * @returns A finding object — `missing` is empty when the bank passes.
 */
function auditOneBank(args: IAuditArgs): IBankFinding {
  const bankId = toBankId(args.folderName);
  const missing: string[] = [];
  if (!hasLoginExport(args.folderName)) {
    missing.push(`${args.folderName}Pipeline.ts:*_LOGIN export`);
  }
  if (!args.expectations.has(bankId)) missing.push(`BankFixtureExpectations row "${bankId}"`);
  if (!args.configs.has(bankId)) missing.push(`BankLoginConfigs entry "${bankId}"`);
  if (!hasFixtureDir(bankId)) missing.push(`fixtures/banks/${bankId}/ (harvested HTML)`);
  appendModeReadinessFailures(bankId, args, missing);
  return { folderName: args.folderName, bankId, missing };
}

/**
 * Audit every eligible pipeline bank.
 * @returns Per-bank findings in alphabetical order.
 */
function auditAllBanks(): readonly IBankFinding[] {
  const folders = listPipelineBankFolders();
  const expectations = buildExpectationIndex();
  const configs = buildConfigIndex();
  const pendingReharvest = loadPendingReharvestAllowlist();
  return folders.map(folderName =>
    auditOneBank({ folderName, expectations, configs, pendingReharvest }),
  );
}

/**
 * Print one finding in human-friendly form.
 * @param finding - The finding object.
 * @returns The finding so callers can chain output.
 */
function printFinding(finding: IBankFinding): IBankFinding {
  const status = finding.missing.length === 0 ? 'OK' : 'FAIL';
  console.log(`  [${status}] ${finding.folderName} (bankId="${finding.bankId}")`);
  for (const item of finding.missing) {
    console.log(`        missing: ${item}`);
  }
  return finding;
}

/**
 * Print the bank coverage tally line.
 * @param okCount - Number of banks that passed.
 * @param total - Total banks audited.
 * @param failureCount - Number of banks that failed.
 * @returns The okCount for chaining.
 */
function printCoverageTally(okCount: number, total: number, failureCount: number): number {
  console.log(
    `\nBank coverage: ${String(okCount)}/${String(total)} OK, ` +
      `${String(failureCount)} failing.`,
  );
  return okCount;
}

/**
 * Print the failure footer and exit with non-zero status.
 * @returns Never returns; throws process.exit(1).
 */
function exitWithFailure(): never {
  console.error(
    '\n❌ Bank integration coverage gate FAILED. ' +
      'Every pipeline bank (non-API-direct) must have a fixture + expectations row.',
  );
  process.exit(1);
}

/**
 * Summarise + exit with non-zero code when any bank failed.
 * @param findings - The per-bank findings.
 * @returns Number of failing banks (0 on success).
 */
function summarizeAndExit(findings: readonly IBankFinding[]): number {
  const failures = findings.filter(f => f.missing.length > 0);
  const okCount = findings.length - failures.length;
  printCoverageTally(okCount, findings.length, failures.length);
  if (failures.length > 0) exitWithFailure();
  console.log('\n✅ Bank integration coverage gate PASSED.');
  return failures.length;
}

/**
 * CLI entry: audit + print + exit with status code.
 * @returns The number of audited banks (for tooling integration).
 */
function main(): number {
  console.log('Bank integration coverage gate — auditing pipeline banks…\n');
  const findings = auditAllBanks();
  for (const finding of findings) printFinding(finding);
  summarizeAndExit(findings);
  return findings.length;
}

main();
