/**
 * Unit tests for the informational progress signal. The tests pin the check-run
 * payload, the progress comment lifecycle and the lookup by triggering comment.
 * No network is used.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  findCheckRun,
  findProgressComment,
  finishProgress,
  progressBody,
  startProgress,
} from '../../../../.github/scripts/pr-review/progress.mjs';
import {
  argsFromEnv,
  recoverProgressIds,
  stageIds,
  writeOutputs,
} from '../../../../.github/scripts/pr-review/progress-cli.mjs';
import { responseTo, urlOf } from './PrReviewAgentTestUtils.js';

const MARKER = '<!-- opencode-review-progress -->';
const REPO = 'sergienko4/repo';
const TOKEN = 'token';
const APP = 'review-agent[bot]';
const HEAD = 'head-sha';
const COMMENT_ID = '99';

/**
 * Capture one fetch call.
 */
interface ICall {
  url: string;
  method: string;
  body: string;
}

/**
 * Record a fetch call.
 * @param calls - Capture list.
 * @param input - Fetch input.
 * @param init - Fetch options.
 * @returns Recorded call.
 */
function record(calls: ICall[], input: RequestInfo | URL, init?: RequestInit): ICall {
  const url = urlOf(input);
  const method = init?.method ?? 'GET';
  const rawBody = init?.body;
  const body = typeof rawBody === 'string' ? rawBody : '';
  const call = { url, method, body };
  calls.push(call);
  return call;
}

