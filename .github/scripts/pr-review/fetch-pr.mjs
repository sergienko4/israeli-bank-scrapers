import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import {
  decodeQuotedPath,
  githubRequest,
  parsePatchPath,
  readQuotedToken,
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

/** Credential-shaped paths never copied into review data. */
const SENSITIVE_PATH_RE =
  /(?:^|\/)(?:\.env(?:\..*)?|id_rsa[^/]*|[^/]+\.(?:pem|key|p12|pfx|crt|cer|jks|keystore)|\.npmrc|\.netrc)$/iu;

/** Credential material that must never reach the model. */
const CREDENTIAL_CONTENT_RE = new RegExp(
  [
    '-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----',
    '\\bAKIA[0-9A-Z]{16}\\b',
    '\\bgh[pousr]_[A-Za-z0-9]{36,}\\b',
    '\\bgithub_pat_[A-Za-z0-9_]{22,}\\b',
    '\\bxox[abprs]-[A-Za-z0-9-]{10,}\\b',
    '\\bsk-[A-Za-z0-9]{20,}\\b',
    '\\beyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\b',
  ].join('|'),
  'u',
);

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
 * Fetch one changed file's exact blob from the Git data API. Reading the blob
 * by SHA never follows a repository symlink.
 * @param {object} args - Request arguments.
 * @param {string} args.blobSha - Blob SHA from the changed-file entry.
 * @param {number} args.maxChars - Largest accepted file.
 * @returns {Promise<string | false>} Text, or false when skipped.
 */
async function fetchFile(args) {
  const response = await githubRequest({
    token: args.token,
    path: `/repos/${args.repo}/git/blobs/${args.blobSha}`,
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
 * Whether a changed path looks like a credential file.
 * @param {string} path - Repository path.
 * @returns {boolean} True when the file must never reach the model.
 */
export function isSensitivePath(path) {
  return SENSITIVE_PATH_RE.test(path);
}

/**
 * Whether text contains known credential material.
 * @param {string} text - File or diff text.
 * @returns {boolean} True when the text must not reach the model.
 */
export function hasCredentialContent(text) {
  return CREDENTIAL_CONTENT_RE.test(text);
}

/**
 * Whether a changed file is, or was, a credential-shaped path.
 * @param {Record<string, unknown>} file - GitHub changed-file entry.
 * @returns {boolean} True for a sensitive current or previous path.
 */
export function isSensitiveFile(file) {
  return (
    isSensitivePath(String(file.filename ?? '')) ||
    isSensitivePath(String(file.previous_filename ?? ''))
  );
}

/**
 * Parse both paths from a `diff --git` line.
 * @param {string} line - Header line.
 * @returns {string[]} Parsed paths; empty when the line is unparsable.
 */
function parseDiffGitPaths(line) {
  const rest = line.slice('diff --git '.length);
  if (rest.startsWith('"')) {
    const source = readQuotedToken(rest);
    if (source === undefined) return [];
    const afterSource = rest.slice(source.length);
    if (!afterSource.startsWith(' ')) return [];
    const destination = readQuotedToken(afterSource.slice(1));
    if (destination === undefined) return [];
    return [parsePatchPath(source, 'a'), parsePatchPath(destination, 'b')].filter(
      path => typeof path === 'string',
    );
  }
  if (!rest.startsWith('a/')) return [];
  const paths = [];
  for (let index = rest.indexOf(' b/'); index !== -1; index = rest.indexOf(' b/', index + 1)) {
    const source = rest.slice(2, index);
    const destination = rest.slice(index + 3);
    if (source.length > 0 && destination.length > 0) paths.push(source, destination);
  }
  return paths;
}

/**
 * Parse one loose path, such as `rename from`.
 * @param {string} value - Raw value.
 * @returns {string | undefined} Decoded path.
 */
function parseLoosePath(value) {
  const token = value.startsWith('"') ? readQuotedToken(value) : value;
  if (token === undefined) return undefined;
  return token.startsWith('"') ? decodeQuotedPath(token) : token;
}

/**
 * Collect both sides of every path in one file block.
 * @param {string} block - Diff block.
 * @returns {string[]} Parsed paths.
 */
function blockPaths(block) {
  const paths = [];
  /**
   * Add a parsed path when it is a real repository path.
   * @param {string | null | undefined} path - Parsed path.
   * @returns {void}
   */
  const add = path => {
    if (typeof path === 'string' && path.length > 0) paths.push(path);
  };
  for (const line of block.split('\n')) {
    if (line.startsWith('@@') || line.startsWith('GIT binary patch')) break;
    if (line.startsWith('diff --git ')) {
      for (const path of parseDiffGitPaths(line)) paths.push(path);
    } else if (line.startsWith('--- ')) {
      add(parsePatchPath(line.slice(4), 'a'));
    } else if (line.startsWith('+++ ')) {
      add(parsePatchPath(line.slice(4), 'b'));
    } else if (line.startsWith('rename from ') || line.startsWith('copy from ')) {
      add(parseLoosePath(line.slice(line.indexOf(' from ') + 6)));
    } else if (line.startsWith('rename to ') || line.startsWith('copy to ')) {
      add(parseLoosePath(line.slice(line.indexOf(' to ') + 4)));
    }
  }
  return paths;
}

/**
 * Drop diff blocks whose source or destination is credential-shaped. A file
 * block with unparsable paths is dropped rather than trusted.
 * @param {string} diff - Unified diff.
 * @returns {string} Diff without sensitive blocks.
 */
export function filterDiff(diff) {
  return diff
    .split(/(?=^diff --git )/mu)
    .filter(block => {
      if (hasCredentialContent(block)) return false;
      const paths = blockPaths(block);
      if (!block.startsWith('diff --git ')) return true;
      if (paths.length === 0) return false;
      return !paths.some(isSensitivePath);
    })
    .join('');
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
 * @param {string} [args.expectedBaseSha] - Base SHA resolved before the fetch.
 * @param {typeof fetch} [args.fetchImpl] - Test double.
 * @returns {Promise<Record<string, unknown>>} Fetch summary.
 */
export async function fetchPrData(args) {
  const outDir = args.outDir ?? '.review/pr';
  const metadata = await fetchMetadata(args);
  const base = /** @type {Record<string, unknown>} */ (metadata.base ?? {});
  const head = /** @type {Record<string, unknown>} */ (metadata.head ?? {});
  assertSnapshot(base, head, args);
  const rawDiff = await fetchDiff(args);
  const filteredDiff = filterDiff(rawDiff);
  const changed = await listFiles(args);
  const sensitive = changed.filter(isSensitiveFile).map(file => String(file.filename ?? ''));
  const capped = truncateDiff(filteredDiff, args.maxDiffChars);
  await writeTextFile(`${outDir}/diff.patch`, capped.text);
  const skipped = [];
  const dataFiles = new Map();
  for (const [index, file] of changed.entries()) {
    const path = String(file.filename ?? '');
    const blobSha = String(file.sha ?? '');
    if (
      path.length === 0 ||
      blobSha.length === 0 ||
      file.status === 'removed' ||
      isSensitiveFile(file)
    ) {
      continue;
    }
    const text = await fetchFile({
      repo: args.repo,
      token: args.token,
      blobSha,
      maxChars: args.maxFileChars,
      fetchImpl: args.fetchImpl,
    });
    if (text === false) {
      skipped.push(path);
      continue;
    }
    if (hasCredentialContent(text)) {
      sensitive.push(path);
      continue;
    }
    const dataFile = `file-${String(index).padStart(3, '0')}.txt`;
    dataFiles.set(path, dataFile);
    await writeTextFile(safeJoin(`${outDir}/files`, dataFile), text);
  }
  const final = await fetchMetadata(args);
  assertSnapshot(
    /** @type {Record<string, unknown>} */ (final.base ?? {}),
    /** @type {Record<string, unknown>} */ (final.head ?? {}),
    args,
  );
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
      dataFile: dataFiles.get(String(file.filename ?? '')) ?? null,
      sensitive: isSensitiveFile(file),
    })),
    skippedFiles: skipped,
    sensitiveFiles: [...new Set(sensitive)],
    credentialContent: hasCredentialContent(rawDiff),
    diffTruncated: capped.truncated,
  });
  return { files: changed.length, skipped: skipped.length, diffTruncated: capped.truncated };
}

/**
 * Refuse a metadata snapshot that no longer matches the resolved request.
 * @param {Record<string, unknown>} base - Current base.
 * @param {Record<string, unknown>} head - Current head.
 * @param {Record<string, unknown>} expected - Resolved SHAs.
 * @returns {void}
 */
function assertSnapshot(base, head, expected) {
  if (expected.expectedHeadSha && head.sha !== expected.expectedHeadSha) {
    throw new Error('pull request changed during review');
  }
  if (expected.expectedBaseSha && base.sha !== expected.expectedBaseSha) {
    throw new Error('pull request changed during review');
  }
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
    expectedBaseSha: env.REVIEW_BASE_SHA ?? '',
  });
  console.log(JSON.stringify(summary));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`pr-review fetch failed: ${error.name}`);
    process.exitCode = 1;
  });
}
