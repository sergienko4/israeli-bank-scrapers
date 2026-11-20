/**
 * Unit tests for the on-demand PR review scripts. They pin the pure parts:
 * trigger parsing, model allow-list, diff-to-line mapping, review schema and
 * output sanitization. No network or GitHub call is made.
 */

import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { fetchPrData, truncateDiff } from '../../../../.github/scripts/pr-review/fetch-pr.mjs';
import {
  mapFindings,
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
      return responseTo([{ filename: 'src/a.ts', status: 'modified', additions: 1, deletions: 0 }]);
    }
    if (url.includes('/contents/')) {
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
      expect(metadata).toMatchObject({ number: 886, headSha: 'head-sha', changedFiles: 1 });
      const changedPath = join(dir, 'files/src/a.ts');
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
});
