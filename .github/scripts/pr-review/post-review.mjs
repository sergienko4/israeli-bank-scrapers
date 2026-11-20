import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import {
  githubGraphql,
  githubRequest,
  readResponseJson,
  safeError,
  sanitizeText,
} from './shared.mjs';

/** Ordered severities. */
const SEVERITIES = ['critical', 'important', 'suggestion'];

/** Largest expanded overflow section. */
const MAX_OVERFLOW_CHARS = 12000;

/** Longest one overflow body before it is clipped. */
const MAX_OVERFLOW_BODY_CHARS = 1200;

/** Maximum summary characters accepted from the model. */
const MAX_SUMMARY_CHARS = 20000;

/** Maximum title characters accepted from the model. */
const MAX_TITLE_CHARS = 80;

/** Review event used for every post. */
const REVIEW_EVENT = 'COMMENT';

/** Marker that identifies this agent's review. */
const MARKER = '<!-- opencode-review-agent -->';

/** Invalid model output. */
class ReviewFormatError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReviewFormatError';
  }
}

/**
 * Whether a value is a plain object.
 * @param {unknown} value - Candidate.
 * @returns {boolean} True for a non-array object.
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Strip an optional Markdown fence and parse one JSON object.
 * @param {string} text - Model output.
 * @returns {Record<string, unknown>} Parsed object.
 */
export function parseReview(text) {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/iu, '')
    .replace(/\s*```$/u, '');
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) throw new ReviewFormatError('no JSON object');
  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1));
    if (!isRecord(parsed)) throw new ReviewFormatError('not an object');
    return parsed;
  } catch (error) {
    if (error instanceof ReviewFormatError) throw error;
    throw new ReviewFormatError('invalid JSON');
  }
}

/**
 * Validate and normalize the model review.
 * @param {Record<string, unknown>} value - Parsed review.
 * @param {number} maxFindings - Finding cap.
 * @returns {{ summary: string, guidelines_read: string[], findings: Array<Record<string, unknown>> }} Review.
 */
export function validateReview(value, maxFindings) {
  const summary = String(value.summary ?? '');
  if (summary.length === 0 || summary.length > MAX_SUMMARY_CHARS) {
    throw new ReviewFormatError('summary length');
  }
  const guidelines = Array.isArray(value.guidelines_read)
    ? value.guidelines_read.filter(item => typeof item === 'string').slice(0, 100)
    : [];
  if (!Array.isArray(value.findings)) throw new ReviewFormatError('findings is not an array');
  const findings = value.findings
    .map(validateFinding)
    .sort((left, right) => severityRank(left) - severityRank(right))
    .slice(0, maxFindings);
  return { summary, guidelines_read: guidelines, findings };
}

/**
 * Rank one finding by severity.
 * @param {Record<string, unknown>} finding - Finding.
 * @returns {number} Lower is more severe.
 */
function severityRank(finding) {
  return SEVERITIES.indexOf(String(finding.severity));
}

/**
 * Validate one finding.
 * @param {unknown} value - Candidate finding.
 * @returns {Record<string, unknown>} Normalized finding.
 */
function validateFinding(value) {
  if (!isRecord(value)) throw new ReviewFormatError('finding is not an object');
  const severity = String(value.severity ?? '');
  const path = String(value.path ?? '');
  const title = String(value.title ?? '');
  const body = String(value.body ?? '');
  const line = Number(value.line);
  if (!SEVERITIES.includes(severity)) throw new ReviewFormatError('finding severity');
  if (path.length === 0 || title.length === 0 || title.length > MAX_TITLE_CHARS) {
    throw new ReviewFormatError('finding title or path');
  }
  if (!Number.isInteger(line) || line <= 0 || body.length === 0) {
    throw new ReviewFormatError('finding line or body');
  }
  return {
    severity,
    path,
    line,
    title,
    body,
    rule: String(value.rule ?? ''),
  };
}

/**
 * Map each changed path to its added line numbers.
 * @param {string} diff - Unified diff.
 * @returns {Map<string, Set<number>>} Added lines by path.
 */
export function parseAddedLines(diff) {
  const lines = new Map();
  let path = '';
  let newLine = 0;
  for (const text of diff.split('\n')) {
    const header = /^\+\+\+ b\/(.+?)(?:\t.*)?$/u.exec(text);
    if (header !== null) {
      path = header[1];
      lines.set(path, lines.get(path) ?? new Set());
      continue;
    }
    if (text.startsWith('+++ /dev/null')) {
      path = '';
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/u.exec(text);
    if (hunk !== null) {
      newLine = Number(hunk[1]);
      continue;
    }
    if (path.length === 0 || newLine === 0) continue;
    if (text.startsWith('+')) {
      lines.get(path)?.add(newLine);
      newLine += 1;
    } else if (!text.startsWith('-') && !text.startsWith('\\')) {
      newLine += 1;
    }
  }
  return lines;
}

/**
 * Attach findings to added lines and overflow the rest into the summary.
 * @param {Array<Record<string, unknown>>} findings - Validated findings.
 * @param {Map<string, Set<number>>} added - Added lines by path.
 * @param {number} maxInline - Inline cap.
 * @returns {{ inline: Array<Record<string, unknown>>, overflow: Array<Record<string, unknown>> }} Split.
 */
export function mapFindings(findings, added, maxInline) {
  const inline = [];
  const overflow = [];
  for (const finding of findings) {
    const path = String(finding.path);
    const line = Number(finding.line);
    const isAdded = added.get(path)?.has(line) === true;
    if (isAdded && inline.length < maxInline) inline.push(finding);
    else overflow.push(finding);
  }
  return { inline, overflow };
}

/**
 * Format one finding as an inline comment body.
 * @param {Record<string, unknown>} finding - Finding.
 * @returns {string} Safe comment body.
 */
function commentBody(finding) {
  const rule = String(finding.rule ?? '');
  const suffix = rule.length > 0 ? `\n\nRule: ${sanitizeText(rule)}` : '';
  return `**${sanitizeText(finding.title)}**\n\n${sanitizeText(finding.body)}${suffix}`;
}

/**
 * Build the review summary with overflow findings.
 * @param {object} args - Summary arguments.
 * @param {string} args.summary - Model summary.
 * @param {Array<Record<string, unknown>>} args.overflow - Findings not inline.
 * @returns {string} Review body.
 */
function summaryBody(args) {
  const overflow = overflowBlock(args.overflow);
  const extra = overflow.length > 0 ? `\n\n### Findings not attached inline\n\n${overflow}\n` : '';
  return `${MARKER}\n\n${sanitizeText(args.summary)}${extra}`;
}

