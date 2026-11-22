import { appendFile, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { listReviews } from './review-history.mjs';
import {
  githubGraphql,
  githubRequest,
  parsePatchPath,
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

/** Default review event when the caller does not choose one. */
const DEFAULT_REVIEW_EVENT = 'COMMENT';

/** Review events the posting script may submit. */
const REVIEW_EVENTS = new Set(['COMMENT', 'APPROVE', 'REQUEST_CHANGES']);

/** Legacy workflow identity that uses minimization instead of dismissal. */
const LEGACY_APP_LOGIN = 'github-actions[bot]';

/** Prefix that identifies this agent's review. */
const MARKER = '<!-- opencode-review-agent';

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
 * @param {Map<string, Set<number>>} [added] - Added lines by path; when given,
 *   every finding must anchor before the cap is applied.
 * @returns {{ summary: string, guidelines_read: string[], findings: Array<Record<string, unknown>>, complete: boolean }} Review.
 */
export function validateReview(value, maxFindings, added) {
  const summary = String(value.summary ?? '');
  if (summary.length === 0 || summary.length > MAX_SUMMARY_CHARS) {
    throw new ReviewFormatError('summary length');
  }
  const guidelines = Array.isArray(value.guidelines_read)
    ? value.guidelines_read.filter(item => typeof item === 'string').slice(0, 100)
    : [];
  if (!Array.isArray(value.findings)) throw new ReviewFormatError('findings is not an array');
  const validated = value.findings.map(validateFinding);
  if (added !== undefined) {
    const hasOffDiffFinding = validated.some(
      finding => added.get(String(finding.path))?.has(Number(finding.line)) !== true,
    );
    if (hasOffDiffFinding) throw new ReviewFormatError('finding outside the reviewed diff');
  }
  const findings = validated
    .sort((left, right) => severityRank(left) - severityRank(right))
    .slice(0, maxFindings);
  return { summary, guidelines_read: guidelines, findings, complete: value.complete === true };
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

/** Old and new line deltas for each hunk line prefix. */
const HUNK_DELTAS = {
  '+': { old: 0, new: 1 },
  '-': { old: 1, new: 0 },
  ' ': { old: 1, new: 1 },
};

/**
 * Fresh parser state.
 * @returns {object} Empty path map and counters.
 */
function initialState() {
  return { lines: new Map(), path: '', newLine: 0, oldRemaining: 0, newRemaining: 0 };
}

/**
 * Consume one line inside a hunk, recording additions.
 * @param {string} text - Diff line.
 * @param {object} state - Parser state.
 * @returns {boolean} True when the line belonged to a hunk.
 */
function consumeHunkLine(text, state) {
  if (state.oldRemaining <= 0 && state.newRemaining <= 0) return false;
  if (text.startsWith('\\')) return true;
  const delta = HUNK_DELTAS[text[0]] ?? HUNK_DELTAS[' '];
  if (text.startsWith('+')) state.lines.get(state.path)?.add(state.newLine);
  state.newLine += delta.new;
  state.oldRemaining -= delta.old;
  state.newRemaining -= delta.new;
  return true;
}

/**
 * Start a destination file when the line is a `+++` header.
 * @param {string} text - Diff line.
 * @param {object} state - Parser state.
 * @returns {boolean} True when the line was a file header.
 */
function startFile(text, state) {
  if (!text.startsWith('+++ ')) return false;
  const parsed = parsePatchPath(text.slice(4), 'b');
  state.path = parsed ?? '';
  if (state.path.length > 0) state.lines.set(state.path, state.lines.get(state.path) ?? new Set());
  return true;
}

/**
 * Start a hunk when the line is a hunk header.
 * @param {string} text - Diff line.
 * @param {object} state - Parser state.
 * @returns {boolean} True when the line was a hunk header.
 */
function startHunk(text, state) {
  const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/u.exec(text);
  if (hunk === null) return false;
  state.oldRemaining = hunk[2] === undefined ? 1 : Number(hunk[2]);
  state.newRemaining = hunk[4] === undefined ? 1 : Number(hunk[4]);
  state.newLine = Number(hunk[3]);
  return true;
}

/**
 * Feed one diff line to the active parser stage.
 * @param {string} text - Diff line.
 * @param {object} state - Parser state.
 * @returns {void}
 */
function processLine(text, state) {
  if (consumeHunkLine(text, state)) return;
  if (startFile(text, state)) return;
  startHunk(text, state);
}

/**
 * Map each changed path to its added line numbers.
 * @param {string} diff - Unified diff.
 * @returns {Map<string, Set<number>>} Added lines by path.
 */
export function parseAddedLines(diff) {
  const state = initialState();
  for (const text of diff.split('\n')) processLine(text, state);
  return state.lines;
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
  const marker = `${MARKER} event=${args.event ?? 'COMMENT'} comment=${args.commentId ?? ''} -->`;
  return `${marker}\n\n${sanitizeText(args.summary)}${extra}`;
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
 * Whether one review belongs to this agent.
 * @param {Record<string, unknown>} review - Review.
 * @param {string} appLogin - Agent login.
 * @returns {boolean} True when the review is ours.
 */
function isAppReview(review, appLogin) {
  return (
    String((review.user ?? {}).login ?? '') === appLogin &&
    String(review.body ?? '').includes(MARKER)
  );
}

/**
 * Whether the history already has a blocking review from this App on the head.
 * @param {Array<Record<string, unknown>>} reviews - Pull request reviews.
 * @param {string} appLogin - Agent login.
 * @param {string} headSha - Reviewed head.
 * @returns {boolean} True when a same-head block exists.
 */
function hasSameHeadBlock(reviews, appLogin, headSha) {
  return reviews.some(
    review =>
      isAppReview(review, appLogin) &&
      String(review.commit_id ?? '') === headSha &&
      reviewEvent(review) === 'REQUEST_CHANGES',
  );
}

/**
 * Read the exact trigger comment ID from a review marker.
 * @param {Record<string, unknown>} review - Review.
 * @returns {string} Comment ID, or ''.
 */
function reviewCommentId(review) {
  const firstLine = String(review.body ?? '').split('\n', 1)[0];
  const match = /comment=([^ ]*) -->$/u.exec(firstLine);
  return match?.[1] ?? '';
}

/**
 * Read the exact review event from a review marker.
 * @param {Record<string, unknown>} review - Review.
 * @returns {string} Event name, or ''.
 */
export function reviewEvent(review) {
  const firstLine = String(review.body ?? '').split('\n', 1)[0];
  const match = /event=([A-Z_]+)/u.exec(firstLine);
  return match?.[1] ?? '';
}

/**
 * Pick the latest earlier review from this agent.
 * @param {Array<Record<string, unknown>>} reviews - Pull request reviews.
 * @param {string} appLogin - Agent login.
 * @returns {Record<string, unknown> | undefined} Latest earlier review.
 */
function latestEarlier(reviews, appLogin) {
  return reviews
    .filter(review => isAppReview(review, appLogin))
    .sort(
      (left, right) =>
        Date.parse(String(left.submitted_at ?? '')) - Date.parse(String(right.submitted_at ?? '')),
    )
    .at(-1);
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
 * Dismiss one earlier review so its state cannot block the new review.
 * @param {object} args - Request arguments.
 * @param {Record<string, unknown>} review - Earlier review.
 * @returns {Promise<void>} Resolves when dismissed.
 */
async function dismissReview(args, review) {
  const id = Number(review.id);
  if (!Number.isInteger(id) || id <= 0) return;
  const response = await githubRequest({
    token: args.token,
    path: `/repos/${args.repo}/pulls/${args.pr}/reviews/${id}/dismissals`,
    method: 'PUT',
    body: { message: 'Superseded by a newer review from the review agent.' },
    fetchImpl: args.fetchImpl,
  });
  if (!response.ok) throw new Error(`GitHub review dismissal answered ${response.status}`);
}

/**
 * Dismiss earlier blocking reviews after a clean COMMENT.
 * The marker records the event even after GitHub erases the review state.
 * @param {object} args - Request arguments.
 * @param {Array<Record<string, unknown>>} reviews - Pull request reviews.
 * @param {number} newReviewId - Review just posted.
 * @param {number} [beforeId] - Only dismiss reviews older than this ID.
 * @returns {Promise<void>} Resolves when all earlier blocks are dismissed.
 */
async function dismissEarlierBlocks(
  args,
  reviews,
  newReviewId,
  beforeId = Number.POSITIVE_INFINITY,
) {
  const appLogin = args.appLogin ?? LEGACY_APP_LOGIN;
  if (appLogin === LEGACY_APP_LOGIN) return;
  const conflicts = reviews.filter(
    review =>
      isAppReview(review, appLogin) &&
      Number(review.id) !== newReviewId &&
      Number(review.id) < beforeId &&
      String(review.commit_id ?? '') !== args.headSha &&
      String(review.state ?? '') === 'CHANGES_REQUESTED' &&
      reviewEvent(review) === 'REQUEST_CHANGES',
  );
  for (const review of conflicts) await dismissReview(args, review);
}

/**
 * Read whether the live PR is still open at the reviewed head.
 * @param {object} args - Request arguments.
 * @returns {Promise<boolean>} True when the head is still current.
 */
async function liveHeadMatches(args) {
  const response = await githubRequest({
    token: args.token,
    path: `/repos/${args.repo}/pulls/${args.pr}`,
    fetchImpl: args.fetchImpl,
  });
  const pr = /** @type {Record<string, unknown>} */ (await readResponseJson(response));
  const head = /** @type {Record<string, unknown>} */ (pr.head ?? {});
  return pr.state === 'open' && pr.draft !== true && String(head.sha ?? '') === args.headSha;
}

/**
 * Refuse to post when the live PR no longer matches the reviewed snapshot.
 * @param {object} args - Request arguments.
 * @returns {Promise<void>} Resolves when the head still matches.
 */
async function assertLiveHead(args) {
  if (!(await liveHeadMatches(args))) {
    throw new Error('pull request changed before posting');
  }
}

/**
 * Build one review payload.
 * @param {object} args - Review arguments.
 * @param {string} args.headSha - Head commit.
 * @param {string} args.summary - Model summary.
 * @param {Array<Record<string, unknown>>} args.inline - Inline findings.
 * @param {Array<Record<string, unknown>>} args.overflow - Summary findings.
 * @param {string} [args.event] - Review event.
 * @param {string} [args.commentId] - Triggering comment ID.
 * @returns {Record<string, unknown>} Review payload.
 */
export function buildReview(args) {
  const event = args.event ?? DEFAULT_REVIEW_EVENT;
  if (!REVIEW_EVENTS.has(event)) throw new ReviewFormatError('invalid review event');
  const comments = args.inline.map(finding => ({
    path: String(finding.path),
    line: Number(finding.line),
    side: 'RIGHT',
    body: commentBody(finding),
  }));
  const payload = {
    commit_id: args.headSha,
    body: summaryBody({
      summary: args.summary,
      overflow: args.overflow,
      event,
      commentId: args.commentId,
    }),
    event,
  };
  if (comments.length > 0) payload.comments = comments;
  return payload;
}

/**
 * Post one review, once per triggering comment.
 * @param {object} args - Review arguments.
 * @param {string} args.repo - `owner/name`.
 * @param {number} args.pr - Pull request number.
 * @param {string} args.token - GitHub token.
 * @param {string} args.headSha - Reviewed head commit.
 * @param {string} args.summary - Model summary.
 * @param {Array<Record<string, unknown>>} args.inline - Inline findings.
 * @param {Array<Record<string, unknown>>} args.overflow - Summary findings.
 * @param {string} [args.event] - Review event.
 * @param {string} [args.appLogin] - App identity.
 * @param {string} [args.commentId] - Triggering comment ID.
 * @param {boolean} [args.dismissBlocking] - Dismiss earlier blocks after a clean COMMENT.
 * @param {boolean} [args.reviewComplete] - Whether the review covered every changed file.
 * @param {boolean} [args.recheckHead] - Re-fetch the PR before posting.
 * @param {typeof fetch} [args.fetchImpl] - Test double.
 * @returns {Promise<Record<string, unknown>>} Posted review.
 */
export async function postReview(args) {
  const event = args.event ?? DEFAULT_REVIEW_EVENT;
  const appLogin = args.appLogin ?? LEGACY_APP_LOGIN;
  const commentId = String(args.commentId ?? '');
  // Approvals, blocking reviews and dismissal cleanup need the complete
  // history. A plain informational COMMENT can post without it.
  const needsCompleteHistory = event !== 'COMMENT' || args.dismissBlocking === true;
  const reviews = await listReviews({ ...args, failClosed: needsCompleteHistory });
  if (commentId.length > 0) {
    const duplicate = reviews.find(
      review =>
        isAppReview(review, appLogin) &&
        reviewCommentId(review) === commentId &&
        String(review.commit_id ?? '') === args.headSha,
    );
    if (duplicate !== undefined) {
      const duplicateIsCleanComment =
        reviewEvent(duplicate) === 'COMMENT' && String(duplicate.commit_id ?? '') === args.headSha;
      if (
        args.dismissBlocking === true &&
        args.reviewComplete === true &&
        event === 'COMMENT' &&
        duplicateIsCleanComment
      ) {
        if (await liveHeadMatches(args)) {
          await dismissEarlierBlocks(args, reviews, Number(duplicate.id), Number(duplicate.id));
        }
      }
      return { id: duplicate.id, htmlUrl: duplicate.html_url, inline: 0 };
    }
  }
  if (args.recheckHead === true) await assertLiveHead(args);
  if (event === 'APPROVE' && hasSameHeadBlock(reviews, appLogin, args.headSha)) {
    throw new Error('approval requires a new commit');
  }
  const earlier = latestEarlier(reviews, appLogin);
  const payload = buildReview({ ...args, event, commentId });
  // A request that rejects before a response has an unknown outcome; leave
  // `created` unset so the failure notice still runs.
  const response = await githubRequest({
    token: args.token,
    path: `/repos/${args.repo}/pulls/${args.pr}/reviews`,
    method: 'POST',
    body: payload,
    fetchImpl: args.fetchImpl,
  });
  if (!response.ok) throw new Error(`GitHub review POST answered ${response.status}`);
  await markCreated();
  const review = /** @type {Record<string, unknown>} */ (await readResponseJson(response));
  if (args.dismissBlocking === true && args.reviewComplete === true && event === 'COMMENT') {
    if (await liveHeadMatches(args)) {
      await dismissEarlierBlocks(args, reviews, Number(review.id));
    }
  }
  if (appLogin === LEGACY_APP_LOGIN && earlier !== undefined) {
    await minimizeReview(args, earlier);
  }
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
  return postReview({
    ...args,
    event: 'COMMENT',
    summary,
    inline: [],
    overflow: [],
    dismissBlocking: false,
  });
}

/**
 * Record that a review was created so the workflow does not post a duplicate
 * failure notice.
 * @returns {Promise<void>} Resolves when the output is written.
 */
export async function markCreated() {
  if (!process.env.GITHUB_OUTPUT) return;
  await appendFile(process.env.GITHUB_OUTPUT, 'created=true\n');
}

/**
 * Read and validate the agent result.
 * @param {string} path - Result file.
 * @param {number} maxFindings - Finding cap.
 * @param {Map<string, Set<number>>} added - Added lines by path.
 * @returns {Promise<ReturnType<typeof validateReview>>} Review.
 */
async function readReview(path, maxFindings, added) {
  const text = await readFile(path, 'utf8');
  return validateReview(parseReview(text), maxFindings, added);
}

/**
 * Build the request arguments shared by the failure and success paths.
 * @param {NodeJS.ProcessEnv} env - Process environment.
 * @returns {Record<string, unknown>} Request arguments.
 */
function requestArgs(env, config) {
  return {
    repo: env.REVIEW_REPO || env.GITHUB_REPOSITORY || '',
    pr: Number(env.PR_NUMBER),
    token: env.REVIEW_TOKEN || env.GITHUB_TOKEN || '',
    headSha: env.REVIEW_HEAD_SHA || '',
    appLogin: env.REVIEW_APP_LOGIN || undefined,
    event: env.REVIEW_EVENT || config.defaultReviewEvent || DEFAULT_REVIEW_EVENT,
    commentId: env.REVIEW_COMMENT_ID || '',
    dismissBlocking: env.REVIEW_DISMISS_BLOCKING === 'true',
    recheckHead: env.REVIEW_RECHECK_HEAD === 'true',
  };
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
  const appMode = Boolean(env.REVIEW_APP_LOGIN);
  if (process.argv.includes('--failure')) {
    if (process.argv.includes('--dry-run')) return;
    if (appMode) {
      console.error('review agent failed; App mode posts no failure review');
      process.exitCode = 1;
      return;
    }
    await postFailure({
      ...requestArgs(env, config),
      event: 'COMMENT',
      message: 'The review run did not finish. Check the workflow log.',
    });
    return;
  }
  const diff = await readFile(env.REVIEW_DIFF || '.review/pr/diff.patch', 'utf8');
  const added = parseAddedLines(diff);
  let review;
  try {
    review = await readReview(
      env.REVIEW_RESULT || '.review/pr/result.json',
      config.maxFindings,
      added,
    );
  } catch (error) {
    if (process.argv.includes('--dry-run') || appMode) {
      console.error(safeError(error));
      process.exitCode = 1;
      return;
    }
    await postFailure({
      ...requestArgs(env, config),
      event: 'COMMENT',
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
          event: env.REVIEW_EVENT || config.defaultReviewEvent || DEFAULT_REVIEW_EVENT,
          commentId: env.REVIEW_COMMENT_ID || '',
        }),
        null,
        2,
      ),
    );
    return;
  }
  const posted = await postReview({
    ...requestArgs(env, config),
    summary: review.summary,
    inline: split.inline,
    overflow: split.overflow,
    reviewComplete: review.complete,
  });
  console.log(JSON.stringify(posted));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`pr-review post failed: ${error.name}`);
    process.exitCode = 1;
  });
}
