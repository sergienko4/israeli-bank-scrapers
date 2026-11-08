/**
 * Scope contract for the three SonarJS-mirror canaries.
 *
 * Each canary re-asserts an ESLint rule by regex. It is only meaningful while
 * it shadows a rule that is actually in force, so its scope must match that
 * rule's scope exactly — never stricter, never weaker. These tests pin that
 * correspondence to `eslint.config.mjs` blocks 11 (S6564 / S3735) and
 * 19.6 (S1607). See `docs/workflow/architecture-linter.md`.
 *
 * The scope lists come from `eslint.canary-scope.mjs`, the single source both
 * ESLint and the linter consume. These tests therefore assert *behaviour* —
 * which paths the canaries fire on — rather than restating the lists, which
 * would only re-check a literal against itself.
 */
import { SONAR_PARITY_IGNORE_PREFIXES } from '../../../../eslint.canary-scope.mjs';
import { type IIssue, issuesFromCode } from '../../../Tests/Tools/LintValidator.js';

/** Source that trips S6564 (bare-primitive alias) and S3735 (`void <expr>;`). */
const PARITY_SOURCE = ['type ProbeAlias = string;', 'const t = 1;', 'void t;'].join('\n');

/** Source that trips S1607 — a skip with no `#nnn` rationale. */
const SKIP_SOURCE = ["describe.skip('probe', () => {", "  it('x', () => undefined);", '});'].join(
  '\n',
);

/**
 * A representative file inside every path block 11 excludes. Derived from the
 * shared prefixes so a newly excluded directory is covered automatically
 * rather than silently untested.
 */
const PARITY_IGNORED_PATHS = SONAR_PARITY_IGNORE_PREFIXES.map(prefix => `${prefix}Probe.ts`);

/** Production paths block 11 covers, so the canaries must fire there. */
const PARITY_COVERED_PATHS = [
  'src/Scrapers/Pipeline/Mediator/Elements/RenderHealth.ts',
  'src/Scrapers/Base/Errors.ts',
];

/**
 * Collect the canary rule keys raised for a synthetic file.
 * @param filePath - Logical path driving scope selection.
 * @param code - Source text to analyse.
 * @returns The distinct canary rule keys raised.
 */
function canaryRules(filePath: string, code: string): string[] {
  const issues: IIssue[] = issuesFromCode(filePath, code, new Map());
  const canaries = issues.map(i => i.rule).filter(r => r.endsWith('-Canary'));
  return [...new Set(canaries)];
}

describe('SonarJS-mirror canary scope', () => {
  describe('S6564 + S3735 mirror eslint.config.mjs block 11', () => {
    it.each(PARITY_COVERED_PATHS)('fires on covered production path %s', filePath => {
      const rules = canaryRules(filePath, PARITY_SOURCE);
      expect(rules).toContain('S6564-Canary');
      expect(rules).toContain('S3735-Canary');
    });

    it.each(PARITY_IGNORED_PATHS)('stays silent on excluded path %s', filePath => {
      const rules = canaryRules(filePath, PARITY_SOURCE);
      expect(rules).not.toContain('S6564-Canary');
      expect(rules).not.toContain('S3735-Canary');
    });
  });

  describe('S1607 mirrors block 19.6', () => {
    // Block 19.6 turns the rule ON across src/Tests with no file exempt.
    // Skipped tests are what S1607 exists to find, so an exemption would
    // gut it — the last suite the retired allow-list named included.
    it.each([
      'src/Tests/Unit/Pipeline/Something.test.ts',
      'src/Tests/Tools/SomeTool.ts',
      'src/Tests/E2eMocked/Discount/Discount.e2e-mocked.test.ts',
    ])('still fires inside src/Tests for %s', filePath => {
      const rules = canaryRules(filePath, SKIP_SOURCE);
      expect(rules).toContain('S1607-Canary');
    });
  });

  describe('path handling', () => {
    it('treats a Windows-separator path the same as a POSIX one', () => {
      const win = canaryRules('src\\Common\\Browser.ts', PARITY_SOURCE);
      expect(win).not.toContain('S6564-Canary');
    });

    it('exempts an absolute path inside this checkout', () => {
      const cwdFwd = process.cwd().split('\\').join('/');
      const abs = `${cwdFwd}/src/Common/Browser.ts`;
      const rules = canaryRules(abs, PARITY_SOURCE);
      expect(rules).not.toContain('S6564-Canary');
    });

    // Fail-closed: an unrelated checkout whose ancestor is named `src/Tests`
    // must NOT inherit this repo's exemptions.
    it('does not exempt a foreign path whose ancestor is named src/Tests', () => {
      const foreign = '/other/src/Tests/checkout/src/Scrapers/Pipeline/Thing.ts';
      const rules = canaryRules(foreign, PARITY_SOURCE);
      expect(rules).toContain('S6564-Canary');
    });
  });
});
