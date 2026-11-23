import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { finishProgress, startProgress } from './progress.mjs';

/**
 * Build progress arguments from the environment.
 * @param {NodeJS.ProcessEnv} env - Process environment.
 * @returns {Record<string, unknown>} Progress arguments.
 */
export function argsFromEnv(env) {
  const externalId =
    env.REVIEW_COMMENT_ID || `manual-${env.PR_NUMBER || '0'}-${env.GITHUB_RUN_ID || '0'}`;
  return {
    repo: env.REVIEW_REPO || env.GITHUB_REPOSITORY || '',
    pr: Number(env.PR_NUMBER),
    token: env.REVIEW_TOKEN || env.GITHUB_TOKEN || '',
    headSha: env.REVIEW_HEAD_SHA || '',
    externalId,
    appLogin: env.REVIEW_APP_LOGIN || 'github-actions[bot]',
    checkName: env.REVIEW_CHECK_NAME || undefined,
    marker: env.REVIEW_PROGRESS_MARKER || undefined,
  };
}

/**
 * Preserve known IDs when a stage update returns no replacements.
 * @param {{ commentId: number, checkRunId: number }} ids - Stage IDs.
 * @param {NodeJS.ProcessEnv} env - Process environment.
 * @returns {{ commentId: number, checkRunId: number }} Effective IDs.
 */
export function stageIds(ids, env) {
  const checkRunId = ids.checkRunId > 0 ? ids.checkRunId : Number(env.REVIEW_CHECK_ID || 0);
  const commentId = ids.commentId > 0 ? ids.commentId : Number(env.REVIEW_PROGRESS_COMMENT_ID || 0);
  return { commentId, checkRunId };
}

/**
 * Append GitHub Actions outputs.
 * @param {Record<string, unknown>} values - Output values.
 * @param {NodeJS.ProcessEnv} env - Process environment.
 * @returns {Promise<void>} Resolves when written.
 */
async function writeOutputs(values, env) {
  if (!env.GITHUB_OUTPUT) {
    console.log(JSON.stringify(values));
    return;
  }
  const lines = Object.entries(values).map(([key, value]) => `${key}=${String(value)}`);
  await appendFile(env.GITHUB_OUTPUT, `${lines.join('\n')}\n`, 'utf8');
}

/**
 * CLI entrypoint.
 * @returns {Promise<void>} Resolves when the action completes.
 */
async function main() {
  const env = process.env;
  const args = argsFromEnv(env);
  const stageIndex = process.argv.indexOf('--stage');
  if (stageIndex >= 0) {
    const stage = process.argv[stageIndex + 1] || 'start';
    const ids = await startProgress({ ...args, stage });
    await writeOutputs(stageIds(ids, env), env);
    return;
  }
  if (process.argv.includes('--start')) {
    const ids = await startProgress(args);
    await writeOutputs(ids, env);
    return;
  }
  if (process.argv.includes('--finish')) {
    await finishProgress({
      ...args,
      checkRunId: Number(env.REVIEW_CHECK_ID),
      commentId: Number(env.REVIEW_PROGRESS_COMMENT_ID),
      conclusion: env.REVIEW_CONCLUSION || 'neutral',
      findings: Number(env.REVIEW_FINDINGS || 0),
      failed: env.REVIEW_FAILED === 'true',
    });
    await writeOutputs({ done: true }, env);
    return;
  }
  throw new Error('use --start or --finish');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`pr-review progress failed: ${error.name}`);
    process.exitCode = 1;
  });
}
