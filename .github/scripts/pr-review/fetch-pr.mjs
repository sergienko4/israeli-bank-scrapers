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

/** Default diff character cap. */
const DEFAULT_MAX_DIFF_CHARS = 120000;

/** Default per-file character cap. */
const DEFAULT_MAX_FILE_CHARS = 60000;

/**
 * Use a positive finite configuration limit, or the default.
 * @param {unknown} value - Configuration value.
 * @param {number} fallback - Default limit.
 * @returns {number} Effective limit.
 */
function configLimit(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

/** Credential-shaped paths never copied into review data. */
const SENSITIVE_PATH_RE =
  /(?:^|\/)(?:\.env(?:\..*)?|\.git-credentials|id_rsa[^/]*|[^/]+\.(?:pem|key|p12|pfx|crt|cer|jks|keystore)|\.npmrc|\.netrc)$/iu;

/** Credential material that must never reach the model. */
const CREDENTIAL_CONTENT_RE = new RegExp(
  [
    '-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----',
    '\\bAKIA[0-9A-Z]{16}\\b',
    '\\bgh[pousr]_[A-Za-z0-9]{36,}\\b',
    '\\bgithub_pat_[A-Za-z0-9_]{22,}\\b',
    '\\bxox[abprs]-[A-Za-z0-9-]{10,}\\b',
    '\\bsk-[A-Za-z0-9_-]{20,}\\b',
    '\\beyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\b',
  ].join('|'),
  'iu',
);

/** Longest accepted URL scheme prefix. */
const MAX_URL_SCHEME_CHARS = 32;

/**
 * Whether a character can appear in a URL scheme.
 * @param {string} char - One character.
 * @returns {boolean} True for a scheme character.
 */
function isSchemeChar(char) {
  return (
    (char >= 'a' && char <= 'z') ||
    (char >= 'A' && char <= 'Z') ||
    (char >= '0' && char <= '9') ||
    char === '+' ||
    char === '.' ||
    char === '-'
  );
}

/**
 * Whether a character ends a single URL authority token.
 * @param {string} char - One character.
 * @returns {boolean} True at whitespace or a delimiter.
 */
function isAuthorityBoundary(char) {
  const code = char.codePointAt(0) ?? 0;
  return (
    code <= 0x20 ||
    char === '/' ||
    char === '?' ||
    char === '#' ||
    char === '"' ||
    char === '`' ||
    char === '<' ||
    char === '>'
  );
}

/**
 * Whether a character is escaped by an odd number of backslashes.
 * @param {string} text - Whole text.
 * @param {number} index - Character index.
 * @returns {boolean} True when the character is escaped.
 */
function isEscaped(text, index) {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

/**
 * Whether text has a URL with userinfo in one authority token.
 * Scans each `://` once instead of letting the regex engine rescan suffixes.
 * @param {string} text - Text.
 * @returns {boolean} True for a credential-bearing URL.
 */
/**
 * Whether an apostrophe is part of a word such as a contraction.
 * @param {string} text - Whole text.
 * @param {number} index - Apostrophe index.
 * @returns {boolean} True when both neighbours are letters.
 */
function isContraction(text, index) {
  const previous = text[index - 1] ?? '';
  const next = text[index + 1] ?? '';
  const isLetter = char => (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z');
  return isLetter(previous) && isLetter(next);
}

function hasUrlUserinfo(text) {
  let quote = '';
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === '\n' || char === '\r') {
      quote = '';
      index += 1;
      continue;
    }
    if (quote.length > 0) {
      if (char === '\\') {
        index += 2;
        continue;
      }
      if (char === quote) {
        quote = '';
        index += 1;
        continue;
      }
    } else if (char === '"' || (char === "'" && !isContraction(text, index))) {
      quote = char;
      index += 1;
      continue;
    }
    if (char !== ':' || text[index + 1] !== '/' || text[index + 2] !== '/') {
      index += 1;
      continue;
    }
    let start = index;
    let length = 0;
    while (start > 0 && length < MAX_URL_SCHEME_CHARS && isSchemeChar(text[start - 1])) {
      start -= 1;
      length += 1;
    }
    let scheme = text.slice(start, index);
    while (scheme.length > 0 && (scheme[0] === '+' || scheme[0] === '-')) {
      scheme = scheme.slice(1);
    }
    const first = scheme[0] ?? '';
    const hasScheme =
      scheme.length > 0 && ((first >= 'a' && first <= 'z') || (first >= 'A' && first <= 'Z'));
    if (!hasScheme) {
      index += 1;
      continue;
    }
    let end = index + 3;
    while (end < text.length) {
      const next = text[end];
      if (quote.length > 0 && next === quote && !isEscaped(text, end)) break;
      if (isAuthorityBoundary(next)) break;
      end += 1;
    }
    const authority = text.slice(index + 3, end);
    if (authority.lastIndexOf('@') > 0) return true;
    index = end;
  }
  return false;
}

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
  const maxFiles = configLimit(args.maxFiles, MAX_FILES);
  for (let page = 1; files.length < maxFiles; page += 1) {
    const response = await githubRequest({
      token: args.token,
      path: `/repos/${args.repo}/pulls/${args.pr}/files?per_page=${FILES_PER_PAGE}&page=${page}`,
      fetchImpl: args.fetchImpl,
    });
    const batch = /** @type {Array<Record<string, unknown>>} */ (await readResponseJson(response));
    files.push(...batch);
    if (batch.length < FILES_PER_PAGE) break;
  }
  return files.slice(0, maxFiles);
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
  return CREDENTIAL_CONTENT_RE.test(text) || hasUrlUserinfo(text);
}

