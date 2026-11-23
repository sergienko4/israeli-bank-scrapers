/**
 * Unit tests for the on-demand PR review scripts. They pin the pure parts:
 * trigger parsing, the model allow-list, request resolution and PR data
 * fetching. No network or GitHub call is made.
 */

import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import {
  fetchPrData,
  filterDiff,
  hasCredentialContent,
  isSensitiveFile,
  isSensitivePath,
} from '../../../../.github/scripts/pr-review/fetch-pr.mjs';
import {
  normalizeModel,
  parseRequest,
  resolveRequest,
} from '../../../../.github/scripts/pr-review/resolve-request.mjs';
import { acceptOf, metadataResponse, responseTo, urlOf } from './PrReviewAgentTestUtils.js';

const CONFIG = {
  provider: 'opencode-go',
  modelPrefix: 'deepseek',
  defaultModel: 'auto',
  defaultVariant: 'high',
  variantPriority: ['high', 'max', 'low'],
  fallbackModels: [
    { id: 'deepseek-v4.1-flash', variants: ['low', 'high', 'max'] },
    { id: 'deepseek-v4-pro', variants: ['high', 'max'] },
  ],
};

const MODELS = [
  {
    id: 'opencode-go/deepseek-v4.1-flash',
    variants: ['low', 'high', 'max'],
    released: Date.parse('2026-10-17'),
  },
  {
    id: 'opencode-go/deepseek-v4-pro',
    variants: ['high', 'max'],
    released: Date.parse('2026-04-01'),
  },
];

/** A maintainer `/review` event for PR 886. */
const REVIEW_EVENT = {
  issue: { number: 886, pull_request: {} },
  comment: {
    body: '/review',
    author_association: 'MEMBER',
    user: { login: 'maintainer' },
  },
};

/**
 * A one-model catalog response.
 * @returns Resolved response.
 */
function catalogResponse(): Promise<Response> {
  return responseTo({
    data: [
      {
        id: 'deepseek-v4.1-flash',
        release_date: '2026-10-17',
        capabilities: { reasoning: { effort: ['high'] } },
      },
    ],
  });
}

/**
 * A fake GitHub API for one same-repo PR.
 * @returns Fake fetch.
 */