/**
 * Render overflow findings with enough detail to act on, within a budget.
 * @param {Array<Record<string, unknown>>} findings - Findings not inline.
 * @returns {string} Markdown block, or ''.
 */
function overflowBlock(findings) {
  const blocks = [];
  let used = 0;
  for (const finding of findings) {
    const body = sanitizeText(finding.body).slice(0, MAX_OVERFLOW_BODY_CHARS);
    const rule = String(finding.rule ?? '');
    const ruleLine = rule.length > 0 ? `\n  Rule: ${sanitizeText(rule)}` : '';
    const block = `- **${sanitizeText(finding.severity)}** \`${sanitizeText(finding.path)}:${finding.line}\` **${sanitizeText(finding.title)}**\n  ${body}${ruleLine}`;
    if (used + block.length > MAX_OVERFLOW_CHARS) break;
    blocks.push(block);
    used += block.length;
  }
  return blocks.join('\n');
}

/**
 * Minimize an earlier review from this agent, if one exists.
 * @param {object} args - Request arguments.
 * @returns {Promise<void>} Resolves when done.
 */
async function latestEarlier(args) {
  const reviews = [];
  for (let page = 1; page <= 5; page += 1) {
    const response = await githubRequest({
      token: args.token,
      path: `/repos/${args.repo}/pulls/${args.pr}/reviews?per_page=100&page=${page}`,
      fetchImpl: args.fetchImpl,
    });
    if (!response.ok) break;
    const batch = /** @type {Array<Record<string, unknown>>} */ (await readResponseJson(response));
    reviews.push(...batch);
    if (batch.length < 100) break;
  }
  const earlier = reviews
    .filter(
      review =>
        String((review.user ?? {}).login ?? '') === 'github-actions[bot]' &&
        String(review.body ?? '').includes(MARKER),
    )
    .sort(
      (left, right) =>
        Date.parse(String(left.submitted_at ?? '')) - Date.parse(String(right.submitted_at ?? '')),
    )
    .at(-1);
  return earlier;
}

/**
 * Minimize one earlier review.
 * @param {object} args - Request arguments.
 * @param {Record<string, unknown>} review - Earlier review.
 * @returns {Promise<void>} Resolves when done.
 */
async function minimizeReview(args, review) {
  const nodeId = String(review.node_id ?? '');
  if (nodeId.length === 0) return;
  await githubGraphql({
    token: args.token,
    query:
      'mutation($id:ID!){minimizeComment(input:{subjectId:$id,classifier:OUTDATED}){minimizedComment{isMinimized}}}',
    variables: { id: nodeId },
    fetchImpl: args.fetchImpl,
  }).catch(() => undefined);
}

