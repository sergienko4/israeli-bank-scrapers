/**
 * Unit tests for dispatched-comment resolution. The tests prove the dispatcher
 * inputs are not trusted: the body, actor and association come from the
 * re-fetched comment, and permission is checked again through the API.
 */

import { resolveDispatch } from '../../../../.github/scripts/pr-review/resolve-dispatch.mjs';
import { responseTo, urlOf } from './PrReviewAgentTestUtils.js';

const CONFIG = {
  provider: 'opencode-go',
  modelPrefix: 'deepseek',
  defaultVariant: 'high',
  variantPriority: ['high', 'max', 'low'],
  fallbackModels: [{ id: 'deepseek-v4.1-flash', variants: ['low', 'high', 'max'] }],
};

const REPO = 'sergienko4/repo';
const TOKEN = 'token';
const PR = 886;
const COMMENT_ID = 99;

/**
 * A comment on PR 886.
 * @param body - Comment body.
 * @param association - GitHub author association.
 * @param login - Comment author.
 * @returns Comment payload.
 */
function comment(
  body = '/review approve',
  association = 'MEMBER',
  login = 'maintainer',
): Record<string, unknown> {
  return {
    issue_url: `https://api.github.com/repos/${REPO}/issues/${String(PR)}`,
    body,
    author_association: association,
    user: { login },
  };
}

/**
 * An open pull request.
 * @param headRepo - Head repository full name.
 * @returns Pull request payload.
 */
function pullRequest(headRepo = REPO): Record<string, unknown> {
  return {
    state: 'open',
    base: { sha: 'base-sha' },
    head: { sha: 'head-sha', ref: 'feature', repo: { full_name: headRepo } },
  };
}

/**
 * A one-model catalog.
 * @returns Catalog payload.
 */
function catalog(): Record<string, unknown> {
  return {
    data: [
      {
        id: 'deepseek-v4.1-flash',
        release_date: '2026-10-17',
        capabilities: { reasoning: { effort: ['high'] } },
      },
    ],
  };
}

/**
 * Fake the comment, permission, PR and catalog endpoints.
 * @param overrides - Response overrides.
 * @param overrides.commentResponse - Comment response override.
 * @param overrides.permission - Permission response override.
 * @param overrides.pullRequestResponse - Pull request response override.
 * @param overrides.catalogResponse - Catalog response override.
 * @returns Fake fetch.
 */
function fakeFetch(
  overrides: {
    commentResponse?: Promise<Response>;
    permission?: string;
    pullRequestResponse?: Promise<Response>;
    catalogResponse?: Promise<Response>;
  } = {},
): typeof fetch {
  return input => {
    const url = urlOf(input);
    if (url.includes('/issues/comments/')) {
      const defaultComment = comment();
      return overrides.commentResponse ?? responseTo(defaultComment);
    }
    if (url.includes('/collaborators/'))
      return responseTo({ permission: overrides.permission ?? 'write' });
    if (url.includes(`/pulls/${String(PR)}`)) {
      const defaultPullRequest = pullRequest();
      return overrides.pullRequestResponse ?? responseTo(defaultPullRequest);
    }
    if (url.includes('inference/go/v1/models')) {
      const defaultCatalog = catalog();
      return overrides.catalogResponse ?? responseTo(defaultCatalog);
    }
    return responseTo({});
  };
}

/**
 * Resolve one dispatch with explicit arguments.
 * @param fetchImpl - Fake fetch.
 * @returns Resolution.
 */
function resolve(fetchImpl: typeof fetch): Promise<Record<string, unknown>> {
  return resolveDispatch({
    repo: REPO,
    pr: PR,
    commentId: COMMENT_ID,
    token: TOKEN,
    config: CONFIG,
    fetchImpl,
  });
}