function fakeGitHub(): typeof fetch {
  return (input, init) => {
    const url = urlOf(input);
    const accept = new Headers(init?.headers).get('Accept') ?? '';
    if (url.includes('inference/go/v1/models')) {
      return responseTo({
        data: [
          {
            id: 'deepseek-v4.1-flash',
            release_date: '2026-10-17',
            capabilities: { reasoning: { effort: ['low', 'high', 'max'] } },
          },
          {
            id: 'deepseek-v4-pro',
            release_date: '2026-04-01',
            capabilities: { reasoning: { effort: ['high', 'max'] } },
          },
        ],
      });
    }
    if (url.includes('/collaborators/')) return responseTo({ permission: 'write' });
    if (url.includes('/files')) {
      return responseTo([
        {
          filename: 'src/a.ts',
          status: 'modified',
          sha: 'blob-sha',
          additions: 1,
          deletions: 0,
        },
      ]);
    }
    if (url.includes('/git/blobs/')) {
      const content = Buffer.from('changed').toString('base64');
      return responseTo({ encoding: 'base64', size: 7, content });
    }
    if (accept.includes('diff')) {
      return Promise.resolve(new Response('diff --git a/src/a.ts b/src/a.ts\n'));
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
}

describe('PR review model allow-list', () => {
  it('picks the newest DeepSeek model and accepts a known variant', () => {
    const defaultModel = normalizeModel('', CONFIG, MODELS);
    const proModel = normalizeModel('deepseek-v4-pro#max', CONFIG, MODELS);
    expect(defaultModel).toBe('opencode-go/deepseek-v4.1-flash#high');
    expect(proModel).toBe('opencode-go/deepseek-v4-pro#max');
  });

  it('accepts a newly released DeepSeek model without a config change', () => {
    const next = [
      ...MODELS,
      {
        id: 'opencode-go/deepseek-v5-flash',
        variants: ['high', 'max'],
        released: Date.parse('2027-01-01'),
      },
    ];
    const selected = normalizeModel('auto', CONFIG, next);
    expect(selected).toBe('opencode-go/deepseek-v5-flash#high');
  });

  it.each([
    ['openai/gpt-5', 'provider is not allowed'],
    ['deepseek-v4.1-flash#ultra', 'variant is not allowed'],
    ['unknown-model', 'model is not allowed'],
  ])('refuses %s', (input, message) => {
    expect(() => normalizeModel(input, CONFIG, MODELS)).toThrow(message);
  });
});

describe('PR review trigger', () => {
  it('accepts an exact /review comment on a pull request', () => {
    const request = parseRequest('issue_comment', {
      ...REVIEW_EVENT,
      comment: { ...REVIEW_EVENT.comment, body: '/review model=deepseek-v4-pro#max' },
    });
    expect(request).toMatchObject({
      pr: 886,
      modelInput: 'deepseek-v4-pro#max',
      actor: 'maintainer',
      association: 'MEMBER',
    });
  });

  it('accepts /review with a trailing newline', () => {
    const request = parseRequest('issue_comment', {
      ...REVIEW_EVENT,
      comment: { ...REVIEW_EVENT.comment, body: '/review\n' },
    });
    expect(request).toMatchObject({ pr: 886, command: 'review' });
  });

  it('ignores a comment on an issue', () => {
    expect(() =>
      parseRequest('issue_comment', {
        issue: { number: 1 },
        comment: { body: '/review' },
      }),
    ).toThrow('not a pull request');
  });

  it('accepts /review approve', () => {
    const request = parseRequest('issue_comment', {
      ...REVIEW_EVENT,
      comment: { ...REVIEW_EVENT.comment, body: '/review approve' },
    });
    expect(request).toMatchObject({ pr: 886, command: 'approve' });
  });

  it('accepts /review approve with a model', () => {
    const request = parseRequest('issue_comment', {
      ...REVIEW_EVENT,
      comment: { ...REVIEW_EVENT.comment, body: '/review approve model=deepseek-v4-pro#high' },
    });
    expect(request).toMatchObject({
      pr: 886,
      command: 'approve',
      modelInput: 'deepseek-v4-pro#high',
    });
  });

  it('keeps plain /review as a review command', () => {
    const request = parseRequest('issue_comment', REVIEW_EVENT);
    expect(request).toMatchObject({ pr: 886, command: 'review' });
  });

  it('ignores a comment that is not exactly /review', () => {
    expect(() =>
      parseRequest('issue_comment', {
        issue: { number: 1, pull_request: {} },
        comment: { body: '/review please' },
      }),
    ).toThrow('not a review request');
  });

  it('keeps manual dispatch review-only', () => {
    const request = parseRequest('workflow_dispatch', {
      inputs: { pr: '886', command: 'approve' },
    });
    expect(request).toMatchObject({
      pr: 886,
      command: 'review',
      source: 'workflow_dispatch',
    });
  });
});

describe('PR review request resolution', () => {
  it('accepts a maintainer same-repo open PR', async () => {
    const requests: string[] = [];
    const baseFetch = fakeGitHub();
    /**
     * Record each requested URL and delegate to the fake.
     * @param input - Fetch input.
     * @param init - Fetch options.
     * @returns Fake response.
     */
    const fetchImpl: typeof fetch = (input, init) => {
      const url = urlOf(input);
      requests.push(url);
      return baseFetch(input, init);
    };
    const result = await resolveRequest({
      eventName: 'issue_comment',
      event: REVIEW_EVENT,
      repo: 'sergienko4/repo',
      token: 'token',
      config: CONFIG,
      fetchImpl,
    });
    expect(result).toMatchObject({
      allowed: true,
      pr: 886,
      model: 'opencode-go/deepseek-v4.1-flash#high',
      headSha: 'head-sha',
    });
    expect(requests).toContain('https://api.github.com/repos/sergienko4/repo/pulls/886');
  });

  it('refuses an association outside the allow-list before any API call', async () => {
    const requests: string[] = [];
    /**
     * Record a call and answer with an empty object.
     * @param input - Fetch input.
     * @returns Empty response.
     */
    const fetchImpl: typeof fetch = input => {
      const url = urlOf(input);
      requests.push(url);
      return responseTo({});
    };
    const result = await resolveRequest({
      eventName: 'issue_comment',
      event: { ...REVIEW_EVENT, comment: { ...REVIEW_EVENT.comment, author_association: 'NONE' } },
      repo: 'sergienko4/repo',
      token: 'token',
      config: CONFIG,
      fetchImpl,
    });
    expect(result).toMatchObject({ allowed: false, reason: 'actor is not a maintainer' });
    expect(requests).toHaveLength(0);
  });

  it('refuses a fork pull request', async () => {
    /**
     * Answer the permission check and return a fork PR.
     * @param input - Fetch input.
     * @returns Fake response.
     */
    const fetchImpl: typeof fetch = input => {
      const url = urlOf(input);
      if (url.includes('/collaborators/')) return responseTo({ permission: 'write' });
      return responseTo({
        state: 'open',
        base: { sha: 'base' },
        head: { sha: 'head', ref: 'feature', repo: { full_name: 'fork/repo' } },
      });
    };
    const result = await resolveRequest({
      eventName: 'issue_comment',
      event: REVIEW_EVENT,
      repo: 'sergienko4/repo',
      token: 'token',
      config: CONFIG,
      fetchImpl,
    });
    expect(result).toMatchObject({ allowed: false, reason: 'fork pull request is not supported' });
  });
});

describe('PR review data fetch', () => {
  it('writes metadata, diff and changed file contents', async () => {
    const reviewRoot = '.review';
    await mkdir(reviewRoot, { recursive: true });
    const tempPath = join(reviewRoot, 'pr-review-');
    const dir = await mkdtemp(tempPath);
    try {
      const summary = await fetchPrData({
        repo: 'sergienko4/repo',
        pr: 886,
        token: 'token',
        outDir: dir,
        maxDiffChars: 1000,
        maxFileChars: 1000,
        expectedHeadSha: 'head-sha',
        fetchImpl: fakeGitHub(),
      });
      expect(summary).toEqual({ files: 1, skipped: 0, diffTruncated: false });
      const metadataPath = join(dir, 'metadata.json');
      const metadataText = await readFile(metadataPath, 'utf8');
      const metadata: unknown = JSON.parse(metadataText);
      expect(metadata).toMatchObject({
        number: 886,
        headSha: 'head-sha',
        changedFiles: 1,
        files: [{ path: 'src/a.ts', dataFile: 'file-000.txt' }],
      });
      const changedPath = join(dir, 'files/file-000.txt');
      const changedFile = await readFile(changedPath, 'utf8');
      expect(changedFile).toBe('changed');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('uses default limits when configuration values are not finite', async () => {
    const reviewRoot = '.review';
    await mkdir(reviewRoot, { recursive: true });
    const tempPath = join(reviewRoot, 'pr-review-');
    const dir = await mkdtemp(tempPath);
    try {
      const summary = await fetchPrData({
        repo: 'sergienko4/repo',
        pr: 886,
        token: 'token',
        outDir: dir,
        maxDiffChars: Number.NaN,
        maxFileChars: Number.NaN,
        maxFiles: Number.NaN,
        expectedHeadSha: 'head-sha',
        fetchImpl: fakeGitHub(),
      });
      expect(summary).toEqual({ files: 1, skipped: 0, diffTruncated: false });
      const diffPath = join(dir, 'diff.patch');
      const changedFilePath = join(dir, 'files/file-000.txt');
      const diff = await readFile(diffPath, 'utf8');
      const changedFile = await readFile(changedFilePath, 'utf8');
      expect(diff).toContain('diff --git');
      expect(changedFile).toBe('changed');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('PR review data consistency', () => {
  it('refuses when the PR head changed after resolution', async () => {
    const pending = fetchPrData({
      repo: 'sergienko4/repo',
      pr: 886,
      token: 'token',
      outDir: '.review/pr-changed',
      maxDiffChars: 1000,
      maxFileChars: 1000,
      expectedHeadSha: 'older-sha',
      fetchImpl: fakeGitHub(),
    });
    await expect(pending).rejects.toThrow('pull request changed during review');
  });
});

describe('PR review sensitive data', () => {
  it.each([
    '.env',
    'nested/.env.local',
    'certs/service.pem',
    'id_rsa',
    '.npmrc',
    '.git-credentials',
  ])('marks %s as sensitive', path => {
    const isSensitive = isSensitivePath(path);
    expect(isSensitive).toBe(true);
  });

  it('marks a renamed file when its previous path was sensitive', () => {
    const file = { filename: 'src/a.ts', previous_filename: '.env' };
    const isSensitive = isSensitiveFile(file);
    expect(isSensitive).toBe(true);
  });

  it('drops a renamed sensitive file block from the diff', () => {
    const diff = [
      'diff --git a/.env b/src/a.ts',
      'similarity index 100%',
      'rename from .env',
      'rename to src/a.ts',
      'diff --git a/src/b.ts b/src/b.ts',
      '--- a/src/b.ts',
      '+++ b/src/b.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new',
    ].join('\n');
    const filtered = filterDiff(diff);
    expect(filtered).not.toContain('rename from .env');
    expect(filtered).toContain('src/b.ts');
  });

  it('drops sensitive file blocks from the diff', () => {
    const diff = [
      'diff --git a/.env b/.env',
      '--- a/.env',
      '+++ b/.env',
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
    const filtered = filterDiff(diff);
    expect(filtered).not.toContain('NEW_SECRET');
    expect(filtered).toContain('src/a.ts');
  });

  it('drops a Git-quoted credential path', () => {
    const diff = [
      'diff --git "a/\\056env.local" "b/\\056env.local"',
      '--- "a/\\056env.local"',
      '+++ "b/\\056env.local"',
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
    const filtered = filterDiff(diff);
    expect(filtered).not.toContain('NEW_SECRET');
    expect(filtered).toContain('src/a.ts');
  });

  it('drops a file block whose paths cannot be parsed', () => {
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
    const filtered = filterDiff(diff);
    expect(filtered).not.toContain('NEW_SECRET');
    expect(filtered).toContain('src/a.ts');
  });

  it.each([
    '-----BEGIN RSA PRIVATE KEY-----',
    'AKIA1234567890ABCDEF',
    `ghp_${'a'.repeat(36)}`,
    `sk-${'b'.repeat(24)}`,
    `sk-proj-${'c'.repeat(24)}`,
    'https://user:password@example.test/repo.git',
    'https://:password@example.test/repo.git',
    'https://deploy-token@example.test/repo.git',
    'https://deploy-token:@example.test/repo.git',
    'HTTPS://user:password@example.test/repo.git',
    'https://user,pass@example.test/repo.git',
    "https://user'pass@example.test/repo.git",
    '+https://user:password@example.test/repo.git',
    '-https://user:password@example.test/repo.git',
  ])('detects credential content %s', text => {
    const isCredential = hasCredentialContent(text);
    expect(isCredential).toBe(true);
  });

  it('does not treat query or fragment text as credentials', () => {
    const hasQueryCredential = hasCredentialContent('https://example.test?label=a:b@public.test');
    const hasFragmentCredential = hasCredentialContent(
      'https://example.test#label=a:b@public.test',
    );
    expect(hasQueryCredential).toBe(false);
    expect(hasFragmentCredential).toBe(false);
  });

  it('does not join an adjacent URL and email into one credential', () => {
    const text = '{"homepage":"https://example.test","email":"maintainer@example.test"}';
    const isCredential = hasCredentialContent(text);
    expect(isCredential).toBe(false);
  });

  it('does not cross a closing single quote into an adjacent email', () => {
    const text = "'https://example.test','email':'maintainer@example.test'";
    const isCredential = hasCredentialContent(text);
    expect(isCredential).toBe(false);
  });

  it('detects a credential URL inside single quotes', () => {
    const text = "'https://user:pass@example.test/repo.git'";
    const isCredential = hasCredentialContent(text);
    expect(isCredential).toBe(true);
  });

  it('detects a credential URL with an escaped apostrophe', () => {
    const text = "'https://user\\'pass@example.test/repo.git'";
    const isCredential = hasCredentialContent(text);
    expect(isCredential).toBe(true);
  });

  it('scans a long dotted non-URL string without matching', () => {
    const text = 'a.'.repeat(32000);
    const isCredential = hasCredentialContent(text);
    expect(isCredential).toBe(false);
  });

  it('drops a normal-named file block that contains a credential', () => {
    const diff = [
      'diff --git a/src/config.ts b/src/config.ts',
      '--- a/src/config.ts',
      '+++ b/src/config.ts',
      '@@ -1 +1 @@',
      '-old',
      '+const key = "AKIA1234567890ABCDEF";',
    ].join('\n');
    const filtered = filterDiff(diff);
    expect(filtered).not.toContain('AKIA');
  });

  it.each(['+', '-'])('drops a block with a credential URL at a %s line start', prefix => {
    const diff = [
      'diff --git a/src/remote.ts b/src/remote.ts',
      '--- a/src/remote.ts',
      '+++ b/src/remote.ts',
      '@@ -1 +1 @@',
      `${prefix}const remote = "https://user:password@example.test/repo.git";`,
    ].join('\n');
    const filtered = filterDiff(diff);
    expect(filtered).not.toContain('example.test');
  });

  it.each([
    'HTTPS://user:password@example.test/repo.git',
    'https://:password@example.test/repo.git',
    'https://deploy-token@example.test/repo.git',
    'https://deploy-token:@example.test/repo.git',
  ])('drops a file block with a credential URL %s', url => {
    const diff = [
      'diff --git a/src/remote.ts b/src/remote.ts',
      '--- a/src/remote.ts',
      '+++ b/src/remote.ts',
      '@@ -1 +1 @@',
      '-old',
      `+const remote = "${url}";`,
    ].join('\n');
    const filtered = filterDiff(diff);
    expect(filtered).not.toContain(url);
  });

  it('drops a copy whose destination is sensitive', () => {
    const diff = [
      'diff --git a/src/a.ts b/.env',
      'similarity index 100%',
      'copy from src/a.ts',
      'copy to .env',
    ].join('\n');
    const filtered = filterDiff(diff);
    expect(filtered).not.toContain('copy from');
  });

  it('keeps a deletion whose destination is /dev/null', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-gone',
    ].join('\n');
    const filtered = filterDiff(diff);
    expect(filtered).toContain('src/a.ts');
  });
});

describe('PR review snapshot consistency', () => {
  it('refuses when the head changes while data is fetched', async () => {
    let metadataCalls = 0;
    const catalog = catalogResponse();
    const files = responseTo([{ filename: 'src/a.ts', status: 'modified', sha: 'blob-sha' }]);
    const blobs = responseTo({ encoding: 'base64', size: 1, content: 'eA==' });
    const diff = Promise.resolve(new Response('diff\n'));
    /**
     * Answer the catalog and change the head on the final metadata call.
     * @param input - Fetch input.
     * @param init - Fetch options.
     * @returns Fake response.
     */
    const fetchImpl: typeof fetch = (input, init) => {
      const url = urlOf(input);
      const accept = acceptOf(init);
      if (url.includes('inference/go/v1/models')) return catalog;
      if (url.includes('/files')) return files;
      if (url.includes('/git/blobs/')) return blobs;
      if (accept.includes('diff')) return diff;
      metadataCalls += 1;
      return metadataResponse(metadataCalls === 1 ? 'head-sha' : 'new-head-sha');
    };
    const pending = fetchPrData({
      repo: 'sergienko4/repo',
      pr: 886,
      token: 'token',
      outDir: '.review/pr-changed-fetch',
      maxDiffChars: 1000,
      maxFileChars: 1000,
      expectedHeadSha: 'head-sha',
      expectedBaseSha: 'base-sha',
      fetchImpl,
    });
    await expect(pending).rejects.toThrow('pull request changed during review');
  });
});
