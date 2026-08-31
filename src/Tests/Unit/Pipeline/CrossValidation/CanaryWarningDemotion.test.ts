/**
 * Warning-demotion diagnosis for the canary harness.
 *
 * <p>`assert-canaries.cjs` fails a canary whose declared rule stopped firing.
 * It must fail one whose declared rule was merely demoted from `error` to
 * `warn` for the same reason — a warning cannot fail CI — but say so, because
 * "the rule they certify is gone" sends the reader hunting for a deleted rule
 * that is still sitting in the config.
 *
 * <p>The harness reads an ESLint JSON report from `argv[2]`, so a synthetic
 * report pinned to a real canary file exercises the classification end to end
 * without linting anything.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_FILE_PATH = fileURLToPath(import.meta.url);
const THIS_DIR = dirname(THIS_FILE_PATH);
const REPO_ROOT = join(THIS_DIR, '../../../../../');
const CANARIES = join(REPO_ROOT, 'src/Scrapers/Pipeline/EslintCanaries');
const HARNESS = join(CANARIES, 'assert-canaries.cjs');

/** A canary declaring `no-restricted-syntax` with a message. */
const SUBJECT = join(CANARIES, 'ArchitectureGlobal.canary.ts');

/** Rule that canary declares. */
const DECLARED_RULE = 'no-restricted-syntax';

/** Message that canary declares. */
const DECLARED_MESSAGE = "'void' is forbidden";

/** ESLint severity for a warning. */
const WARN = 1;

/**
 * Build a one-file ESLint report in which the declared rule fired as a warning.
 *
 * @param severity - Severity to report the declared rule at.
 * @returns Report matching ESLint's JSON formatter shape.
 */
function reportAt(severity: number): unknown {
  const isError = severity === 2;
  return [
    {
      filePath: SUBJECT,
      errorCount: isError ? 1 : 0,
      warningCount: isError ? 0 : 1,
      messages: [{ ruleId: DECLARED_RULE, severity, message: DECLARED_MESSAGE }],
    },
  ];
}

/**
 * Run the harness against a synthetic report.
 *
 * @param severity - Severity to report the declared rule at.
 * @returns Combined stdout/stderr, and whether the harness failed.
 */
function runHarness(severity: number): { readonly output: string; readonly didFail: boolean } {
  const tempRoot = tmpdir();
  const prefix = join(tempRoot, 'canary-report-');
  const dir = mkdtempSync(prefix);
  const reportPath = join(dir, 'report.json');
  const payload = reportAt(severity);
  const serialized = JSON.stringify(payload);
  writeFileSync(reportPath, serialized, 'utf8');
  try {
    const stdout = execFileSync('node', [HARNESS, reportPath], { encoding: 'utf8' });
    return { output: stdout, didFail: false };
  } catch (error) {
    const shell = error as { stdout?: string; stderr?: string };
    const stdout = shell.stdout ?? '';
    const stderr = shell.stderr ?? '';
    return { output: `${stdout}${stderr}`, didFail: true };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('CanaryWarningDemotion', () => {
  it('[CI-CANARY] Harness_DeclaredRuleDemotedToWarn_ShouldFail', () => {
    const result = runHarness(WARN);
    expect(result.didFail).toBe(true);
  });

  it('[CI-CANARY] Harness_DeclaredRuleDemotedToWarn_ShouldSayItWasAWarning', () => {
    const result = runHarness(WARN);
    const isDiagnosed = result.output.includes('fired only as a warning');
    expect(isDiagnosed).toBe(true);
  });

  it('[CI-CANARY] Harness_DeclaredRuleDemotedToWarn_ShouldNotClaimTheRuleIsGone', () => {
    const result = runHarness(WARN);
    const didClaimGone = result.output.includes('the rule they certify is gone');
    expect(didClaimGone).toBe(false);
  });
});
