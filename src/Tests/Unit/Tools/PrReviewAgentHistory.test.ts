/**
 * Unit tests for review-history matching and duplicate-trigger posting.
 * No network is used; the GitHub API is a local fake.
 */

import { postReview } from '../../../../.github/scripts/pr-review/post-review.mjs';
import { responseTo, urlOf } from './PrReviewAgentTestUtils.js';

describe('PR review history and duplicate triggers', () => {
  it('posts when an earlier review mentions a longer comment ID', async () => {
    const posts: string[] = [];
    /**
     * Serve a review for comment 999 and capture any new post.
     * @param input - Fetch input.
     * @param init - Fetch options.
     * @returns Fake response.
     */
    const fetchImpl: typeof fetch = (input, init) => {
      const url = urlOf(input);
      if (url.includes('/reviews?') && (init?.method ?? 'GET') === 'GET') {
        return responseTo([
          {
            id: 33,
            user: { login: 'review-agent[bot]' },
            body: '<!-- opencode-review-agent event=COMMENT comment=999 -->',
            submitted_at: '2026-01-01T00:00:00Z',
          },
        ]);
      }
      if (url.endsWith('/reviews') && init?.method === 'POST') {
        posts.push(url);
        return responseTo({ id: 34, html_url: 'https://example.test/review' });
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
    expect(posted).toMatchObject({ id: 34 });
    expect(posts).toHaveLength(1);
  });

  it('resumes a pending dismissal when the trigger is a duplicate', async () => {
    const dismissals: string[] = [];
    const posts: string[] = [];
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
          {
            id: 35,
            state: 'COMMENTED',
            commit_id: 'head',
            user: { login: 'review-agent[bot]' },
            body: '<!-- opencode-review-agent event=COMMENT comment=99 -->',
            submitted_at: '2026-01-02T00:00:00Z',
          },
        ]);
      }
      if (url.includes('/dismissals')) {
        dismissals.push(url);
        return responseTo({});
      }
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
        posts.push(url);
        return responseTo({ id: 36, html_url: 'https://example.test/review' });
      }
      return responseTo([]);
    };
    /**
     * Route the request by method.
     * @param input - Fetch input.
     * @param init - Fetch options.
     * @returns Fake response.
     */
    const fetchImpl: typeof fetch = (input, init) => {
      const url = urlOf(input);
      return init?.method === 'POST' ? postResponse(url) : getResponse(url);
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
      dismissBlocking: true,
      fetchImpl,
    });
    expect(posted).toMatchObject({ id: 35 });
    expect(dismissals).toEqual([
      'https://api.github.com/repos/sergienko4/repo/pulls/886/reviews/7/dismissals',
    ]);
    expect(posts).toHaveLength(0);
  });

  it('does not dismiss an earlier block for a duplicate blocking review', async () => {
    const dismissals: string[] = [];
    /**
     * Serve a duplicate blocking review and capture dismissals.
     * @param input - Fetch input.
     * @param init - Fetch options.
     * @returns Fake response.
     */
    const fetchImpl: typeof fetch = (input, init) => {
      const url = urlOf(input);
      if (url.includes('/reviews?') && (init?.method ?? 'GET') === 'GET') {
        return responseTo([
          {
            id: 7,
            state: 'CHANGES_REQUESTED',
            user: { login: 'review-agent[bot]' },
            body: '<!-- opencode-review-agent event=REQUEST_CHANGES comment=old -->',
            submitted_at: '2026-01-01T00:00:00Z',
          },
          {
            id: 38,
            state: 'CHANGES_REQUESTED',
            commit_id: 'head',
            user: { login: 'review-agent[bot]' },
            body: '<!-- opencode-review-agent event=REQUEST_CHANGES comment=99 -->',
            submitted_at: '2026-01-02T00:00:00Z',
          },
        ]);
      }
      if (url.includes('/dismissals')) {
        dismissals.push(url);
        return responseTo({});
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
      dismissBlocking: true,
      fetchImpl,
    });
    expect(posted).toMatchObject({ id: 38 });
    expect(dismissals).toEqual([]);
  });

  it('dismisses only blocks older than the resumed review', async () => {
    const dismissals: string[] = [];
    /**
     * Serve an older block, the duplicate, and a newer block.
     * @param input - Fetch input.
     * @param init - Fetch options.
     * @returns Fake response.
     */
    const fetchImpl: typeof fetch = (input, init) => {
      const url = urlOf(input);
      if (url.includes('/reviews?') && (init?.method ?? 'GET') === 'GET') {
        return responseTo([
          {
            id: 7,
            state: 'CHANGES_REQUESTED',
            user: { login: 'review-agent[bot]' },
            body: '<!-- opencode-review-agent event=REQUEST_CHANGES comment=old -->',
            submitted_at: '2026-01-01T00:00:00Z',
          },
          {
            id: 35,
            state: 'COMMENTED',
            commit_id: 'head',
            user: { login: 'review-agent[bot]' },
            body: '<!-- opencode-review-agent event=COMMENT comment=99 -->',
            submitted_at: '2026-01-02T00:00:00Z',
          },
          {
            id: 40,
            state: 'CHANGES_REQUESTED',
            commit_id: 'head',
            user: { login: 'review-agent[bot]' },
            body: '<!-- opencode-review-agent event=REQUEST_CHANGES comment=newer -->',
            submitted_at: '2026-01-03T00:00:00Z',
          },
        ]);
      }
      if (url.endsWith('/pulls/886') && (init?.method ?? 'GET') === 'GET') {
        return responseTo({ state: 'open', head: { sha: 'head' } });
      }
      if (url.includes('/dismissals')) {
        dismissals.push(url);
        return responseTo({});
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
      dismissBlocking: true,
      fetchImpl,
    });
    expect(posted).toMatchObject({ id: 35 });
    expect(dismissals).toEqual([
      'https://api.github.com/repos/sergienko4/repo/pulls/886/reviews/7/dismissals',
    ]);
  });

  it('skips duplicate cleanup when the live head changed', async () => {
    const dismissals: string[] = [];
    /**
     * Serve the duplicate and an advanced live head.
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
            id: 7,
            state: 'CHANGES_REQUESTED',
            user: { login: 'review-agent[bot]' },
            body: '<!-- opencode-review-agent event=REQUEST_CHANGES comment=old -->',
            submitted_at: '2026-01-01T00:00:00Z',
          },
          {
            id: 35,
            state: 'COMMENTED',
            commit_id: 'head',
            user: { login: 'review-agent[bot]' },
            body: '<!-- opencode-review-agent event=COMMENT comment=99 -->',
            submitted_at: '2026-01-02T00:00:00Z',
          },
        ]);
      }
      if (url.endsWith('/pulls/886') && method === 'GET') {
        return responseTo({ state: 'open', head: { sha: 'new-head' } });
      }
      if (url.includes('/dismissals')) {
        dismissals.push(url);
        return responseTo({});
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
      dismissBlocking: true,
      recheckHead: true,
      fetchImpl,
    });
    expect(posted).toMatchObject({ id: 35 });
    expect(dismissals).toEqual([]);
  });

  it('fails closed when the review history exceeds the page cap', async () => {
    const posts: string[] = [];
    /**
     * Serve a full page of reviews on every request.
     * @param input - Fetch input.
     * @param init - Fetch options.
     * @returns Fake response.
     */
    const fetchImpl: typeof fetch = (input, init) => {
      const url = urlOf(input);
      if (url.includes('/reviews?') && (init?.method ?? 'GET') === 'GET') {
        const page = Array.from({ length: 100 }, (_, index) => ({
          id: index + 1,
          user: { login: 'someone' },
          body: 'review',
          submitted_at: '2026-01-01T00:00:00Z',
        }));
        return responseTo(page);
      }
      if (url.endsWith('/reviews') && init?.method === 'POST') {
        posts.push(url);
        return responseTo({ id: 37, html_url: 'https://example.test/review' });
      }
      return responseTo([]);
    };
    const pending = postReview({
      repo: 'sergienko4/repo',
      pr: 886,
      token: 'token',
      headSha: 'head',
      summary: 'ok',
      inline: [],
      overflow: [],
      event: 'APPROVE',
      appLogin: 'review-agent[bot]',
      commentId: '99',
      fetchImpl,
    });
    await expect(pending).rejects.toThrow('review history is incomplete');
    expect(posts).toHaveLength(0);
  });
});