describe('progress CLI environment', () => {
  it('keys a manual run by PR and run id', () => {
    const env = { PR_NUMBER: '886', GITHUB_RUN_ID: '4514' } as NodeJS.ProcessEnv;
    const args = argsFromEnv(env);
    expect(args.externalId).toBe('manual-886-4514');
  });

  it('uses the trigger comment id when present', () => {
    const env = {
      PR_NUMBER: '886',
      GITHUB_RUN_ID: '4514',
      REVIEW_COMMENT_ID: '99',
    } as NodeJS.ProcessEnv;
    const args = argsFromEnv(env);
    expect(args.externalId).toBe('99');
  });

  it('preserves known stage ids when the update returns none', () => {
    const env = {
      REVIEW_CHECK_ID: '20',
      REVIEW_PROGRESS_COMMENT_ID: '10',
    } as NodeJS.ProcessEnv;
    const ids = stageIds({ commentId: 0, checkRunId: 0 }, env);
    expect(ids).toEqual({ commentId: 10, checkRunId: 20 });
  });

  it('recovers unfinished ids when a prior step published none', async () => {
    /**
     * Serve the unfinished check and progress comment.
     * @param input - Fetch input.
     * @returns Fake response.
     */
    const fetchImpl: typeof fetch = input => {
      const url = urlOf(input);
      if (url.includes('/check-runs?')) {
        return responseTo({
          check_runs: [{ id: 20, name: 'OpenCode review', external_id: COMMENT_ID }],
        });
      }
      if (url.includes('/issues/886/comments?')) {
        return responseTo([{ id: 10, user: { login: APP }, body: `${MARKER} ${COMMENT_ID}` }]);
      }
      return responseTo({});
    };
    const ids = await recoverProgressIds({
      repo: REPO,
      pr: 886,
      token: TOKEN,
      headSha: HEAD,
      externalId: COMMENT_ID,
      appLogin: APP,
      checkRunId: 0,
      commentId: 0,
      fetchImpl,
    });
    expect(ids).toEqual({ commentId: 10, checkRunId: 20 });
  });

  it('writes the exact output keys read by the workflow', async () => {
    const tempRoot = tmpdir();
    const prefix = join(tempRoot, 'progress-output-');
    const dir = await mkdtemp(prefix);
    const output = join(dir, 'output');
    const env = { GITHUB_OUTPUT: output } as NodeJS.ProcessEnv;
    try {
      await writeOutputs({ commentId: 10, checkRunId: 20 }, env);
      await writeOutputs({ done: true }, env);
      const text = await readFile(output, 'utf8');
      expect(text).toBe('commentId=10\ncheckRunId=20\ndone=true\n');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('progress body', () => {
  it('marks the accepted stage and keeps the remaining stages open', () => {
    const body = progressBody('start');
    expect(body).toContain(MARKER);
    expect(body).toContain('- [x] Request accepted');
    expect(body).toContain('- [ ] Diff fetched');
    expect(body).toContain('- [ ] Review running');
    expect(body).toContain('- [ ] Review posted');
  });

  it('advances the checklist for a later stage', () => {
    const body = progressBody('fetch');
    expect(body).toContain('- [x] Diff fetched');
    expect(body).toContain('- [ ] Review running');
  });

  it('keeps the posted step open while posting', () => {
    const body = progressBody('posting');
    expect(body).toContain('- [x] Review running');
    expect(body).toContain('- [ ] Review posted');
  });
});

describe('progress comment lookup', () => {
  it('finds only the App comment with the progress marker', async () => {
    const comments = [
      { id: 1, user: { login: 'maintainer' }, body: MARKER },
      { id: 2, user: { login: APP }, body: 'unrelated' },
      { id: 3, user: { login: APP }, body: `${MARKER}\nreview` },
    ];
    /**
     * Return the comment list.
     * @returns Fake response list.
     */
    const fetchImpl: typeof fetch = () => responseTo(comments);
    const found = await findProgressComment({
      repo: REPO,
      pr: 886,
      token: TOKEN,
      appLogin: APP,
      fetchImpl,
    });
    expect(found).toMatchObject({ id: 3 });
  });

  it('does not match a longer external ID prefix', async () => {
    const comments = [{ id: 4, user: { login: APP }, body: `${MARKER} 999` }];
    /**
     * Serve one progress comment.
     * @returns Fake response.
     */
    const fetchImpl: typeof fetch = () => responseTo(comments);
    const found = await findProgressComment({
      repo: REPO,
      pr: 886,
      token: TOKEN,
      appLogin: APP,
      externalId: '99',
      fetchImpl,
    });
    expect(found).toBeUndefined();
  });

  it('rejects a failed comment lookup', async () => {
    /**
     * Fail the comment list.
     * @returns Fake response.
     */
    const fetchImpl: typeof fetch = () => responseTo({}, 500);
    const pending = findProgressComment({
      repo: REPO,
      pr: 886,
      token: TOKEN,
      appLogin: APP,
      fetchImpl,
    });
    await expect(pending).rejects.toThrow('GitHub progress comment lookup answered 500');
  });
});

describe('progress lifecycle', () => {
  it('rejects a failed check-run lookup', async () => {
    /**
     * Fail the check-run list.
     * @returns Fake response.
     */
    const fetchImpl: typeof fetch = () => responseTo({}, 500);
    const pending = findCheckRun({
      repo: REPO,
      token: TOKEN,
      headSha: HEAD,
      externalId: COMMENT_ID,
      fetchImpl,
    });
    await expect(pending).rejects.toThrow('GitHub check-run lookup answered 500');
  });
  it('creates one comment and one in-progress check run', async () => {
    const calls: ICall[] = [];
    const routes: {
      method: string;
      match: (url: string) => boolean;
      response: () => Promise<Response>;
    }[] = [
      {
        method: 'GET',
        /**
         * Match the comment list.
         * @param url - Request URL.
         * @returns True for the comment list.
         */
        match: (url: string): boolean => url.includes('/issues/886/comments'),
        /**
         * Return the comment list.
         * @returns Empty comment list.
         */
        response: (): Promise<Response> => responseTo([]),
      },
      {
        method: 'POST',
        /**
         * Match the comment create.
         * @param url - Request URL.
         * @returns True for the comment create.
         */
        match: (url: string): boolean => url.endsWith('/issues/886/comments'),
        /**
         * Return the created comment.
         * @returns Created comment id.
         */
        response: (): Promise<Response> => responseTo({ id: 10 }),
      },
      {
        method: 'GET',
        /**
         * Match the check-run list.
         * @param url - Request URL.
         * @returns True for the check-run list.
         */
        match: (url: string): boolean => url.includes('/check-runs?'),
        /**
         * Return the check-run list.
         * @returns Empty check-run list.
         */
        response: (): Promise<Response> => responseTo({ check_runs: [] }),
      },
      {
        method: 'POST',
        /**
         * Match the check-run create.
         * @param url - Request URL.
         * @returns True for the check-run create.
         */
        match: (url: string): boolean => url.endsWith('/check-runs'),
        /**
         * Return the created check run.
         * @returns Created check-run id.
         */
        response: (): Promise<Response> => responseTo({ id: 20 }),
      },
    ];
    /**
     * Record calls and serve the comment and check-run lifecycle.
     * @param input - Fetch input.
     * @param init - Fetch options.
     * @returns Fake response.
     */
    const fetchImpl: typeof fetch = (input, init) => {
      const call = record(calls, input, init);
      /**
       * Whether a route matches this call.
       * @param item - Candidate route.
       * @returns True when the method and URL match.
       */
      const matches = (item: (typeof routes)[number]): boolean =>
        item.method === call.method && item.match(call.url);
      const route = routes.find(matches);
      return route ? route.response() : responseTo({});
    };
    const ids = await startProgress({
      repo: REPO,
      pr: 886,
      token: TOKEN,
      headSha: HEAD,
      externalId: COMMENT_ID,
      appLogin: APP,
      fetchImpl,
    });
    expect(ids).toEqual({ commentId: 10, checkRunId: 20 });
    const commentPost = calls.find(
      call => call.method === 'POST' && call.url.endsWith('/issues/886/comments'),
    );
    const checkPost = calls.find(
      call => call.method === 'POST' && call.url.endsWith('/check-runs'),
    );
    const commentPayload = JSON.parse(commentPost?.body ?? '{}') as { body: string };
    const checkPayload = JSON.parse(checkPost?.body ?? '{}') as Record<string, unknown>;
    const markerLine = commentPayload.body.split('\n', 1)[0];
    expect(markerLine).toBe(`${MARKER} ${COMMENT_ID}`);
    expect(checkPayload).toMatchObject({
      name: 'OpenCode review',
      head_sha: HEAD,
      status: 'in_progress',
      external_id: COMMENT_ID,
    });
  });

  it('reuses an existing comment and check run for the same trigger', async () => {
    const calls: ICall[] = [];
    /**
     * Serve a GET route.
     * @param url - Request URL.
     * @returns Fake response.
     */
    const getResponse = (url: string): Promise<Response> => {
      if (url.includes('/issues/886/comments')) {
        return responseTo([{ id: 10, user: { login: APP }, body: `${MARKER} ${COMMENT_ID}` }]);
      }
      if (url.includes('/check-runs?')) {
        return responseTo({
          check_runs: [{ id: 20, name: 'OpenCode review', external_id: COMMENT_ID }],
        });
      }
      return responseTo({});
    };
    /**
     * Serve a PATCH route.
     * @param url - Request URL.
     * @returns Fake response.
     */
    const patchResponse = (url: string): Promise<Response> => {
      if (url.endsWith('/issues/comments/10')) return responseTo({ id: 10 });
      if (url.endsWith('/check-runs/20')) return responseTo({ id: 20 });
      return responseTo({});
    };
    /**
     * Record calls and serve the existing comment and check run.
     * @param input - Fetch input.
     * @param init - Fetch options.
     * @returns Fake response.
     */
    const fetchImpl: typeof fetch = (input, init) => {
      const call = record(calls, input, init);
      if (call.method === 'GET') return getResponse(call.url);
      return patchResponse(call.url);
    };
    const ids = await startProgress({
      repo: REPO,
      pr: 886,
      token: TOKEN,
      headSha: HEAD,
      externalId: COMMENT_ID,
      appLogin: APP,
      stage: 'review',
      fetchImpl,
    });
    const hasCheckRunPost = calls.some(
      call => call.method === 'POST' && call.url.endsWith('/check-runs'),
    );
    const hasCommentPost = calls.some(
      call => call.method === 'POST' && call.url.endsWith('/issues/886/comments'),
    );
    const checkPatch = calls.find(
      call => call.method === 'PATCH' && call.url.endsWith('/check-runs/20'),
    );
    const patchPayload = JSON.parse(checkPatch?.body ?? '{}') as {
      status: string;
      output: { title: string };
    };
    expect(ids).toEqual({ commentId: 10, checkRunId: 20 });
    expect(hasCheckRunPost).toBe(false);
    expect(hasCommentPost).toBe(false);
    expect(patchPayload.status).toBe('in_progress');
    expect(patchPayload.output.title).toBe('Reviewing the changes');
  });

  it('creates a fresh check when the previous attempt completed', async () => {
    const calls: ICall[] = [];
    /**
     * Serve a completed check and accept a new comment and check.
     * @param input - Fetch input.
     * @param init - Fetch options.
     * @returns Fake response.
     */
    const routes: {
      method: string;
      match: (url: string) => boolean;
      response: () => Promise<Response>;
    }[] = [
      {
        method: 'GET',
        /**
         * Match the comment list.
         * @param url - Request URL.
         * @returns True for the comment list.
         */
        match: (url: string): boolean => url.includes('/issues/886/comments'),
        /**
         * Return no existing comment.
         * @returns Empty comment list.
         */
        response: (): Promise<Response> => responseTo([]),
      },
      {
        method: 'GET',
        /**
         * Match the check-run list.
         * @param url - Request URL.
         * @returns True for the check-run list.
         */
        match: (url: string): boolean => url.includes('/check-runs?'),
        /**
         * Return the completed check.
         * @returns Completed check list.
         */
        response: (): Promise<Response> =>
          responseTo({
            check_runs: [
              {
                id: 20,
                name: 'OpenCode review',
                external_id: COMMENT_ID,
                status: 'completed',
                conclusion: 'neutral',
              },
            ],
          }),
      },
      {
        method: 'POST',
        /**
         * Match the comment create.
         * @param url - Request URL.
         * @returns True for the comment create.
         */
        match: (url: string): boolean => url.endsWith('/issues/886/comments'),
        /**
         * Return the new comment.
         * @returns Created comment id.
         */
        response: (): Promise<Response> => responseTo({ id: 11 }),
      },
      {
        method: 'POST',
        /**
         * Match the check-run create.
         * @param url - Request URL.
         * @returns True for the check-run create.
         */
        match: (url: string): boolean => url.endsWith('/check-runs'),
        /**
         * Return the new check run.
         * @returns Created check-run id.
         */
        response: (): Promise<Response> => responseTo({ id: 21 }),
      },
    ];
    /**
     * Serve the completed check and accept a fresh comment and check.
     * @param input - Fetch input.
     * @param init - Fetch options.
     * @returns Fake response.
     */
    const fetchImpl: typeof fetch = (input, init) => {
      const call = record(calls, input, init);
      /**
       * Match a route to the recorded call.
       * @param item - Candidate route.
       * @returns True when the method and URL match.
       */
      const matchesRoute = (item: (typeof routes)[number]): boolean =>
        item.method === call.method && item.match(call.url);
      const route = routes.find(matchesRoute);
      return route === undefined ? responseTo({}) : route.response();
    };
    const ids = await startProgress({
      repo: REPO,
      pr: 886,
      token: TOKEN,
      headSha: HEAD,
      externalId: COMMENT_ID,
      appLogin: APP,
      fetchImpl,
    });
    expect(ids).toEqual({ commentId: 11, checkRunId: 21 });
    const hasCheckPost = calls.some(
      call => call.method === 'POST' && call.url.endsWith('/check-runs'),
    );
    const didTouchOldCheck = calls.some(call => call.url.includes('/check-runs/20'));
    expect(hasCheckPost).toBe(true);
    expect(didTouchOldCheck).toBe(false);
  });

  it('keeps the existing comment id when its update fails', async () => {
    /**
     * Serve an existing comment, fail its update, and serve a check run.
     * @param input - Fetch input.
     * @param init - Fetch options.
     * @returns Fake response.
     */
    const fetchImpl: typeof fetch = (input, init) => {
      const call = record([], input, init);
      if (call.url.includes('/issues/886/comments') && call.method === 'GET') {
        return responseTo([{ id: 10, user: { login: APP }, body: `${MARKER} ${COMMENT_ID}` }]);
      }
      if (call.url.endsWith('/issues/comments/10') && call.method === 'PATCH') {
        return Promise.resolve(new Response('', { status: 500 }));
      }
      if (call.url.includes('/check-runs?')) {
        return responseTo({
          check_runs: [
            { id: 20, name: 'OpenCode review', external_id: COMMENT_ID, status: 'in_progress' },
          ],
        });
      }
      return responseTo({});
    };
    const ids = await startProgress({
      repo: REPO,
      pr: 886,
      token: TOKEN,
      headSha: HEAD,
      externalId: COMMENT_ID,
      appLogin: APP,
      fetchImpl,
    });
    expect(ids).toEqual({ commentId: 10, checkRunId: 20 });
  });

  it('completes neutral and deletes the progress comment', async () => {
    const calls: ICall[] = [];
    /**
     * Record calls and serve the check-run update and comment deletion.
     * @param input - Fetch input.
     * @param init - Fetch options.
     * @returns Fake response.
     */
    const fetchImpl: typeof fetch = (input, init) => {
      const call = record(calls, input, init);
      if (call.url.endsWith('/check-runs/20') && call.method === 'PATCH') {
        return responseTo({});
      }
      if (call.url.endsWith('/issues/comments/10') && call.method === 'DELETE') {
        return responseTo({});
      }
      return responseTo({});
    };
    await finishProgress({
      repo: REPO,
      token: TOKEN,
      checkRunId: 20,
      commentId: 10,
      conclusion: 'neutral',
      findings: 2,
      fetchImpl,
    });
    const patch = calls.find(call => call.method === 'PATCH');
    const patchPayload = JSON.parse(patch?.body ?? '{}') as {
      status: string;
      conclusion: string;
      output: { summary: string };
    };
    expect(patchPayload).toMatchObject({
      status: 'completed',
      conclusion: 'neutral',
    });
    expect(patchPayload.output.summary).toContain('2 finding(s)');
    const hasDeleteCall = calls.some(call => call.method === 'DELETE');
    expect(hasDeleteCall).toBe(true);
  });

  it('still deletes the comment when the check-run update fails', async () => {
    const calls: ICall[] = [];
    /**
     * Record calls, fail the check-run update and serve the deletion.
     * @param input - Fetch input.
     * @param init - Fetch options.
     * @returns Fake response.
     */
    const fetchImpl: typeof fetch = (input, init) => {
      const call = record(calls, input, init);
      if (call.url.endsWith('/check-runs/20') && call.method === 'PATCH') {
        return responseTo({}, 500);
      }
      if (call.url.endsWith('/issues/comments/10') && call.method === 'DELETE') {
        return responseTo({});
      }
      return responseTo({});
    };
    const pending = finishProgress({
      repo: REPO,
      token: TOKEN,
      checkRunId: 20,
      commentId: 10,
      conclusion: 'success',
      fetchImpl,
    });
    await expect(pending).rejects.toThrow('GitHub check-run PATCH answered 500');
    const hasDeleteCall = calls.some(call => call.method === 'DELETE');
    expect(hasDeleteCall).toBe(true);
  });

  it('reports a failed run without claiming a review was posted', async () => {
    const calls: ICall[] = [];
    /**
     * Record calls and return an empty response.
     * @param input - Fetch input.
     * @param init - Fetch options.
     * @returns Fake response.
     */
    const fetchImpl: typeof fetch = (input, init) => {
      record(calls, input, init);
      return responseTo({});
    };
    await finishProgress({
      repo: REPO,
      token: TOKEN,
      checkRunId: 20,
      commentId: 0,
      conclusion: 'neutral',
      failed: true,
      fetchImpl,
    });
    const patch = calls.find(call => call.method === 'PATCH');
    const patchPayload = JSON.parse(patch?.body ?? '{}') as {
      output: { summary: string };
    };
    expect(patchPayload.output.summary).toBe('Review did not run.');
  });

  it('keeps the check run when the progress comment cannot be created', async () => {
    /**
     * Serve the check-run calls and refuse comment creation.
     * @param input - Fetch input.
     * @param init - Fetch options.
     * @returns Fake response.
     */
    const fetchImpl: typeof fetch = (input, init) => {
      const url = urlOf(input);
      const method = init?.method ?? 'GET';
      if (url.includes('/check-runs?') && method === 'GET') {
        return responseTo({ check_runs: [] });
      }
      if (url.endsWith('/check-runs') && method === 'POST') {
        return responseTo({ id: 20 });
      }
      if (url.endsWith('/issues/886/comments')) return responseTo({}, 403);
      return responseTo([]);
    };
    const ids = await startProgress({
      repo: REPO,
      pr: 886,
      token: TOKEN,
      headSha: HEAD,
      externalId: COMMENT_ID,
      appLogin: APP,
      fetchImpl,
    });
    expect(ids).toEqual({ commentId: 0, checkRunId: 20 });
  });

  it('does nothing when there is no progress signal', async () => {
    const calls: ICall[] = [];
    /**
     * Record calls and return an empty response.
     * @param input - Fetch input.
     * @param init - Fetch options.
     * @returns Fake response.
     */
    const fetchImpl: typeof fetch = (input, init) => {
      record(calls, input, init);
      return responseTo({});
    };
    await finishProgress({
      repo: REPO,
      token: TOKEN,
      checkRunId: 0,
      commentId: 0,
      conclusion: 'success',
      fetchImpl,
    });
    expect(calls).toHaveLength(0);
  });

  it('ignores a failed progress comment deletion', async () => {
    const calls: ICall[] = [];
    /**
     * Complete the check and fail the comment deletion.
     * @param input - Fetch input.
     * @param init - Fetch options.
     * @returns Fake response.
     */
    const fetchImpl: typeof fetch = (input, init) => {
      const call = record(calls, input, init);
      if (call.url.endsWith('/issues/comments/10') && call.method === 'DELETE') {
        return responseTo({}, 500);
      }
      return responseTo({});
    };
    const pending = finishProgress({
      repo: REPO,
      token: TOKEN,
      checkRunId: 20,
      commentId: 10,
      conclusion: 'success',
      fetchImpl,
    });
    await expect(pending).resolves.toBeUndefined();
    const hasDeleteCall = calls.some(call => call.method === 'DELETE');
    expect(hasDeleteCall).toBe(true);
  });

  it('skips comment creation when lookup reaches the page cap', async () => {
    const calls: ICall[] = [];
    /**
     * Serve an empty check-run list and full comment pages.
     * @param input - Fetch input.
     * @param init - Fetch options.
     * @returns Fake response.
     */
    const fetchImpl: typeof fetch = (input, init) => {
      const call = record(calls, input, init);
      if (call.url.includes('/check-runs?')) return responseTo({ check_runs: [] });
      if (call.url.endsWith('/check-runs')) return responseTo({ id: 20 });
      if (call.method === 'GET' && call.url.includes('/issues/886/comments?')) {
        const page = Array.from({ length: 100 }, (_, index) => ({
          id: index + 1,
          user: { login: 'someone' },
          body: 'other comment',
        }));
        return responseTo(page);
      }
      return responseTo([]);
    };
    const ids = await startProgress({
      repo: REPO,
      pr: 886,
      token: TOKEN,
      headSha: HEAD,
      externalId: COMMENT_ID,
      appLogin: APP,
      fetchImpl,
    });
    const hasCommentCreate = calls.some(
      call => call.method === 'POST' && call.url.endsWith('/issues/886/comments'),
    );
    expect(ids).toEqual({ commentId: 0, checkRunId: 20 });
    expect(hasCommentCreate).toBe(false);
  });
});
