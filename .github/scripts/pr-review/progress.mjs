/**
 * Show a review run on the pull request without adding a merge gate.
 *
 * The check run is informational. The progress comment is removed when the
 * run ends, whether it succeeded, found blocking issues or failed. A failure
 * never posts a review or a PR message.
 */

import { githubRequest, readResponseJson } from './shared.mjs';

/** Default check-run name. */
const DEFAULT_CHECK_NAME = 'OpenCode review';

/** Default progress-comment marker. */
const DEFAULT_MARKER = '<!-- opencode-review-progress -->';

/** Maximum issue-comment pages read. */
const MAX_COMMENT_PAGES = 5;

/** Checklist labels in order. */
const STAGES = ['Request accepted', 'Diff fetched', 'Review running', 'Review posted'];

/** Completed stage count by progress stage. */
const STAGE_DONE = { start: 1, fetch: 2, review: 3, post: 4 };

/** Human title by progress stage. */
const STAGE_TITLE = {
  start: 'Review queued',
  fetch: 'Fetching the pull request',
  review: 'Reviewing the changes',
  post: 'Posting the review',
};

/**
 * Build the progress comment body.
 * @param {string} stage - Progress stage.
 * @param {string} [marker] - Comment marker.
 * @returns {string} Markdown body.
 */
export function progressBody(stage, marker = DEFAULT_MARKER, externalId = '') {
  const done = STAGE_DONE[stage] ?? STAGE_DONE.start;
  const markerLine = externalId.length > 0 ? `${marker} ${externalId}` : marker;
  const checklist = STAGES.map((label, index) => `- [${index < done ? 'x' : ' '}] ${label}`).join(
    '\n',
  );
  return `${markerLine}\n\n## Review in progress\n\n${checklist}\n`;
}

/**
 * Build a fixed final summary without model output.
 * @param {string} conclusion - Check conclusion.
 * @param {number} [findings] - Finding count.
 * @returns {string} Safe summary.
 */
export function finishSummary(conclusion, findings = 0, failed = false) {
  if (failed) return 'Review did not run.';
  if (conclusion === 'success') return 'Review posted.';
  if (conclusion === 'neutral') {
    return findings > 0
      ? `Review posted with ${findings} finding(s).`
      : 'Review finished without findings.';
  }
  if (conclusion === 'cancelled') return 'Review was cancelled.';
  if (conclusion === 'timed_out') return 'Review timed out.';
  return 'Review finished.';
}

/**
 * Find the progress comment authored by this App.
 * @param {object} args - Request arguments.
 * @param {string} args.repo - `owner/name`.
 * @param {number} args.pr - Pull request number.
 * @param {string} args.token - GitHub token.
 * @param {string} args.appLogin - App login.
 * @param {string} [args.marker] - Comment marker.
 * @param {typeof fetch} [args.fetchImpl] - Test double.
 * @returns {Promise<Record<string, unknown> | undefined>} Progress comment.
 */
export async function findProgressComment(args) {
  const marker = args.marker ?? DEFAULT_MARKER;
  const externalId = String(args.externalId ?? '');
  const markerLine = externalId.length > 0 ? `${marker} ${externalId}` : marker;
  for (let page = 1; page <= MAX_COMMENT_PAGES; page += 1) {
    const response = await githubRequest({
      token: args.token,
      path: `/repos/${args.repo}/issues/${args.pr}/comments?per_page=100&page=${page}`,
      fetchImpl: args.fetchImpl,
    });
    if (!response.ok) return undefined;
    const batch = /** @type {Array<Record<string, unknown>>} */ (await readResponseJson(response));
    const found = batch.find(comment => {
      const firstLine = String(comment.body ?? '').split('\n', 1)[0];
      return String((comment.user ?? {}).login ?? '') === args.appLogin && firstLine === markerLine;
    });
    if (found !== undefined) return found;
    if (batch.length < 100) return undefined;
  }
  throw new Error('progress comment lookup is incomplete');
}

/**
 * Create or update the progress comment.
 * @param {object} args - Comment arguments.
 * @param {Record<string, unknown> | undefined} existing - Current comment.
 * @returns {Promise<Record<string, unknown>>} Comment.
 */
export async function upsertProgressComment(args, existing) {
  const body = progressBody(args.stage ?? 'start', args.marker, String(args.externalId ?? ''));
  const id = Number(existing?.id);
  const response = await githubRequest({
    token: args.token,
    path:
      Number.isInteger(id) && id > 0
        ? `/repos/${args.repo}/issues/comments/${id}`
        : `/repos/${args.repo}/issues/${args.pr}/comments`,
    method: Number.isInteger(id) && id > 0 ? 'PATCH' : 'POST',
    body: { body },
    fetchImpl: args.fetchImpl,
  });
  if (!response.ok) throw new Error(`GitHub progress comment answered ${response.status}`);
  return /** @type {Record<string, unknown>} */ (await readResponseJson(response));
}

/**
 * Find an unfinished check run by the triggering comment ID.
 * A completed attempt cannot report progress, so a retry creates a new one.
 * @param {object} args - Request arguments.
 * @param {string} args.repo - `owner/name`.
 * @param {string} args.headSha - Pull request head.
 * @param {string} args.externalId - Triggering comment ID.
 * @param {string} [args.checkName] - Check name.
 * @param {typeof fetch} [args.fetchImpl] - Test double.
 * @returns {Promise<Record<string, unknown> | undefined>} Check run.
 */
