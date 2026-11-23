import { appendFile } from 'node:fs/promises';
import { finishProgress, startProgress } from './progress.mjs';

/**
 * Build progress arguments from the environment.
 * @param {NodeJS.ProcessEnv} env - Process environment.
 * @returns {Record<string, unknown>} Progress arguments.
 */
function argsFromEnv(env) {
  return {
    repo: env.REVIEW_REPO || env.GITHUB_REPOSITORY || '',
    pr: Number(env.PR_NUMBER),
    token: env.REVIEW_TOKEN || env.GITHUB_TOKEN || '',
    headSha: env.REVIEW_HEAD_SHA || '',
    externalId: env.REVIEW_COMMENT_ID || '',
    appLogin: env.REVIEW_APP_LOGIN || 'github-actions[bot]',
    checkName: env.REVIEW_CHECK_NAME || undefined,
    marker: env.REVIEW_PROGRESS_MARKER || undefined,
  };
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
    const checkRunId = ids.checkRunId > 0 ? ids.checkRunId : Number(env.REVIEW_CHECK_ID || 0);
    const commentId =
      ids.commentId > 0 ? ids.commentId : Number(env.REVIEW_PROGRESS_COMMENT_ID || 0);
    await writeOutputs({ commentId, checkRunId }, env);
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

main().catch(error => {
  console.error(`pr-review progress failed: ${error.name}`);
  process.exitCode = 1;
});