/**
 * Redact one metadata field when it contains credential material.
 * @param {unknown} value - Field value.
 * @returns {string} Safe field text.
 */
function safeMetadata(value) {
  const text = String(value ?? '');
  return hasCredentialContent(text) ? '[REDACTED]' : text;
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
 * @returns {{ text: string, dropped: number }} Filtered diff and drop count.
 */
export function filterDiffWithReport(diff) {
  const blocks = [];
  let dropped = 0;
  for (const block of diff.split(/(?=^diff --git )/mu)) {
    if (hasCredentialContent(block)) {
      dropped += 1;
      continue;
    }
    const paths = blockPaths(block);
    if (block.startsWith('diff --git ')) {
      if (paths.length === 0 || paths.some(isSensitivePath)) {
        dropped += 1;
        continue;
      }
    }
    blocks.push(block);
  }
  return { text: blocks.join(''), dropped };
}

/**
 * Drop sensitive diff blocks.
 * @param {string} diff - Unified diff.
 * @returns {string} Diff without sensitive blocks.
 */
export function filterDiff(diff) {
  return filterDiffWithReport(diff).text;
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
 * @param {number} [args.maxFiles] - Changed-file cap.
 * @param {string} [args.expectedHeadSha] - SHA resolved before the fetch.
 * @param {string} [args.expectedBaseSha] - Base SHA resolved before the fetch.
 * @param {typeof fetch} [args.fetchImpl] - Test double.
 * @returns {Promise<Record<string, unknown>>} Fetch summary.
 */
export async function fetchPrData(args) {
  const outDir = args.outDir ?? '.review/pr';
  const maxDiffChars = configLimit(args.maxDiffChars, DEFAULT_MAX_DIFF_CHARS);
  const maxFileChars = configLimit(args.maxFileChars, DEFAULT_MAX_FILE_CHARS);
  const metadata = await fetchMetadata(args);
  const base = /** @type {Record<string, unknown>} */ (metadata.base ?? {});
  const head = /** @type {Record<string, unknown>} */ (metadata.head ?? {});
  assertSnapshot(base, head, args);
  const rawDiff = await fetchDiff(args);
  const filtered = filterDiffWithReport(rawDiff);
  const filteredDiff = filtered.text;
  const changed = await listFiles(args);
  const sensitive = changed.filter(isSensitiveFile).map(file => String(file.filename ?? ''));
  const capped = truncateDiff(filteredDiff, maxDiffChars);
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
      maxChars: maxFileChars,
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
  const rawBody = String(metadata.body ?? '');
  const rawTitle = String(metadata.title ?? '');
  const body = safeMetadata(rawBody).slice(0, MAX_BODY_CHARS);
  const title = safeMetadata(rawTitle);
  await writeJsonFile(`${outDir}/metadata.json`, {
    number: args.pr,
    title,
    body,
    author: safeMetadata((metadata.user ?? {}).login),
    baseSha: String(base.sha ?? ''),
    headSha: String(head.sha ?? ''),
    headRef: safeMetadata(head.ref),
    additions: Number(metadata.additions ?? 0),
    deletions: Number(metadata.deletions ?? 0),
    changedFiles: Number(metadata.changed_files ?? 0),
    files: changed.map(file => ({
      path: safeMetadata(file.filename),
      status: String(file.status ?? ''),
      additions: Number(file.additions ?? 0),
      deletions: Number(file.deletions ?? 0),
      dataFile: dataFiles.get(String(file.filename ?? '')) ?? null,
      sensitive: isSensitiveFile(file),
    })),
    skippedFiles: skipped.map(safeMetadata),
    sensitiveFiles: [...new Set(sensitive)].map(safeMetadata),
    diffDropped: filtered.dropped > 0,
    credentialContent:
      hasCredentialContent(rawDiff) ||
      hasCredentialContent(rawTitle) ||
      hasCredentialContent(rawBody),
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
    repo: env.REVIEW_REPO || env.GITHUB_REPOSITORY || '',
    pr: Number(env.PR_NUMBER),
    token: env.REVIEW_TOKEN || env.GITHUB_TOKEN || '',
    maxDiffChars: configLimit(config.maxDiffChars, DEFAULT_MAX_DIFF_CHARS),
    maxFileChars: configLimit(config.maxFileChars, DEFAULT_MAX_FILE_CHARS),
    maxFiles: configLimit(config.maxFiles, MAX_FILES),
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
