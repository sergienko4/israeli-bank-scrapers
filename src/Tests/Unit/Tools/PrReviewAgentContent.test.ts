/**
 * Unit tests for credential-content filtering in PR review data. No network is
 * used; the GitHub API is a local fake.
 */

import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { fetchPrData } from '../../../../.github/scripts/pr-review/fetch-pr.mjs';
import { acceptOf, metadataResponse, responseTo, urlOf } from './PrReviewAgentTestUtils.js';

describe('PR review credential content', () => {
  it('skips a normal-named file that contains a credential', async () => {
    await mkdir('.review', { recursive: true });
    const tempPrefix = join('.review', 'pr-review-credential-');
    const dir = await mkdtemp(tempPrefix);
    const secret = 'AKIA1234567890ABCDEF';
    const files = responseTo([
      { filename: 'src/config.ts', status: 'added', sha: 'blob-sha', additions: 1, deletions: 0 },
    ]);
    const blobs = responseTo({
      encoding: 'base64',
      size: secret.length,
      content: Buffer.from(secret).toString('base64'),
    });
    const diffResponse = new Response(
      `diff --git a/src/config.ts b/src/config.ts\n--- /dev/null\n+++ b/src/config.ts\n@@ -0,0 +1 @@\n+const key = "${secret}";\n`,
    );
    const diff = Promise.resolve(diffResponse);
    /**
     * Answer the changed-file, blob and diff requests.
     * @param input - Fetch input.
     * @param init - Fetch options.
     * @returns Fake response.
     */
    const fetchImpl: typeof fetch = (input, init) => {
      const url = urlOf(input);
      if (url.includes('/files')) return files;
      if (url.includes('/git/blobs/')) return blobs;
      if (acceptOf(init).includes('diff')) return diff;
      return metadataResponse('head-sha');
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
      expect(summary).toMatchObject({ files: 1, skipped: 0 });
      const metadataPath = join(dir, 'metadata.json');
      const metadataText = await readFile(metadataPath, 'utf8');
      const metadata = JSON.parse(metadataText) as {
        credentialContent: boolean;
        files: { dataFile: string | null }[];
        sensitiveFiles: string[];
      };
      expect(metadata.credentialContent).toBe(true);
      expect(metadata.sensitiveFiles).toContain('src/config.ts');
      expect(metadata.files[0].dataFile).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('redacts credential-bearing pull request metadata', async () => {
    await mkdir('.review', { recursive: true });
    const tempPrefix = join('.review', 'pr-review-metadata-');
    const dir = await mkdtemp(tempPrefix);
    const secret = 'AKIA1234567890ABCDEF';
    const metadata = {
      state: 'open',
      title: 'safe title',
      body: `token ${secret}`,
      user: { login: 'author' },
      base: { sha: 'base-sha' },
      head: { sha: 'head-sha', ref: 'feature', repo: { full_name: 'sergienko4/repo' } },
      additions: 0,
      deletions: 0,
      changed_files: 0,
    };
    /**
     * Answer the metadata, file-list and diff requests.
     * @param input - Fetch input.
     * @param init - Fetch options.
     * @returns Fake response.
     */
    const fetchImpl: typeof fetch = (input, init) => {
      const url = urlOf(input);
      if (url.includes('/files')) return responseTo([]);
      if (acceptOf(init).includes('diff')) return Promise.resolve(new Response(''));
      return responseTo(metadata);
    };
    try {
      await fetchPrData({
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
      const parsed = JSON.parse(metadataText) as { body: string };
      expect(metadataText).not.toContain(secret);
      expect(parsed.body).toBe('[REDACTED]');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
