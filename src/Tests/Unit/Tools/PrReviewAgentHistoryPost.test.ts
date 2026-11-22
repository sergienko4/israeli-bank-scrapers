/**
 * Unit tests for posting with review-history failures and races.
 * No network is used; the GitHub API is a local fake.
 */

import { postReview } from '../../../../.github/scripts/pr-review/post-review.mjs';
import { responseTo, urlOf } from './PrReviewAgentTestUtils.js';

describe('PR review history at posting', () => {
  it('posts even when the review history is unavailable', async () => {
    const posts: string[] = [];
    /**
     * Fail the history read and accept the new review.
     * @param input - Fetch input.
     * @param init - Fetch options.
     * @returns Fake response.
     */
    const fetchImpl: typeof fetch = (input, init) => {
      const url = urlOf(input);
      const method = init?.method ?? 'GET';
      if (url.includes('/reviews?') && method === 'GET') {
        return Promise.resolve(new Response('', { status: 500 }));
      }
      if (url.endsWith('/reviews') && method === 'POST') {
        posts.push(url);
        return responseTo({ id: 60, html_url: 'https://example.test/review' });
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
    expect(posted).toMatchObject({ id: 60 });
    expect(posts).toHaveLength(1);
  });

  it('refuses an approval when the review history is unavailable', async () => {
    const posts: string[] = [];
    /**
     * Fail the history read and capture any review post.
     * @param input - Fetch input.
     * @param init - Fetch options.
     * @returns Fake response.
     */
    const fetchImpl: typeof fetch = (input, init) => {
      const url = urlOf(input);
      const method = init?.method ?? 'GET';
      if (url.includes('/reviews?') && method === 'GET') {
        return Promise.resolve(new Response('', { status: 500 }));
      }
      if (url.endsWith('/reviews') && method === 'POST') {
        posts.push(url);
        return responseTo({ id: 61, html_url: 'https://example.test/review' });
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
      reviewComplete: true,
      appLogin: 'review-agent[bot]',
      commentId: '99',
      fetchImpl,
    });
    await expect(pending).rejects.toThrow('GitHub reviews answered 500');
    expect(posts).toHaveLength(0);
  });

  it('posts a comment when the review-history request rejects', async () => {
    const posts: string[] = [];
    /**
     * Reject the history read and accept the new comment.
     * @param input - Fetch input.
     * @param init - Fetch options.
     * @returns Fake response.
     */
    const fetchImpl: typeof fetch = (input, init) => {
      const url = urlOf(input);
      const method = init?.method ?? 'GET';
      if (url.includes('/reviews?') && method === 'GET') {
        return Promise.reject(new Error('network down'));
      }
      if (url.endsWith('/reviews') && method === 'POST') {
        posts.push(url);
        return responseTo({ id: 62, html_url: 'https://example.test/review' });
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
    expect(posted).toMatchObject({ id: 62 });
    expect(posts).toHaveLength(1);
  });

  it('posts a comment when the review-history body is invalid', async () => {
    const posts: string[] = [];
    /**
     * Serve an unparsable history body and accept the new comment.
     * @param input - Fetch input.
     * @param init - Fetch options.
     * @returns Fake response.
     */
    const fetchImpl: typeof fetch = (input, init) => {
      const url = urlOf(input);
      const method = init?.method ?? 'GET';
      if (url.includes('/reviews?') && method === 'GET') {
        return Promise.resolve(new Response('not json', { status: 200 }));
      }
      if (url.endsWith('/reviews') && method === 'POST') {
        posts.push(url);
        return responseTo({ id: 63, html_url: 'https://example.test/review' });
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
    expect(posted).toMatchObject({ id: 63 });
    expect(posts).toHaveLength(1);
  });

  it('refuses an approval when a same-head block exists', async () => {
    const posts: string[] = [];
    /**
     * Serve a same-head blocking review and capture any approval.
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
            commit_id: 'head',
            user: { login: 'review-agent[bot]' },
            body: '<!-- opencode-review-agent event=REQUEST_CHANGES comment=old -->',
            submitted_at: '2026-01-01T00:00:00Z',
          },
        ]);
      }
      if (url.endsWith('/reviews') && method === 'POST') {
        posts.push(url);
        return responseTo({ id: 64, html_url: 'https://example.test/review' });
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
      reviewComplete: true,
      appLogin: 'review-agent[bot]',
      commentId: '99',
      fetchImpl,
    });
    await expect(pending).rejects.toThrow('approval requires a new commit');
    expect(posts).toHaveLength(0);
  });

  it('posts a comment when review-history is not an array', async () => {
    const posts: string[] = [];
    /**
     * Serve a JSON value that is not a review list and accept the comment.
     * @param input - Fetch input.
     * @param init - Fetch options.
     * @returns Fake response.
     */
    const fetchImpl: typeof fetch = (input, init) => {
      const url = urlOf(input);
      const method = init?.method ?? 'GET';
      if (url.includes('/reviews?') && method === 'GET') {
        return responseTo('not an array');
      }
      if (url.endsWith('/reviews') && method === 'POST') {
        posts.push(url);
        return responseTo({ id: 65, html_url: 'https://example.test/review' });
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
    expect(posted).toMatchObject({ id: 65 });
    expect(posts).toHaveLength(1);
  });

  it('does not dismiss a block for an incomplete comment', async () => {
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
            commit_id: 'older',
            user: { login: 'review-agent[bot]' },
            body: '<!-- opencode-review-agent event=REQUEST_CHANGES comment=old -->',
            submitted_at: '2026-01-01T00:00:00Z',
          },
        ]);
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
        return responseTo({ id: 66, html_url: 'https://example.test/review' });
      }
      if (url.includes('/dismissals')) {
        dismissals.push(url);
        return responseTo({});
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
      return init?.method === 'GET' ? getResponse(url) : postResponse(url);
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
      reviewComplete: false,
      fetchImpl,
    });
    expect(posted).toMatchObject({ id: 66 });
    expect(posts).toHaveLength(1);
    expect(dismissals).toEqual([]);
  });

  it('posts an incomplete comment without history when it cannot dismiss', async () => {
    const dismissals: string[] = [];
    const posts: string[] = [];
    /**
     * Fail the history read and accept the incomplete comment.
     * @param input - Fetch input.
     * @param init - Fetch options.
     * @returns Fake response.
     */
    const fetchImpl: typeof fetch = (input, init) => {
      const url = urlOf(input);
      const method = init?.method ?? 'GET';
      if (url.includes('/reviews?') && method === 'GET') {
        return Promise.resolve(new Response('', { status: 500 }));
      }
      if (url.endsWith('/reviews') && method === 'POST') {
        posts.push(url);
        return responseTo({ id: 68, html_url: 'https://example.test/review' });
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
      reviewComplete: false,
      fetchImpl,
    });
    expect(posted).toMatchObject({ id: 68 });
    expect(posts).toHaveLength(1);
    expect(dismissals).toEqual([]);
  });

  it('refuses to approve an incomplete review', async () => {
    const posts: string[] = [];
    /**
     * Capture any review post.
     * @param input - Fetch input.
     * @param init - Fetch options.
     * @returns Fake response.
     */
    const fetchImpl: typeof fetch = (input, init) => {
      const url = urlOf(input);
      if (init?.method === 'POST') posts.push(url);
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
      reviewComplete: false,
      fetchImpl,
    });
    await expect(pending).rejects.toThrow('approval requires a complete review');
    expect(posts).toHaveLength(0);
  });

  it('refuses to approve a draft pull request', async () => {
    const posts: string[] = [];
    /**
     * Serve an empty history and a draft live pull request.
     * @param input - Fetch input.
     * @param init - Fetch options.
     * @returns Fake response.
     */
    const fetchImpl: typeof fetch = (input, init) => {
      const url = urlOf(input);
      const method = init?.method ?? 'GET';
      if (url.includes('/reviews?') && method === 'GET') {
        return responseTo([]);
      }
      if (url.endsWith('/pulls/886') && method === 'GET') {
        return responseTo({ state: 'open', draft: true, head: { sha: 'head' } });
      }
      if (url.endsWith('/reviews') && method === 'POST') {
        posts.push(url);
        return responseTo({ id: 67, html_url: 'https://example.test/review' });
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
      reviewComplete: true,
      appLogin: 'review-agent[bot]',
      commentId: '99',
      recheckHead: true,
      fetchImpl,
    });
    await expect(pending).rejects.toThrow('pull request changed before posting');
    expect(posts).toHaveLength(0);
  });
});
