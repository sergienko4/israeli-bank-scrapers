import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { canRequest, githubRequest, isTrustedAssociation, readResponseJson } from './shared.mjs';
import { loadCatalog, normalizeModel, parseRequest } from './resolve-request.mjs';

/**
 * Fetch one issue comment by ID.
 * @param {object} args - Lookup arguments.
 * @param {string} args.repo - `owner/name`.
 * @param {number} args.commentId - Comment ID.
 * @param {string} args.token - GitHub token.
 * @param {typeof fetch} [args.fetchImpl] - Test double.
 * @returns {Promise<Record<string, unknown>>} Comment.
 */
async function fetchComment(args) {
  const response = await githubRequest({
    token: args.token,
    path: `/repos/${args.repo}/issues/comments/${args.commentId}`,
    fetchImpl: args.fetchImpl,
  });
  return /** @type {Record<string, unknown>} */ (await readResponseJson(response));
}

/**
 * Fetch one pull request.
 * @param {object} args - Lookup arguments.
 * @returns {Promise<Record<string, unknown>>} Pull request.
 */
async function fetchPr(args) {
  const response = await githubRequest({
    token: args.token,
    path: `/repos/${args.repo}/pulls/${args.pr}`,
    fetchImpl: args.fetchImpl,
  });
  return /** @type {Record<string, unknown>} */ (await readResponseJson(response));
}

/**
 * Read the actor's repository permission.
 * @param {object} args - Lookup arguments.
 * @returns {Promise<string>} Permission, or ''.
 */
async function actorPermission(args) {
  const response = await githubRequest({
    token: args.token,
    path: `/repos/${args.repo}/collaborators/${encodeURIComponent(args.actor)}/permission`,
    fetchImpl: args.fetchImpl,
  });
  if (!response.ok) return '';
  const body = /** @type {Record<string, unknown>} */ (await readResponseJson(response));
  return String(body.permission ?? '');
}

/**
 * Read the issue number from a comment's `issue_url`.
 * @param {unknown} value - Issue URL.
 * @returns {number} Issue number, or 0.
 */
function issueNumber(value) {
  const match = /\/(\d+)$/u.exec(String(value ?? ''));
  return match === null ? 0 : Number(match[1]);
}

/**
 * Resolve one dispatched comment into workflow outputs.
 *
 * The dispatch inputs are not trusted: the actor, command and model text come
 * from the re-fetched comment body, and the actor's permission is re-checked.
 * @param {object} args - Request arguments.
 * @param {string} args.repo - `owner/name`.
 * @param {number} args.pr - Pull request number.
 * @param {number} args.commentId - Triggering comment ID.
 * @param {string} args.token - GitHub token.
 * @param {Record<string, unknown>} args.config - Review config.
 * @param {typeof fetch} [args.fetchImpl] - Test double.
 * @returns {Promise<Record<string, unknown>>} Resolution.
 */
export async function resolveDispatch(args) {
  const denied = reason => ({ allowed: false, reason });
  if (!Number.isInteger(args.pr) || args.pr <= 0) return denied('invalid pull request');
  if (!Number.isInteger(args.commentId) || args.commentId <= 0) return denied('invalid comment');
  let comment;
  try {
    comment = await fetchComment(args);
  } catch {
    return denied('comment not found');
  }
  if (issueNumber(comment.issue_url) !== args.pr) {
    return denied('comment is not on the pull request');
  }
  let request;
  try {
    request = parseRequest('issue_comment', {
      issue: { number: args.pr, pull_request: {} },
      comment,
    });
  } catch (error) {
    return denied(error.message);
  }
  if (!isTrustedAssociation(request.association)) return denied('actor is not a maintainer');
  const permission = await actorPermission({ ...args, actor: request.actor });
  if (!canRequest(permission)) return denied('actor is not a maintainer');
  try {
    const pr = await fetchPr(args);
    const head = /** @type {Record<string, unknown>} */ (pr.head ?? {});
    const headRepo = /** @type {Record<string, unknown>} */ (head.repo ?? {});
    if (pr.state !== 'open') return denied('pull request is not open');
    if (headRepo.full_name !== args.repo) return denied('fork pull request is not supported');
    const model = normalizeModel(request.modelInput, args.config, await loadCatalog(args));
    const base = /** @type {Record<string, unknown>} */ (pr.base ?? {});
    return {
      allowed: true,
      reason: '',
      pr: args.pr,
      command: request.command,
      model,
      actor: request.actor,
      actorPermission: permission,
      baseSha: String(base.sha ?? ''),
      headSha: String(head.sha ?? ''),
      headRef: String(head.ref ?? ''),
    };
  } catch (error) {
    return denied(error.message);
  }
}

/**
 * Write GitHub Actions outputs.
 * @param {Record<string, unknown>} resolution - Resolution.
 * @param {NodeJS.ProcessEnv} env - Process environment.
 * @returns {Promise<void>} Resolves when written.
 */
async function writeOutputs(resolution, env) {
  if (!env.GITHUB_OUTPUT) {
    console.log(JSON.stringify(resolution));
    return;
  }
  const lines = Object.entries(resolution).map(([key, value]) => `${key}=${String(value)}`);
  const { appendFile } = await import('node:fs/promises');
  await appendFile(env.GITHUB_OUTPUT, `${lines.join('\n')}\n`, 'utf8');
}

/**
 * CLI entrypoint.
 * @returns {Promise<void>} Resolves when the request is resolved.
 */
async function main() {
  const env = process.env;
  const config = JSON.parse(
    await readFile(new URL('../../review-agent/config.json', import.meta.url), 'utf8'),
  );
  const resolution = await resolveDispatch({
    repo: env.REVIEW_REPO || env.GITHUB_REPOSITORY || '',
    pr: Number(env.PR_NUMBER),
    commentId: Number(env.REVIEW_COMMENT_ID),
    token: env.REVIEW_TOKEN || env.GITHUB_TOKEN || '',
    config,
  });
  await writeOutputs(resolution, env);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`pr-review dispatch resolve failed: ${error.name}`);
    process.exitCode = 1;
  });
}
