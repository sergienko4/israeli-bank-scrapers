/**
 * PII-log bypass-attempt snapshot. Synthesises a malicious source string
 * that exercises both T09 (template-literal PII) and T16 (full-payload
 * bucket) and asserts BOTH enforcement layers catch it independently:
 *   Layer 1 — ESLint via `npx eslint --stdin --stdin-filename` so the
 *             production AST selectors evaluate against the production
 *             config without writing fixture files into the tree.
 *   Layer 2 — `issuesFromCode` regex (lint:architecture time).
 *
 * If either layer ever silently regresses (rule deletion, selector
 * weakening, allowlist mistake), one half of this test will fail and
 * the commit will be blocked.
 */

import { spawnSync } from 'node:child_process';

import { issuesFromCode } from '../../../Tests/Tools/LintValidator.js';

/** Malicious code: T09 trip + T16a trip + T16b trip. */
const MALICIOUS_CODE = [
  'declare const accountId: string;',
  'declare const scrapeOutput: object;',
  'declare const rawArr: object[];',
  'declare const LOG: { debug: (x: unknown) => unknown; info: (x: unknown) => unknown };',
  '',
  'LOG.debug(`account: ' + '$' + '{accountId}`);',
  'LOG.info({ result: scrapeOutput });',
  'LOG.info({ accounts: [...rawArr] });',
  '',
  'export {};',
].join('\n');

/** Existing real file path used as the ESLint stdin filename. The path must
 * live inside `tsconfig.include` so the type-aware parser succeeds — the
 * file's content is not read; ESLint lints stdin, treating it as if it lived
 * at this path. Pipeline-tier rules apply because the path matches the
 * Pipeline `files` glob. */
const STDIN_PATH = 'src/Scrapers/Pipeline/Types/Debug.ts';

/** Minimal ESLint JSON record needed for assertions. */
interface IEslintMessage {
  readonly message: string;
  readonly ruleId: string | null;
}
interface IEslintFileReport {
  readonly messages: readonly IEslintMessage[];
}

/**
 * Spawn ESLint with stdin input and return the parsed JSON report.
 * @param code - Source code to lint (passed via stdin).
 * @returns Parsed ESLint per-file reports.
 */
function lintWithStdin(code: string): readonly IEslintFileReport[] {
  const result = spawnSync(
    'npx',
    ['eslint', '--stdin', '--stdin-filename', STDIN_PATH, '--no-ignore', '--format', 'json'],
    { input: code, encoding: 'utf8', shell: true },
  );
  const stdout = result.stdout || '[]';
  return JSON.parse(stdout) as readonly IEslintFileReport[];
}

/**
 * Whether at least one ESLint message contains the given needle.
 * @param report - Parsed ESLint report.
 * @param needle - Substring to find.
 * @returns True iff any message contains the needle.
 */
function reportContains(report: readonly IEslintFileReport[], needle: string): boolean {
  return report.some((file): boolean =>
    file.messages.some((m): boolean => m.message.includes(needle)),
  );
}

describe('PII-log bypass prevention — both layers must catch the same code', () => {
  it('Layer 2 (regex) emits PII-Log issues for the malicious code', () => {
    const issues = issuesFromCode(STDIN_PATH, MALICIOUS_CODE, new Map());
    const piiIssues = issues.filter((i): boolean => i.rule === 'PII-Log');
    expect(piiIssues.length).toBeGreaterThanOrEqual(2);
  });

  it('Layer 2 catches the T09 template-literal pattern', () => {
    const issues = issuesFromCode(STDIN_PATH, MALICIOUS_CODE, new Map());
    const has09 = issues.some((i): boolean => i.message.includes('T09'));
    expect(has09).toBe(true);
  });

  it('Layer 2 catches the T16 payload-bucket pattern', () => {
    const issues = issuesFromCode(STDIN_PATH, MALICIOUS_CODE, new Map());
    const has16 = issues.some((i): boolean => i.message.includes('T16'));
    expect(has16).toBe(true);
  });

  it('Layer 1 (ESLint) reports PII LEAK messages on the malicious code', () => {
    const report = lintWithStdin(MALICIOUS_CODE);
    const hasPii = reportContains(report, 'PII LEAK');
    expect(hasPii).toBe(true);
  }, 60_000);
});
