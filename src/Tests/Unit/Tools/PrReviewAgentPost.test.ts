/**
 * Unit tests for diff line mapping, review extraction and review posting.
 * No network is used; the GitHub API is a local fake.
 */

import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { extractText } from '../../../../.github/scripts/pr-review/extract-review.mjs';
import { truncateDiff } from '../../../../.github/scripts/pr-review/fetch-pr.mjs';
import {
  buildReview,
  isPostedComplete,
  mapFindings,
  markCreated,
  parseAddedLines,
  parseReview,
  postFailure,
  postReview,
  selectPresentationFindings,
  validateReview,
} from '../../../../.github/scripts/pr-review/post-review.mjs';
import { sanitizeText } from '../../../../.github/scripts/pr-review/shared.mjs';
import { responseTo, urlOf } from './PrReviewAgentTestUtils.js';

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

  it('attributes added lines to a Git-quoted file path', () => {
    const diff = [
      'diff --git "a/src/old name.ts" "b/src/new name.ts"',
      '--- "a/src/old name.ts"',
      '+++ "b/src/new name.ts"',
      '@@ -1,1 +1,2 @@',
      ' base',
      '+added',
    ].join('\n');
    const added = parseAddedLines(diff);
    const newLines = added.get('src/new name.ts');
    const hasOld = added.has('src/old name.ts');
    expect(newLines).toEqual(new Set([2]));
    expect(hasOld).toBe(false);
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

describe('PR review extraction and posting', () => {
  it('joins text events and ignores partial or non-text lines', () => {
    const stream = [
      JSON.stringify({ type: 'text', part: { text: 'hello ' } }),
      '{"type":"text"',
      JSON.stringify({ type: 'tool', part: { text: 'ignored' } }),
      JSON.stringify({ type: 'text', part: { text: 'world' } }),
    ].join('\n');
    const text = extractText(stream);
    expect(text).toBe('hello world');
  });

  it('builds one COMMENT review with RIGHT-side inline comments', () => {
    const payload = buildReview({
      headSha: 'head',
      summary: 'ok',
      inline: [{ path: 'a.ts', line: 2, title: 't', body: 'b', rule: '' }],
      overflow: [],
    });
    expect(payload).toMatchObject({
      commit_id: 'head',
      event: 'COMMENT',
      comments: [{ path: 'a.ts', line: 2, side: 'RIGHT', body: '**t**\n\nb' }],
    });
  });

  it('builds a REQUEST_CHANGES review when findings are blocking', () => {
    const payload = buildReview({
      headSha: 'head',
      summary: 'blocking',
      inline: [],
      overflow: [],
      event: 'REQUEST_CHANGES',
    });
    expect(payload.event).toBe('REQUEST_CHANGES');
  });

  it('builds an APPROVE review only when explicitly requested', () => {
    const payload = buildReview({
      headSha: 'head',
      summary: 'clean',
      inline: [],
      overflow: [],
      event: 'APPROVE',
    });
    expect(payload.event).toBe('APPROVE');
  });

  it('records completeness in the review marker', () => {
    const complete = buildReview({
      headSha: 'head',
      summary: 'clean',
      inline: [],
      overflow: [],
      reviewComplete: true,
    });
    const incomplete = buildReview({
      headSha: 'head',
      summary: 'clean',
      inline: [],
      overflow: [],
      reviewComplete: false,
    });
    expect(complete.body).toContain('complete=true');
    expect(incomplete.body).toContain('complete=false');
  });

  it('requires metadata and the model to agree on completeness', () => {
    const metadata = {
      diffTruncated: false,
      credentialContent: false,
      skippedFiles: [],
      sensitiveFiles: [],
      changedFiles: 1,
      files: [{ path: 'src/a.ts' }],
    };
    const config = { maxFiles: 300 };
    const truncated = { ...metadata, diffTruncated: true };
    const isComplete = isPostedComplete({ complete: true }, metadata, config);
    const isIncompleteByMetadata = isPostedComplete({ complete: true }, truncated, config);
    const isIncompleteByModel = isPostedComplete({ complete: false }, metadata, config);
    expect(isComplete).toBe(true);
    expect(isIncompleteByMetadata).toBe(false);
    expect(isIncompleteByModel).toBe(false);
  });

  it('keeps blocker details beyond the presentation cap', () => {
    const findings = Array.from({ length: 30 }, (_, index) => ({
      severity: 'critical',
      path: 'src/a.ts',
      line: index + 1,
      title: `Critical ${String(index)}`,
      body: 'Body',
    }));
    findings.push({
      severity: 'important',
      path: 'src/a.ts',
      line: 31,
      title: 'Only blocker',
      body: 'Body',
    });
    const selected = selectPresentationFindings(findings, {
      maxFindings: 30,
      blockingSeverities: ['important'],
    });
    const hasBlocker = selected.some(finding => finding.severity === 'important');
    expect(hasBlocker).toBe(true);
    expect(selected).toHaveLength(30);
  });

  it('rejects an unknown review event', () => {
    expect(() =>
      buildReview({
        headSha: 'head',
        summary: 'clean',
        inline: [],
        overflow: [],
        event: 'MERGE',
      }),
    ).toThrow('invalid review event');
  });

  it('dismisses the App earlier REQUEST_CHANGES before a COMMENT', async () => {
    const calls: { url: string; method: string; body: string }[] = [];
    /**
     * Serve a GET route.
     * @param url - Request URL.
     * @returns Fake response.
     */
    const getResponse = (url: string): Promise<Response> => {
      if (url.includes('/reviews?')) {
        return responseTo([
          {
            id: 7,
            state: 'CHANGES_REQUESTED',
            user: { login: 'review-agent[bot]' },
            body: '<!-- opencode-review-agent event=REQUEST_CHANGES comment=old -->',
            submitted_at: '2026-01-01T00:00:00Z',
          },
        ]);
      }
      if (url.includes('/dismissals')) return responseTo({});
      if (url.endsWith('/pulls/886')) {
        return responseTo({ state: 'open', head: { sha: 'head' } });
      }
      return responseTo([]);
    };
    /**
     * Serve a POST route.
     * @param url - Request URL.
     * @returns Fake response.
     */
    const postResponse = (url: string): Promise<Response> => {
      if (url.endsWith('/reviews')) {
        return responseTo({ id: 8, html_url: 'https://example.test/review' });
      }
      return responseTo([]);
    };
    /**
     * Record calls and route the request.
     * @param input - Fetch input.
     * @param init - Fetch options.
     * @returns Fake response.
     */
    const fetchImpl: typeof fetch = (input, init) => {
      const url = urlOf(input);
      const method = init?.method ?? 'GET';
      const rawBody = init?.body;
      const body = typeof rawBody === 'string' ? rawBody : '';
      calls.push({ url, method, body });
      return method === 'POST' ? postResponse(url) : getResponse(url);
    };
    await postReview({
      repo: 'sergienko4/repo',
      pr: 886,
      token: 'token',
      headSha: 'head',
      summary: 'ok',
      inline: [],
      overflow: [],
      event: 'COMMENT',
      appLogin: 'review-agent[bot]',
      commentId: '99',
      dismissBlocking: true,
      reviewComplete: true,
      fetchImpl,
    });
    const dismissal = calls.find(call => call.url.includes('/reviews/7/dismissals'));
    const hasGraphqlCall = calls.some(call => call.url.endsWith('/graphql'));
    expect(dismissal).toMatchObject({ method: 'PUT' });
    expect(dismissal?.body).toContain('Superseded by a newer review');
    expect(hasGraphqlCall).toBe(false);
  });

  it('relies on the latest review instead of dismissing on REQUEST_CHANGES', async () => {
    const dismissals: string[] = [];
    /**
     * Serve one earlier approval and capture any dismissal.
     * @param input - Fetch input.
     * @param init - Fetch options.
     * @returns Fake response.
     */
    const fetchImpl: typeof fetch = (input, init) => {
      const url = urlOf(input);
      const method = init?.method ?? 'GET';
      if (url.includes('/reviews?') && method === 'GET') {
        return responseTo([
          {
            id: 9,
            state: 'APPROVED',
            user: { login: 'review-agent[bot]' },
            body: '<!-- opencode-review-agent event=APPROVE comment=old -->',
            submitted_at: '2026-01-01T00:00:00Z',
          },
        ]);
      }
      if (url.includes('/dismissals')) {
        dismissals.push(url);
        return responseTo({});
      }
      if (url.endsWith('/reviews') && method === 'POST') {
        return responseTo({ id: 10, html_url: 'https://example.test/review' });
      }
      return responseTo([]);
    };
    await postReview({
      repo: 'sergienko4/repo',
      pr: 886,
      token: 'token',
      headSha: 'head',
      summary: 'blocking',
      inline: [],
      overflow: [],
      event: 'REQUEST_CHANGES',
      appLogin: 'review-agent[bot]',
      commentId: '99',
      fetchImpl,
    });
    expect(dismissals).toEqual([]);
  });

  it('keeps minimizing for the legacy github-actions identity', async () => {
    const calls: string[] = [];
    /**
     * Serve one earlier legacy review and capture the GraphQL call.
     * @param input - Fetch input.
     * @param init - Fetch options.
     * @returns Fake response.
     */
    const fetchImpl: typeof fetch = (input, init) => {
      const url = urlOf(input);
      calls.push(url);
      if (url.includes('/reviews?') && (init?.method ?? 'GET') === 'GET') {
        return responseTo([
          {
            id: 11,
            node_id: 'review-node',
            state: 'COMMENTED',
            user: { login: 'github-actions[bot]' },
            body: '<!-- opencode-review-agent -->',
            submitted_at: '2026-01-01T00:00:00Z',
          },
        ]);
      }
      if (url.endsWith('/graphql')) return responseTo({ data: {} });
      if (url.endsWith('/reviews') && init?.method === 'POST') {
        return responseTo({ id: 12, html_url: 'https://example.test/review' });
      }
      return responseTo([]);
    };
    await postReview({
      repo: 'sergienko4/repo',
      pr: 886,
      token: 'token',
      headSha: 'head',
      summary: 'ok',
      inline: [],
      overflow: [],
      event: 'COMMENT',
      fetchImpl,
    });
    const hasGraphqlCall = calls.some(url => url.endsWith('/graphql'));
    const hasDismissalCall = calls.some(url => url.includes('/dismissals'));
    expect(hasGraphqlCall).toBe(true);
    expect(hasDismissalCall).toBe(false);
  });

  it('does not post a second review for the same trigger comment', async () => {
    const posts: string[] = [];
    /**
     * Serve an existing review with the same trigger comment and capture posts.
     * @param input - Fetch input.
     * @param init - Fetch options.
     * @returns Fake response.
     */
    const fetchImpl: typeof fetch = (input, init) => {
      const url = urlOf(input);
      if (url.includes('/reviews?') && (init?.method ?? 'GET') === 'GET') {
        return responseTo([
          {
            id: 30,
            commit_id: 'head',
            user: { login: 'review-agent[bot]' },
            body: '<!-- opencode-review-agent event=COMMENT comment=99 complete=true -->',
            submitted_at: '2026-01-01T00:00:00Z',
          },
        ]);
      }
      if (url.endsWith('/reviews') && init?.method === 'POST') {
        posts.push(url);
        return responseTo({ id: 31, html_url: 'https://example.test/review' });
      }
      return responseTo([]);
    };
    const posted = await postReview({
      repo: 'sergienko4/repo',
      pr: 886,
      token: 'token',
      headSha: 'head',
      summary: 'ok',
      inline: [],
      overflow: [],
      event: 'COMMENT',
      appLogin: 'review-agent[bot]',
      commentId: '99',
      fetchImpl,
    });
    expect(posted).toMatchObject({ id: 30 });
    expect(posts).toHaveLength(0);
  });

  it('refuses to post when the live head changed', async () => {
    const posts: string[] = [];
    /**
     * Serve the review list, the changed live head and capture any post.
     * @param input - Fetch input.
     * @param init - Fetch options.
     * @returns Fake response.
     */
    const fetchImpl: typeof fetch = (input, init) => {
      const url = urlOf(input);
      const method = init?.method ?? 'GET';
      const isReviewList = url.includes('/reviews?') && method === 'GET';
      const isPullRequest = url.endsWith('/pulls/886') && method === 'GET';
      if (isReviewList) return responseTo([]);
      if (isPullRequest) return responseTo({ state: 'open', head: { sha: 'new-head' } });
      if (url.endsWith('/reviews') && init?.method === 'POST') {
        posts.push(url);
        return responseTo({ id: 32, html_url: 'https://example.test/review' });
      }
      return responseTo([]);
    };
    const pending = postReview({
      repo: 'sergienko4/repo',
      pr: 886,
      token: 'token',
      headSha: 'old-head',
      summary: 'ok',
      inline: [],
      overflow: [],
      event: 'APPROVE',
      appLogin: 'review-agent[bot]',
      commentId: '99',
      recheckHead: true,
      reviewComplete: true,
      fetchImpl,
    });
    await expect(pending).rejects.toThrow('pull request changed before posting');
    expect(posts).toHaveLength(0);
  });

  it('forces a failure review to COMMENT when the caller asks to approve', async () => {
    const bodies: Record<string, unknown>[] = [];
    /**
     * Serve no earlier reviews and capture the failure post.
     * @param input - Fetch input.
     * @param init - Fetch options.
     * @returns Fake response.
     */
    const fetchImpl: typeof fetch = (input, init) => {
      const url = urlOf(input);
      if (url.includes('/reviews?') && (init?.method ?? 'GET') === 'GET') {
        return responseTo([]);
      }
      if (url.endsWith('/reviews') && init?.method === 'POST') {
        const rawBody = init.body;
        const text = typeof rawBody === 'string' ? rawBody : '';
        const payload = JSON.parse(text) as Record<string, unknown>;
        bodies.push(payload);
        return responseTo({ id: 50, html_url: 'https://example.test/review' });
      }
      return responseTo([]);
    };
    await postFailure({
      repo: 'sergienko4/repo',
      pr: 886,
      token: 'token',
      headSha: 'head',
      message: 'The review run did not finish.',
      event: 'APPROVE',
      appLogin: 'review-agent[bot]',
      reviewComplete: true,
      fetchImpl,
    });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.event).toBe('COMMENT');
    const bodyValue = bodies[0]?.body;
    const body = typeof bodyValue === 'string' ? bodyValue : '';
    expect(body).toContain('Review failed');
    expect(body).toContain('complete=false');
  });

  it('posts the review exactly once', async () => {
    const bodies: Record<string, unknown>[] = [];
    /**
     * Answer the earlier-review list and the review POST.
     * @param input - Fetch input.
     * @param init - Fetch options.
     * @returns Fake response.
     */
    const fetchImpl: typeof fetch = (input, init) => {
      const url = urlOf(input);
      if (init?.method === 'POST' && url.endsWith('/reviews')) {
        const bodyText = typeof init.body === 'string' ? init.body : '';
        bodies.push(JSON.parse(bodyText) as Record<string, unknown>);
        return responseTo({ id: 1, html_url: 'https://example.test/review' });
      }
      return responseTo([]);
    };
    const posted = await postReview({
      repo: 'sergienko4/repo',
      pr: 886,
      token: 'token',
      headSha: 'head',
      summary: 'ok',
      inline: [],
      overflow: [],
      fetchImpl,
    });
    expect(posted).toEqual({
      id: 1,
      htmlUrl: 'https://example.test/review',
      inline: 0,
    });
    expect(bodies).toHaveLength(1);
    expect(bodies[0].event).toBe('COMMENT');
  });

  it('records creation before reading the review response', async () => {
    await mkdir('.review', { recursive: true });
    const tempPrefix = join('.review', 'pr-review-created-');
    const dir = await mkdtemp(tempPrefix);
    const output = join(dir, 'output');
    const previous = process.env.GITHUB_OUTPUT;
    process.env.GITHUB_OUTPUT = output;
    /**
     * Answer the earlier-review list and an unreadable review POST.
     * @param _input - Fetch input (unused).
     * @param init - Fetch options.
     * @returns Fake response.
     */
    const fetchImpl: typeof fetch = (_input, init) => {
      if (init?.method === 'POST') {
        return Promise.resolve(new Response('not json', { status: 201 }));
      }
      return responseTo([]);
    };
    try {
      const pending = postReview({
        repo: 'sergienko4/repo',
        pr: 886,
        token: 'token',
        headSha: 'head',
        summary: 'ok',
        inline: [],
        overflow: [],
        fetchImpl,
      });
      await expect(pending).rejects.toThrow();
      const outputText = await readFile(output, 'utf8');
      expect(outputText).toBe('created=true\n');
    } finally {
      delete process.env.GITHUB_OUTPUT;
      if (previous !== undefined) process.env.GITHUB_OUTPUT = previous;
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('PR review schema and sanitization', () => {
  it('strips a JSON fence and validates findings', () => {
    const parsed = parseReview(
      '```json\n{"summary":"ok","guidelines_read":[],"findings":[],"complete":true}\n```',
    );
    const review = validateReview(parsed, 10);
    expect(review).toEqual({
      summary: 'ok',
      guidelines_read: [],
      findings: [],
      complete: true,
    });
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
