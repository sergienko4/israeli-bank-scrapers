/**
 * Unit tests for diff-block coverage reporting.
 */

import { filterDiffWithReport } from '../../../../.github/scripts/pr-review/fetch-pr.mjs';

describe('PR review diff coverage', () => {
  it('drops a malformed block and keeps the valid block', () => {
    const diff = [
      'diff --git ???',
      '@@ -1 +1 @@',
      '-OLD_SECRET',
      '+NEW_SECRET',
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new',
    ].join('\n');
    const report = filterDiffWithReport(diff);
    expect(report.text).not.toContain('NEW_SECRET');
    expect(report.text).toContain('src/a.ts');
    expect(report.dropped).toBe(1);
    expect(report.unparsable).toBe(1);
  });

  it('counts a sensitive-path drop as incomplete coverage', () => {
    const diff = [
      'diff --git a/src/a b/.env b/z.ts b/src/a b/.env b/z.ts',
      '--- a/src/a b/.env b/z.ts',
      '+++ b/src/a b/.env b/z.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new',
    ].join('\n');
    const report = filterDiffWithReport(diff);
    expect(report.dropped).toBe(1);
    expect(report.unparsable).toBe(0);
  });
});
