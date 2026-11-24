/**
 * Unit tests for diff-block coverage reporting.
 */

import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { isReviewComplete } from '../../../../.github/scripts/pr-review/approval.mjs';
import {
  fetchPrData,
  filterDiffWithReport,
} from '../../../../.github/scripts/pr-review/fetch-pr.mjs';
import { acceptOf, responseTo, urlOf } from './PrReviewAgentTestUtils.js';

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
    expect(report.credential).toBe(0);
    expect(report.sensitive).toBe(0);
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
    expect(report.credential).toBe(0);
    expect(report.sensitive).toBe(1);
  });

  it('carries the drop reason into metadata and blocks approval', async () => {
    await mkdir('.review', { recursive: true });
    const dir = await mkdtemp('.review/pr-review-coverage-');
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
    /**
     * Serve the PR metadata, diff, changed file and blob.
     * @param input - Fetch input.
     * @param init - Fetch options.
     * @returns Fake response.
     */
    const fetchImpl: typeof fetch = (input, init) => {
      const url = urlOf(input);
      const accept = acceptOf(init);
      if (url.endsWith('/pulls/886') && accept.includes('diff')) {
        return Promise.resolve(new Response(diff));
      }
      if (url.includes('/pulls/886/files')) {
        return responseTo([
          { filename: 'src/a.ts', status: 'modified', sha: 'blob-sha', additions: 1, deletions: 0 },
        ]);
      }
      if (url.includes('/git/blobs/')) {
        return responseTo({
          encoding: 'base64',
          size: 7,
          content: Buffer.from('changed').toString('base64'),
        });
      }
      return responseTo({
        state: 'open',
        title: 'test',
        body: 'body',
        user: { login: 'author' },
        base: { sha: 'base-sha' },
        head: { sha: 'head-sha', ref: 'feature', repo: { full_name: 'sergienko4/repo' } },
        additions: 1,
        deletions: 0,
        changed_files: 1,
      });
    };
    try {
      const summary = await fetchPrData({
        repo: 'sergienko4/repo',
        pr: 886,
        token: 'token',
        outDir: dir,
        maxDiffChars: 1000,
        maxFileChars: 1000,
        expectedHeadSha: 'head-sha',
        fetchImpl,
      });
      const metadataPath = join(dir, 'metadata.json');
      const metadataText = await readFile(metadataPath, 'utf8');
      const metadata = JSON.parse(metadataText) as Record<string, unknown>;
      const isComplete = isReviewComplete(metadata, { maxFiles: 300 });
      expect(summary).toMatchObject({
        diffDropped: true,
        diffDropReasons: { credential: 0, sensitive: 0, unparsable: 1 },
      });
      expect(metadata).toMatchObject({
        diffDropped: true,
        diffDropReasons: { credential: 0, sensitive: 0, unparsable: 1 },
      });
      expect(isComplete).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
