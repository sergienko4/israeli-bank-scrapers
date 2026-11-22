import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { decideReview } from './approval.mjs';
import { parseAddedLines, parseReview, reviewEvent, validateReview } from './post-review.mjs';
import { listReviews } from './review-history.mjs';
import { githubRequest, readResponseJson } from './shared.mjs';

/**
 * Write one GitHub Actions output.
 * @param {string} key - Output name.
 * @param {string} value - Output value.
 * @param {NodeJS.ProcessEnv} env - Process environment.
 * @returns {Promise<void>} Resolves when written.
 */
async function writeOutput(key, value, env) {
  if (!env.GITHUB_OUTPUT) {
    console.log(`${key}=${value}`);
    return;
  }
  const { appendFile } = await import('node:fs/promises');
  await appendFile(env.GITHUB_OUTPUT, `${key}=${value}\n`, 'utf8');
}

/**
 * Fetch the live pull request, not an environment snapshot.
 * @param {NodeJS.ProcessEnv} env - Process environment.
 * @param {typeof fetch} fetchImpl - Fetch implementation.
 * @returns {Promise<Record<string, unknown>>} Live pull request.
 */
async function fetchLivePr(env, fetchImpl) {
  const response = await githubRequest({
    token: env.REVIEW_TOKEN || env.GITHUB_TOKEN || '',
    path: `/repos/${env.REVIEW_REPO || env.GITHUB_REPOSITORY}/pulls/${env.PR_NUMBER}`,
    fetchImpl,
  });
  return /** @type {Record<string, unknown>} */ (await readResponseJson(response));
}

/**
 * Whether the head already has a blocking review from this App.
 * @param {Array<Record<string, unknown>>} reviews - Reviews.
 * @param {string} appLogin - App login.
 * @param {string} headSha - Reviewed head.
 * @returns {boolean} True when a request-changes review exists.
 */
export function hasBlockingReview(reviews, appLogin, headSha) {
  return reviews.some(
    review =>
      String((review.user ?? {}).login ?? '') === appLogin &&
      String(review.commit_id ?? '') === headSha &&
      reviewEvent(review) === 'REQUEST_CHANGES',
  );
}

/**
 * Decide the review event from the workflow environment.
 * @param {NodeJS.ProcessEnv} env - Process environment.
 * @param {typeof fetch} [fetchImpl] - Fetch implementation.
 * @returns {Promise<{ event: string, reason: string, dismissBlocking: boolean }>} Decision.
 */
export async function decideFromEnv(env, fetchImpl = fetch) {
  const config = JSON.parse(
    await readFile(new URL('../../review-agent/config.json', import.meta.url), 'utf8'),
  );
  const result = await readFile(env.REVIEW_RESULT || '.review/pr/result.json', 'utf8');
  const diff = await readFile(env.REVIEW_DIFF || '.review/pr/diff.patch', 'utf8');
  const review = validateReview(
    parseReview(result),
    Number.POSITIVE_INFINITY,
    parseAddedLines(diff),
  );
  const metadata = JSON.parse(
    await readFile(env.REVIEW_METADATA || '.review/pr/metadata.json', 'utf8'),
  );
  const pullRequest = await fetchLivePr(env, fetchImpl);
  const head = /** @type {Record<string, unknown>} */ (pullRequest.head ?? {});
  const headRepo = /** @type {Record<string, unknown>} */ (head.repo ?? {});
  const appLogin = env.REVIEW_APP_LOGIN || config.appLogin || 'review-agent[bot]';
  const headSha = env.REVIEW_HEAD_SHA || '';
  const historyArgs = {
    repo: env.REVIEW_REPO || env.GITHUB_REPOSITORY || '',
    pr: Number(env.PR_NUMBER),
    token: env.REVIEW_TOKEN || env.GITHUB_TOKEN || '',
    fetchImpl,
  };
  /**
   * Decide from one review-history snapshot.
   * @param {Array<Record<string, unknown>>} reviews - Reviews.
   * @returns {{ event: string, reason: string, dismissBlocking: boolean }} Decision.
   */
  const decide = reviews =>
    decideReview({
      command: env.REVIEW_COMMAND || 'review',
      findings: review.findings,
      metadata,
      pullRequest: {
        state: pullRequest.state,
        draft: pullRequest.draft === true,
        isFork:
          String(headRepo.full_name ?? '') !== String(env.REVIEW_REPO || env.GITHUB_REPOSITORY),
        authorLogin: String((pullRequest.user ?? {}).login ?? ''),
        headSha: String(head.sha ?? ''),
      },
      actor: env.REVIEW_ACTOR || '',
      actorPermission: env.REVIEW_ACTOR_PERMISSION || '',
      headSha,
      config,
      reviewComplete: review.complete,
      previousReview: hasBlockingReview(reviews, appLogin, headSha)
        ? { blocking: true, headSha }
        : undefined,
    });

  const provisional = decide(await listReviews({ ...historyArgs, failClosed: false }));
  if (provisional.event === 'COMMENT' && provisional.dismissBlocking === false) {
    return provisional;
  }
  return decide(await listReviews(historyArgs));
}

/**
 * CLI entrypoint.
 * @returns {Promise<void>} Resolves when outputs are written.
 */
async function main() {
  const decision = await decideFromEnv(process.env);
  await writeOutput('event', decision.event, process.env);
  await writeOutput('reason', decision.reason, process.env);
  await writeOutput('dismissBlocking', String(decision.dismissBlocking), process.env);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`pr-review decide failed: ${error.name}`);
    process.exitCode = 1;
  });
}
