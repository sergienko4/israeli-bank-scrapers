import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

/** GitHub API version used by every request. */
const API_VERSION = '2022-11-28';

/** Maximum characters quoted from any file. */
const MAX_QUOTE_CHARS = 20000;

/** Root the review scripts may write under. */
const REVIEW_ROOT = resolve('.review');

/** C-style escapes Git uses inside a quoted path. */
const GIT_ESCAPES = new Map([
  ['a', 0x07],
  ['b', 0x08],
  ['t', 0x09],
  ['n', 0x0a],
  ['v', 0x0b],
  ['f', 0x0c],
  ['r', 0x0d],
  ['"', 0x22],
  ['\\', 0x5c],
]);

/**
 * Read one C-quoted token.
 * @param {string} text - Text beginning with a quote.
 * @returns {string | undefined} Quoted token, or undefined when unterminated.
 */
export function readQuotedToken(text) {
  if (!text.startsWith('"')) return undefined;
  for (let index = 1; index < text.length; index += 1) {
    if (text[index] === '\\') {
      index += 1;
      continue;
    }
    if (text[index] === '"') return text.slice(0, index + 1);
  }
  return undefined;
}

/**
 * Decode a C-quoted Git path, including octal UTF-8 bytes.
 * @param {string} token - Quoted token.
 * @returns {string | undefined} Decoded path, or undefined when malformed.
 */
export function decodeQuotedPath(token) {
  const chunks = [];
  let text = '';
  for (let index = 1; index < token.length; index += 1) {
    const char = token[index];
    if (char === '"') {
      chunks.push(Buffer.from(text, 'utf8'));
      return Buffer.concat(chunks).toString('utf8');
    }
    if (char !== '\\') {
      text += char;
      continue;
    }
    const next = token[index + 1];
    if (next === undefined) return undefined;
    chunks.push(Buffer.from(text, 'utf8'));
    text = '';
    if (/[0-7]/u.test(next)) {
      const octal = token.slice(index + 1, index + 4);
      if (!/^[0-3][0-7]{2}$/u.test(octal)) return undefined;
      chunks.push(Buffer.from([Number.parseInt(octal, 8)]));
      index += 3;
      continue;
    }
    const escaped = GIT_ESCAPES.get(next);
    if (escaped === undefined) return undefined;
    chunks.push(Buffer.from([escaped]));
    index += 1;
  }
  return undefined;
}

/**
 * Parse one `a/` or `b/` patch path.
 * @param {string} value - Header value.
 * @param {'a' | 'b'} prefix - Expected side.
 * @returns {string | null | undefined} Path, null for `/dev/null`, or undefined.
 */
export function parsePatchPath(value, prefix) {
  const token = value.startsWith('"') ? readQuotedToken(value) : value.split('\t', 1)[0];
  if (token === undefined) return undefined;
  if (token === '/dev/null') return null;
  const decoded = token.startsWith('"') ? decodeQuotedPath(token) : token;
  if (decoded === undefined) return undefined;
  const expected = `${prefix}/`;
  if (!decoded.startsWith(expected) || decoded.length === expected.length) return undefined;
  return decoded.slice(expected.length);
}

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
