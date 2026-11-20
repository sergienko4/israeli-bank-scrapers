/**
 * Unit tests for credential-content filtering in PR review data. No network is
 * used; the GitHub API is a local fake.
 */

import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { fetchPrData } from '../../../../.github/scripts/pr-review/fetch-pr.mjs';

/**
 * Read a fetch input URL without the `[object Object]` default.
 * @param input - Fetch input.
 * @returns URL text.
 */
function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

/**
 * Build a JSON API response.
 * @param body - Response body.
 * @param status - HTTP status.
 * @returns Fake response.
 */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Wrap one JSON body as a resolved fetch response.
 * @param body - Response body.
 * @param status - HTTP status.
 * @returns Resolved response.
 */
function responseTo(body: unknown, status = 200): Promise<Response> {
  const response = jsonResponse(body, status);
  return Promise.resolve(response);
}

/**
 * Read the Accept header from fetch options.
 * @param init - Fetch options.
 * @returns Header value, or empty.
 */
function acceptOf(init?: RequestInit): string {
  const headers = new Headers(init?.headers);
  return headers.get('Accept') ?? '';
}

/**
 * A pull request metadata response for one head SHA.
 * @param sha - Head SHA.
 * @returns Resolved response.
 */
function metadataResponse(sha: string): Promise<Response> {
  return responseTo({
    state: 'open',
    base: { sha: 'base-sha' },
    head: { sha, ref: 'feature', repo: { full_name: 'sergienko4/repo' } },
  });
}

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
});