/**
 * Post one COMMENT review.
 * @param {object} args - Review arguments.
 * @param {string} args.repo - `owner/name`.
 * @param {number} args.pr - Pull request number.
 * @param {string} args.token - GitHub token.
 * @param {string} args.headSha - Head commit.
 * @param {string} args.summary - Model summary.
 * @param {Array<Record<string, unknown>>} args.inline - Inline findings.
 * @param {Array<Record<string, unknown>>} args.overflow - Summary findings.
 * @param {typeof fetch} [args.fetchImpl] - Test double.
 * @returns {Promise<Record<string, unknown>>} Posted review.
 */
export function buildReview(args) {
  const comments = args.inline.map(finding => ({
    path: String(finding.path),
    line: Number(finding.line),
    side: 'RIGHT',
    body: commentBody(finding),
  }));
  const payload = {
    commit_id: args.headSha,
    body: summaryBody({ summary: args.summary, overflow: args.overflow }),
    event: REVIEW_EVENT,
  };
  if (comments.length > 0) payload.comments = comments;
  return payload;
}

export async function postReview(args) {
  const earlier = await latestEarlier(args);
  const payload = buildReview(args);
  const response = await githubRequest({
    token: args.token,
    path: `/repos/${args.repo}/pulls/${args.pr}/reviews`,
    method: 'POST',
    body: payload,
    fetchImpl: args.fetchImpl,
  });
  const review = /** @type {Record<string, unknown>} */ (await readResponseJson(response));
  if (earlier !== undefined) await minimizeReview(args, earlier);
  return { id: review.id, htmlUrl: review.html_url, inline: payload.comments?.length ?? 0 };
}

/**
 * Post a summary-only failure review.
 * @param {object} args - Failure arguments.
 * @param {string} args.repo - `owner/name`.
 * @param {number} args.pr - Pull request number.
 * @param {string} args.token - GitHub token.
 * @param {string} args.headSha - Head commit.
 * @param {string} args.message - Safe failure message.
 * @param {typeof fetch} [args.fetchImpl] - Test double.
 * @returns {Promise<Record<string, unknown>>} Posted review.
 */
export async function postFailure(args) {
  const summary = `## Review failed\n\nThe review agent could not produce a valid review. ${args.message}`;
  return postReview({ ...args, summary, inline: [], overflow: [] });
}

/**
 * Read and validate the agent result.
 * @param {string} path - Result file.
 * @param {number} maxFindings - Finding cap.
 * @returns {Promise<ReturnType<typeof validateReview>>} Review.
 */
async function readReview(path, maxFindings) {
  const text = await readFile(path, 'utf8');
  return validateReview(parseReview(text), maxFindings);
}

/**
 * CLI entrypoint.
 * @returns {Promise<void>} Resolves when posted.
 */
async function main() {
  const env = process.env;
  const config = JSON.parse(
    await readFile(new URL('../../review-agent/config.json', import.meta.url), 'utf8'),
  );
  if (process.argv.includes('--failure')) {
    await postFailure({
      repo: env.GITHUB_REPOSITORY ?? '',
      pr: Number(env.PR_NUMBER),
      token: env.GITHUB_TOKEN ?? '',
      headSha: env.REVIEW_HEAD_SHA ?? '',
      message: 'The review run did not finish. Check the workflow log.',
    });
    return;
  }
  const diff = await readFile(env.REVIEW_DIFF || '.review/pr/diff.patch', 'utf8');
  const added = parseAddedLines(diff);
  let review;
  try {
    review = await readReview(env.REVIEW_RESULT || '.review/pr/result.json', config.maxFindings);
  } catch (error) {
    await postFailure({
      repo: env.GITHUB_REPOSITORY ?? '',
      pr: Number(env.PR_NUMBER),
      token: env.GITHUB_TOKEN ?? '',
      headSha: env.REVIEW_HEAD_SHA ?? '',
      message: safeError(error),
    });
    process.exitCode = 1;
    return;
  }
  const split = mapFindings(review.findings, added, config.maxInlineComments);
  if (process.argv.includes('--dry-run')) {
    console.log(
      JSON.stringify(
        buildReview({
          headSha: env.REVIEW_HEAD_SHA ?? '',
          summary: review.summary,
          inline: split.inline,
          overflow: split.overflow,
        }),
        null,
        2,
      ),
    );
    return;
  }
  const posted = await postReview({
    repo: env.GITHUB_REPOSITORY ?? '',
    pr: Number(env.PR_NUMBER),
    token: env.GITHUB_TOKEN ?? '',
    headSha: env.REVIEW_HEAD_SHA ?? '',
    summary: review.summary,
    inline: split.inline,
    overflow: split.overflow,
  });
  console.log(JSON.stringify(posted));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`pr-review post failed: ${error.name}`);
    process.exitCode = 1;
  });
}