export async function findCheckRun(args) {
  const checkName = args.checkName ?? DEFAULT_CHECK_NAME;
  for (let page = 1; page <= 5; page += 1) {
    const response = await githubRequest({
      token: args.token,
      path: `/repos/${args.repo}/commits/${args.headSha}/check-runs?filter=all&per_page=100&check_name=${encodeURIComponent(checkName)}&page=${page}`,
      fetchImpl: args.fetchImpl,
    });
    if (!response.ok) return undefined;
    const body = /** @type {Record<string, unknown>} */ (await readResponseJson(response));
    const runs = /** @type {Array<Record<string, unknown>>} */ (body.check_runs ?? []);
    const found = runs.find(
      run =>
        String(run.name ?? '') === checkName &&
        String(run.external_id ?? '') === String(args.externalId ?? '') &&
        String(run.status ?? '') !== 'completed',
    );
    if (found !== undefined) return found;
    if (runs.length < 100) return undefined;
  }
  return undefined;
}

/**
 * Create an in-progress check run.
 * @param {object} args - Check arguments.
 * @returns {Promise<Record<string, unknown>>} Check run.
 */
export async function createCheckRun(args) {
  const response = await githubRequest({
    token: args.token,
    path: `/repos/${args.repo}/check-runs`,
    method: 'POST',
    body: {
      name: args.checkName ?? DEFAULT_CHECK_NAME,
      head_sha: args.headSha,
      status: 'in_progress',
      external_id: args.externalId,
      output: {
        title: STAGE_TITLE[args.stage ?? 'start'] ?? STAGE_TITLE.start,
        summary: progressBody(args.stage ?? 'start', ''),
      },
    },
    fetchImpl: args.fetchImpl,
  });
  if (!response.ok) throw new Error(`GitHub check-run POST answered ${response.status}`);
  return /** @type {Record<string, unknown>} */ (await readResponseJson(response));
}

/**
 * Start the informational progress signal.
 * @param {object} args - Start arguments.
 * @param {string} args.repo - `owner/name`.
 * @param {number} args.pr - Pull request number.
 * @param {string} args.token - GitHub token.
 * @param {string} args.headSha - Pull request head.
 * @param {string} args.externalId - Triggering comment ID.
 * @param {string} args.appLogin - App login.
 * @param {string} [args.checkName] - Check name.
 * @param {string} [args.marker] - Comment marker.
 * @param {typeof fetch} [args.fetchImpl] - Test double.
 * @returns {Promise<{ commentId: number, checkRunId: number }>} Created IDs.
 */
export async function startProgress(args) {
  const stage = args.stage ?? 'start';
  const existingCheck = await findCheckRun(args);
  let checkRun = existingCheck;
  if (existingCheck === undefined) {
    checkRun = await createCheckRun({ ...args, stage });
  } else {
    const response = await githubRequest({
      token: args.token,
      path: `/repos/${args.repo}/check-runs/${String(existingCheck.id)}`,
      method: 'PATCH',
      body: {
        status: 'in_progress',
        output: {
          title: STAGE_TITLE[stage] ?? STAGE_TITLE.start,
          summary: progressBody(stage, ''),
        },
      },
      fetchImpl: args.fetchImpl,
    });
    if (!response.ok) throw new Error(`GitHub check-run PATCH answered ${response.status}`);
  }
  let commentId = 0;
  try {
    const existingComment = await findProgressComment(args);
    commentId = Number(existingComment?.id ?? 0);
    const comment = await upsertProgressComment({ ...args, stage }, existingComment);
    commentId = Number(comment.id);
  } catch {
    // The check run is the durable signal; the comment is best effort. A
    // failed update still leaves the existing comment removable by its id.
  }
  return {
    commentId,
    checkRunId: Number(checkRun.id),
  };
}

/**
 * Complete the check run and remove the progress comment.
 * @param {object} args - Finish arguments.
 * @param {string} args.repo - `owner/name`.
 * @param {string} args.token - GitHub token.
 * @param {number} args.checkRunId - Check-run ID.
 * @param {number} args.commentId - Progress-comment ID.
 * @param {string} args.conclusion - `success`, `neutral`, `cancelled` or `timed_out`.
 * @param {number} [args.findings] - Finding count.
 * @param {typeof fetch} [args.fetchImpl] - Test double.
 * @returns {Promise<void>} Resolves when complete.
 */
export async function finishProgress(args) {
  let failure;
  try {
    if (Number.isInteger(args.checkRunId) && args.checkRunId > 0) {
      const response = await githubRequest({
        token: args.token,
        path: `/repos/${args.repo}/check-runs/${args.checkRunId}`,
        method: 'PATCH',
        body: {
          status: 'completed',
          conclusion: args.conclusion,
          output: {
            title: 'OpenCode review',
            summary: finishSummary(args.conclusion, args.findings, args.failed),
          },
        },
        fetchImpl: args.fetchImpl,
      });
      if (!response.ok) throw new Error(`GitHub check-run PATCH answered ${response.status}`);
    }
  } catch (error) {
    failure = error;
  } finally {
    if (Number.isInteger(args.commentId) && args.commentId > 0) {
      try {
        const response = await githubRequest({
          token: args.token,
          path: `/repos/${args.repo}/issues/comments/${args.commentId}`,
          method: 'DELETE',
          fetchImpl: args.fetchImpl,
        });
        if (!response.ok && response.status !== 404) {
          throw new Error(`GitHub progress comment DELETE answered ${response.status}`);
        }
      } catch {
        // Cleanup is best effort; a completed check run is the durable signal.
      }
    }
  }
  if (failure !== undefined) throw failure;
}
