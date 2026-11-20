import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import {
  githubRequest,
  readResponseJson,
  safeJoin,
  writeJsonFile,
  writeTextFile,
} from './shared.mjs';

/** Largest PR body copied into the metadata file. */
const MAX_BODY_CHARS = 20000;

/** One page of changed files. */
const FILES_PER_PAGE = 100;

/** Most changed files copied as review data. */
const MAX_FILES = 300;

/**
 * Fetch the pull request metadata.
 * @param {object} args - Request arguments.
 * @returns {Promise<Record<string, unknown>>} PR metadata.
 */
async function fetchMetadata(args) {
  const response = await githubRequest({
    token: args.token,
    path: `/repos/${args.repo}/pulls/${args.pr}`,
    fetchImpl: args.fetchImpl,
  });
  return /** @type {Record<string, unknown>} */ (await readResponseJson(response));
}

/**
 * Fetch the unified diff.
 * @param {object} args - Request arguments.
 * @returns {Promise<string>} Diff text.
 */
async function fetchDiff(args) {
  const response = await githubRequest({
    token: args.token,
    path: `/repos/${args.repo}/pulls/${args.pr}`,
    accept: 'application/vnd.github.v3.diff',
    fetchImpl: args.fetchImpl,
  });
  if (!response.ok) throw new Error(`GitHub diff answered ${response.status}`);
  return response.text();
}

/**
 * List the changed files, up to the configured cap.
 * @param {object} args - Request arguments.
 * @returns {Promise<Array<Record<string, unknown>>>} Changed files.
 */
async function listFiles(args) {
  const files = [];
  for (let page = 1; files.length < MAX_FILES; page += 1) {
    const response = await githubRequest({
      token: args.token,
      path: `/repos/${args.repo}/pulls/${args.pr}/files?per_page=${FILES_PER_PAGE}&page=${page}`,
      fetchImpl: args.fetchImpl,
    });
    const batch = /** @type {Array<Record<string, unknown>>} */ (await readResponseJson(response));
    files.push(...batch);
    if (batch.length < FILES_PER_PAGE) break;
  }
  return files.slice(0, MAX_FILES);
}

/**
 * Fetch one changed file at the PR head.
 * @param {object} args - Request arguments.
 * @param {string} args.path - Repository path.
 * @param {number} args.maxChars - Largest accepted file.
 * @returns {Promise<string | false>} Text, or false when skipped.
 */
async function fetchFile(args) {
  const response = await githubRequest({
    token: args.token,
    path: `/repos/${args.repo}/contents/${encodeURIComponent(args.path).replaceAll('%2F', '/')}?ref=${args.headSha}`,
    fetchImpl: args.fetchImpl,
  });
  if (!response.ok) return false;
  const body = /** @type {Record<string, unknown>} */ (await readResponseJson(response));
  if (body.encoding !== 'base64' || typeof body.content !== 'string') return false;
  if (Number(body.size ?? 0) > args.maxChars) return false;
  const text = Buffer.from(body.content, 'base64').toString('utf8');
  if (text.includes('\u0000')) return false;
  return text.slice(0, args.maxChars);
}

/**
 * Truncate a diff at a line boundary.
 * @param {string} diff - Full diff.
 * @param {number} maxChars - Character cap.
 * @returns {{ text: string, truncated: boolean }} Capped diff.
 */
export function truncateDiff(diff, maxChars) {
  if (diff.length <= maxChars) return { text: diff, truncated: false };
  const head = diff.slice(0, maxChars);
  const lineEnd = head.lastIndexOf('\n');
  const text = `${head.slice(0, lineEnd > 0 ? lineEnd : maxChars)}\n\n[... diff truncated ...]\n`;
  return { text, truncated: true };
}

/**
 * Fetch PR metadata, diff and changed files into `.review/pr`.
 * @param {object} args - Fetch arguments.
 * @param {string} args.repo - `owner/name`.
 * @param {number} args.pr - Pull request number.
 * @param {string} args.token - GitHub token.
 * @param {string} [args.outDir] - Data directory.
 * @param {number} args.maxDiffChars - Diff cap.
 * @param {number} args.maxFileChars - File cap.
 * @param {string} [args.expectedHeadSha] - SHA resolved before the fetch.
 * @param {typeof fetch} [args.fetchImpl] - Test double.
 * @returns {Promise<Record<string, unknown>>} Fetch summary.
 */
export async function fetchPrData(args) {
  const outDir = args.outDir ?? '.review/pr';
  const metadata = await fetchMetadata(args);
  const base = /** @type {Record<string, unknown>} */ (metadata.base ?? {});
  const head = /** @type {Record<string, unknown>} */ (metadata.head ?? {});
  if (args.expectedHeadSha && head.sha !== args.expectedHeadSha) {
    throw new Error('pull request changed during review');
  }
  const diff = await fetchDiff(args);
  const changed = await listFiles(args);
  const capped = truncateDiff(diff, args.maxDiffChars);
  await writeTextFile(`${outDir}/diff.patch`, capped.text);
  const skipped = [];
  for (const file of changed) {
    const path = String(file.filename ?? '');
    if (path.length === 0) continue;
    const text = await fetchFile({
      repo: args.repo,
      token: args.token,
      headSha: String(head.sha ?? ''),
      path,
      maxChars: args.maxFileChars,
      fetchImpl: args.fetchImpl,
    });
    if (text === false) {
      skipped.push(path);
      continue;
    }
    await writeTextFile(safeJoin(`${outDir}/files`, path), text);
  }
  const body = String(metadata.body ?? '').slice(0, MAX_BODY_CHARS);
  await writeJsonFile(`${outDir}/metadata.json`, {
    number: args.pr,
    title: String(metadata.title ?? ''),
    body,
    author: String((metadata.user ?? {}).login ?? ''),
    baseSha: String(base.sha ?? ''),
    headSha: String(head.sha ?? ''),
    headRef: String(head.ref ?? ''),
    additions: Number(metadata.additions ?? 0),
    deletions: Number(metadata.deletions ?? 0),
    changedFiles: Number(metadata.changed_files ?? 0),
    files: changed.map(file => ({
      path: String(file.filename ?? ''),
      status: String(file.status ?? ''),
      additions: Number(file.additions ?? 0),
      deletions: Number(file.deletions ?? 0),
    })),
    skippedFiles: skipped,
    diffTruncated: capped.truncated,
  });
  return { files: changed.length, skipped: skipped.length, diffTruncated: capped.truncated };
}

/**
 * CLI entrypoint.
 * @returns {Promise<void>} Resolves when the data is written.
 */
async function main() {
  const env = process.env;
  const config = JSON.parse(
    await readFile(new URL('../../review-agent/config.json', import.meta.url), 'utf8'),
  );
  const summary = await fetchPrData({
    repo: env.GITHUB_REPOSITORY ?? '',
    pr: Number(env.PR_NUMBER),
    token: env.GITHUB_TOKEN ?? '',
    maxDiffChars: Number(config.maxDiffChars),
    maxFileChars: Number(config.maxFileChars),
    expectedHeadSha: env.REVIEW_HEAD_SHA ?? '',
  });
  console.log(JSON.stringify(summary));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`pr-review fetch failed: ${error.name}`);
    process.exitCode = 1;
  });
}
