import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

/** GitHub API version used by every request. */
const API_VERSION = '2022-11-28';

/** Maximum characters quoted from any file. */
const MAX_QUOTE_CHARS = 20000;

/** Root the review scripts may write under. */
const REVIEW_ROOT = resolve('.review');

/**
 * Refuse a write outside the review data root.
 * @param {string} path - Candidate path.
 * @returns {string} Absolute path under `.review/`.
 */
export function reviewPath(path) {
  const target = resolve(path);
  if (target !== REVIEW_ROOT && !target.startsWith(`${REVIEW_ROOT}${sep}`)) {
    throw new Error('write escapes the review data directory');
  }
  return target;
}

/**
 * Read a JSON file.
 * @param {string} path - File path.
 * @returns {Promise<unknown>} Parsed JSON.
 */
export async function readJsonFile(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

/**
 * Write a UTF-8 file, creating parent directories.
 * @param {string} path - File path.
 * @param {string} text - File contents.
 * @returns {Promise<void>} Resolves when written.
 */
export async function writeTextFile(path, text) {
  const target = reviewPath(path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, text, 'utf8');
}

/**
 * Write a JSON file, creating parent directories.
 * @param {string} path - File path.
 * @param {unknown} value - JSON value.
 * @returns {Promise<void>} Resolves when written.
 */
export async function writeJsonFile(path, value) {
  await writeTextFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Join a path under a root and refuse traversal outside it.
 * @param {string} root - Trusted root.
 * @param {string} relative - Untrusted relative path.
 * @returns {string} Safe path under root.
 */
export function safeJoin(root, relative) {
  const base = resolve(root);
  const target = resolve(base, relative.replaceAll('\\', '/'));
  if (target !== base && !target.startsWith(`${base}${sep}`)) {
    throw new Error('path escapes the review data directory');
  }
  return target;
}

/**
 * Build a relative path under the review data directory.
 * @param {string[]} parts - Path parts.
 * @returns {string} Joined relative path.
 */
export function joinReviewPath(...parts) {
  return join('.review', 'pr', ...parts);
}

/**
 * Call the GitHub REST API.
 * @param {object} args - Request arguments.
 * @param {string} args.token - GitHub token.
 * @param {string} args.path - API path beginning with `/`.
 * @param {string} [args.accept] - Accept header.
 * @param {string} [args.method] - HTTP method.
 * @param {unknown} [args.body] - JSON body.
 * @param {typeof fetch} [args.fetchImpl] - Test double.
 * @returns {Promise<Response>} Response.
 */
export async function githubRequest(args) {
  const { token, path, accept = 'application/vnd.github+json' } = args;
  const init = {
    method: args.method ?? 'GET',
    headers: {
      Accept: accept,
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': API_VERSION,
      'User-Agent': 'israeli-bank-scrapers-review-agent',
    },
  };
  if (args.body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(args.body);
  }
  return (args.fetchImpl ?? fetch)(`https://api.github.com${path}`, init);
}

/**
 * Call the GitHub GraphQL API.
 * @param {object} args - Request arguments.
 * @param {string} args.token - GitHub token.
 * @param {string} args.query - GraphQL document.
 * @param {Record<string, unknown>} [args.variables] - Variables.
 * @param {typeof fetch} [args.fetchImpl] - Test double.
 * @returns {Promise<Response>} Response.
 */
export async function githubGraphql(args) {
  const fetcher = args.fetchImpl ?? fetch;
  return fetcher('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${args.token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'israeli-bank-scrapers-review-agent',
    },
    body: JSON.stringify({ query: args.query, variables: args.variables ?? {} }),
  });
}

/**
 * Read one JSON API response, refusing a non-2xx answer.
 * @param {Response} response - API response.
 * @returns {Promise<unknown>} Parsed body.
 */
export async function readResponseJson(response) {
  if (!response.ok) throw new Error(`GitHub API answered ${response.status}`);
  return response.json();
}

/**
 * Whether an author association is trusted enough to request a review.
 * @param {unknown} association - GitHub author_association.
 * @returns {boolean} True for owner, member or collaborator.
 */
export function isTrustedAssociation(association) {
  return ['OWNER', 'MEMBER', 'COLLABORATOR'].includes(String(association));
}

/**
 * Whether a collaborator permission can request a review.
 * @param {unknown} permission - GitHub permission name.
 * @returns {boolean} True for admin, maintain or write.
 */
export function canRequest(permission) {
  return ['admin', 'maintain', 'write'].includes(String(permission));
}

/**
 * Escape HTML and dangerous link protocols in model text.
 * @param {unknown} value - Untrusted text.
 * @returns {string} Safe Markdown/plain text.
 */
export function sanitizeText(value) {
  const text = String(value ?? '').slice(0, MAX_QUOTE_CHARS);
  const withoutControls = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '');
  const escaped = withoutControls.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
  return escaped.replace(/\]\((?:(?:javascript|data|vbscript):)[^)]*\)/giu, '](# "blocked link")');
}

/**
 * Build a fixed failure message without response text.
 * @param {unknown} error - Caught error.
 * @returns {string} Safe message.
 */
export function safeError(error) {
  const name = error instanceof Error ? error.name : 'Error';
  return `review agent failed: ${name}`;
}
