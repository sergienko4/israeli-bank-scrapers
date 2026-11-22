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
});
