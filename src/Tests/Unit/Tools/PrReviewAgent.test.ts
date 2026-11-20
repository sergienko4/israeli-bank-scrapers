/**
 * Unit tests for the on-demand PR review scripts. They pin the pure parts:
 * trigger parsing, model allow-list, diff-to-line mapping, review schema and
 * output sanitization. No network or GitHub call is made.
 */

import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import {
  fetchPrData,
  filterDiff,
  isSensitiveFile,
  isSensitivePath,
  truncateDiff,
} from '../../../../.github/scripts/pr-review/fetch-pr.mjs';
import {
  mapFindings,
  markCreated,
  parseAddedLines,
  parseReview,
  validateReview,
} from '../../../../.github/scripts/pr-review/post-review.mjs';
import {
  normalizeModel,
  parseRequest,
  resolveRequest,
} from '../../../../.github/scripts/pr-review/resolve-request.mjs';
import { sanitizeText } from '../../../../.github/scripts/pr-review/shared.mjs';

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
 * Read a fetch input URL without the `[object Object]` default.
 * @param input - Fetch input.
 * @returns URL text.
 */
function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
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

  it('ignores a comment on an issue', () => {
    expect(() =>
      parseRequest('issue_comment', {
        issue: { number: 1 },
        comment: { body: '/review' },
      }),
    ).toThrow('not a pull request');
  });

  it('ignores a comment that is not exactly /review', () => {
    expect(() =>
      parseRequest('issue_comment', {
        issue: { number: 1, pull_request: {} },
        comment: { body: '/review please' },
      }),
    ).toThrow('not a review request');
  });

  it('reads a manual dispatch PR number', () => {
    const request = parseRequest('workflow_dispatch', { inputs: { pr: '886' } });
    expect(request).toMatchObject({ pr: 886, source: 'workflow_dispatch' });
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
  it.each(['.env', 'nested/.env.local', 'certs/service.pem', 'id_rsa', '.npmrc'])(
    'marks %s as sensitive',
    path => {
      const isSensitive = isSensitivePath(path);
      expect(isSensitive).toBe(true);
    },
  );

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

describe('PR review diff mapping', () => {
  it('maps added lines and ignores deleted or context lines', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -10,2 +10,3 @@',
      ' context',
      '+added',
      '-removed',
      ' tail',
      'diff --git a/src/b.ts b/src/b.ts',
      '--- /dev/null',
      '+++ b/src/b.ts',
      '@@ -0,0 +1,1 @@',
      '+first',
    ].join('\n');
    const added = parseAddedLines(diff);
    const firstLines = added.get('src/a.ts');
    const newFileLines = added.get('src/b.ts');
    expect(firstLines).toEqual(new Set([11]));
    expect(newFileLines).toEqual(new Set([1]));
  });

  it('does not treat added hunk text as a file header', () => {
    const diff = [
      'diff --git a/a.txt b/a.txt',
      '--- a/a.txt',
      '+++ b/a.txt',
      '@@ -1,1 +1,3 @@',
      ' base',
      '+++ b/evil.txt',
      '+next',
    ].join('\n');
    const added = parseAddedLines(diff);
    const addedLines = added.get('a.txt');
    const hasEvil = added.has('evil.txt');
    expect(addedLines).toEqual(new Set([2, 3]));
    expect(hasEvil).toBe(false);
  });

  it('moves an unmapped finding into the summary and caps inline findings', () => {
    const findings = [
      { severity: 'critical', path: 'a.ts', line: 1, title: 'one', body: 'b', rule: '' },
      { severity: 'important', path: 'a.ts', line: 2, title: 'two', body: 'b', rule: '' },
      { severity: 'suggestion', path: 'a.ts', line: 3, title: 'three', body: 'b', rule: '' },
    ];
    const added = new Map([['a.ts', new Set([1, 2])]]);
    const split = mapFindings(findings, added, 1);
    const inlineTitles = split.inline.map(finding => finding.title);
    const overflowTitles = split.overflow.map(finding => finding.title);
    expect(inlineTitles).toEqual(['one']);
    expect(overflowTitles).toEqual(['two', 'three']);
  });
});

describe('PR review schema and sanitization', () => {
  it('strips a JSON fence and validates findings', () => {
    const parsed = parseReview('```json\n{"summary":"ok","guidelines_read":[],"findings":[]}\n```');
    const review = validateReview(parsed, 10);
    expect(review).toEqual({ summary: 'ok', guidelines_read: [], findings: [] });
  });

  it.each([
    [{ summary: '', findings: [] }, 'summary length'],
    [{ summary: 'ok', findings: {} }, 'findings is not an array'],
    [
      {
        summary: 'ok',
        findings: [{ severity: 'blocker', path: 'a', line: 1, title: 't', body: 'b' }],
      },
      'finding severity',
    ],
  ])('refuses invalid review %#', (value, message) => {
    expect(() => validateReview(value, 10)).toThrow(message);
  });

  it('keeps the most severe findings when the cap applies', () => {
    const review = validateReview(
      {
        summary: 'ok',
        findings: [
          { severity: 'suggestion', path: 'a', line: 1, title: 'low', body: 'b' },
          { severity: 'critical', path: 'a', line: 2, title: 'high', body: 'b' },
          { severity: 'important', path: 'a', line: 3, title: 'mid', body: 'b' },
        ],
      },
      2,
    );
    const titles = review.findings.map(finding => finding.title);
    expect(titles).toEqual(['high', 'mid']);
  });

  it('escapes HTML and blocks dangerous links', () => {
    const safe = sanitizeText('<script>x</script> [click](javascript:alert(1))');
    expect(safe).toContain('&lt;script>');
    expect(safe).not.toContain('javascript:');
    expect(safe).toContain('blocked link');
  });

  it('truncates a diff at a line boundary', () => {
    const capped = truncateDiff('a\nb\nc\n', 4);
    expect(capped.truncated).toBe(true);
    expect(capped.text).toBe('a\nb\n\n[... diff truncated ...]\n');
  });

  it('records that a review was created for the workflow', async () => {
    await mkdir('.review', { recursive: true });
    const tempPrefix = join('.review', 'pr-review-output-');
    const dir = await mkdtemp(tempPrefix);
    const output = join(dir, 'output');
    const previous = process.env.GITHUB_OUTPUT;
    process.env.GITHUB_OUTPUT = output;
    try {
      await markCreated();
      expect(await readFile(output, 'utf8')).toBe('created=true\n');
    } finally {
      delete process.env.GITHUB_OUTPUT;
      if (previous !== undefined) process.env.GITHUB_OUTPUT = previous;
      await rm(dir, { recursive: true, force: true });
    }
  });
});
