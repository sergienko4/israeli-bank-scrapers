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
  mapFindings,
  markCreated,
  parseAddedLines,
  parseReview,
  postReview,
  validateReview,
} from '../../../../.github/scripts/pr-review/post-review.mjs';
import { sanitizeText } from '../../../../.github/scripts/pr-review/shared.mjs';

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