describe('dispatched comment resolution', () => {
  it('reads the approve command and model from the comment body', async () => {
    const commentPayload = comment('/review approve model=deepseek-v4.1-flash#high');
    const commentResponse = responseTo(commentPayload);
    const fetchImpl = fakeFetch({ commentResponse });
    const result = await resolve(fetchImpl);
    expect(result).toMatchObject({
      allowed: true,
      pr: PR,
      command: 'approve',
      model: 'opencode-go/deepseek-v4.1-flash#high',
      actor: 'maintainer',
      baseSha: 'base-sha',
      headSha: 'head-sha',
    });
  });

  it('uses the comment author, not a forged dispatch actor', async () => {
    const result = await resolveDispatch({
      repo: REPO,
      pr: PR,
      commentId: COMMENT_ID,
      token: TOKEN,
      config: CONFIG,
      actor: 'attacker',
      fetchImpl: fakeFetch(),
    });
    expect(result).toMatchObject({ allowed: true, actor: 'maintainer' });
  });

  it('treats a plain /review as review even if the dispatch said approve', async () => {
    const commentPayload = comment('/review');
    const commentResponse = responseTo(commentPayload);
    const fetchImpl = fakeFetch({ commentResponse });
    const result = await resolveDispatch({
      repo: REPO,
      pr: PR,
      commentId: COMMENT_ID,
      token: TOKEN,
      config: CONFIG,
      command: 'approve',
      fetchImpl,
    });
    expect(result).toMatchObject({ allowed: true, command: 'review' });
  });

  it('refuses a comment from a non-maintainer before the permission call', async () => {
    const requests: string[] = [];
    const commentPayload = comment('/review', 'NONE');
    const commentResponse = responseTo(commentPayload);
    const baseFetch = fakeFetch({ commentResponse });
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
    const result = await resolve(fetchImpl);
    const hasPermissionCall = requests.some(url => url.includes('/collaborators/'));
    expect(result).toMatchObject({ allowed: false, reason: 'actor is not a maintainer' });
    expect(hasPermissionCall).toBe(false);
  });

  it('refuses a read-only collaborator', async () => {
    const fetchImpl = fakeFetch({ permission: 'read' });
    const result = await resolve(fetchImpl);
    expect(result).toMatchObject({ allowed: false, reason: 'actor is not a maintainer' });
  });

  it('returns a denial when the permission lookup fails', async () => {
    const baseFetch = fakeFetch();
    /**
     * Reject the permission request and serve the other endpoints.
     * @param input - Fetch input.
     * @returns Fake response.
     */
    const fetchImpl: typeof fetch = input => {
      const url = urlOf(input);
      if (url.includes('/collaborators/')) return Promise.reject(new Error('network down'));
      return baseFetch(input);
    };
    const result = await resolve(fetchImpl);
    expect(result).toMatchObject({ allowed: false, reason: 'network down' });
  });

  it('refuses a fork pull request', async () => {
    const pullRequestPayload = pullRequest('other/repo');
    const pullRequestResponse = responseTo(pullRequestPayload);
    const fetchImpl = fakeFetch({ pullRequestResponse });
    const result = await resolve(fetchImpl);
    expect(result).toMatchObject({ allowed: false, reason: 'fork pull request is not supported' });
  });

  it('refuses a closed pull request', async () => {
    const closed = { ...pullRequest(), state: 'closed' };
    const pullRequestResponse = responseTo(closed);
    const fetchImpl = fakeFetch({ pullRequestResponse });
    const result = await resolve(fetchImpl);
    expect(result).toMatchObject({ allowed: false, reason: 'pull request is not open' });
  });

  it('refuses a comment on another pull request', async () => {
    const other = { ...comment(), issue_url: `https://api.github.com/repos/${REPO}/issues/999` };
    const commentResponse = responseTo(other);
    const fetchImpl = fakeFetch({ commentResponse });
    const result = await resolve(fetchImpl);
    expect(result).toMatchObject({
      allowed: false,
      reason: 'comment is not on the pull request',
    });
  });

  it('refuses a missing comment', async () => {
    const commentResponse = responseTo({}, 404);
    const fetchImpl = fakeFetch({ commentResponse });
    const result = await resolve(fetchImpl);
    expect(result).toMatchObject({ allowed: false, reason: 'comment not found' });
  });

  it('refuses a malformed command', async () => {
    const commentPayload = comment('/review approve please');
    const commentResponse = responseTo(commentPayload);
    const fetchImpl = fakeFetch({ commentResponse });
    const result = await resolve(fetchImpl);
    expect(result).toMatchObject({ allowed: false, reason: 'not a review request' });
  });

  it('refuses an unavailable model', async () => {
    const commentPayload = comment('/review model=openai/gpt-5');
    const commentResponse = responseTo(commentPayload);
    const fetchImpl = fakeFetch({ commentResponse });
    const result = await resolve(fetchImpl);
    expect(result).toMatchObject({ allowed: false, reason: 'model provider is not allowed' });
  });
});
