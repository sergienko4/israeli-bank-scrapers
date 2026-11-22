/**
 * Decide which GitHub review event a validated review should submit.
 *
 * The module is pure: it never calls GitHub and never changes repository
 * settings. The existing branch protection policy decides what the returned
 * event means.
 */

/** Review events the decision may return. `NONE` means "post nothing". */
export const REVIEW_EVENTS = new Set(['COMMENT', 'REQUEST_CHANGES', 'APPROVE', 'NONE']);

/** Permissions that may request an approval. */
const APPROVER_PERMISSIONS = new Set(['admin', 'maintain', 'write']);

/** Default severities that request changes. */
const DEFAULT_BLOCKING_SEVERITIES = ['critical', 'important'];

/**
 * Whether the review contains a blocking finding.
 * @param {Array<Record<string, unknown>>} findings - Validated findings.
 * @param {Record<string, unknown>} config - Review config.
 * @returns {boolean} True when a finding requests changes.
 */
export function hasBlockingFindings(findings, config) {
  const severities =
    /** @type {string[]} */ (config.blockingSeverities) ?? DEFAULT_BLOCKING_SEVERITIES;
  return findings.some(finding => severities.includes(String(finding.severity)));
}

/**
 * Whether the fetched review data covers every changed file.
 * @param {Record<string, unknown>} metadata - PR metadata.
 * @param {Record<string, unknown>} config - Review config.
 * @returns {boolean} True when approval may rely on the review.
 */
export function isReviewComplete(metadata, config) {
  if (metadata.diffTruncated !== false) return false;
  if (metadata.credentialContent !== false) return false;
  if (!Array.isArray(metadata.skippedFiles) || metadata.skippedFiles.length > 0) return false;
  if (!Array.isArray(metadata.sensitiveFiles) || metadata.sensitiveFiles.length > 0) return false;
  const changedFiles = metadata.changedFiles;
  if (typeof changedFiles !== 'number' || !Number.isInteger(changedFiles) || changedFiles < 0) {
    return false;
  }
  const files = metadata.files;
  if (!Array.isArray(files) || files.length !== changedFiles) return false;
  const maxFiles = Number(config.maxFiles ?? 300);
  return changedFiles <= maxFiles;
}

/**
 * Whether the actor may approve.
 * @param {unknown} permission - Repository permission.
 * @returns {boolean} True for write, maintain or admin.
 */
export function canApprove(permission) {
  return APPROVER_PERMISSIONS.has(String(permission));
}

/**
 * Explain why approval is not allowed, or return an empty string.
 * @param {object} args - Decision arguments.
 * @param {Record<string, unknown>} args.config - Review config.
 * @param {Record<string, unknown>} args.metadata - PR metadata.
 * @param {Record<string, unknown>} args.pullRequest - PR state.
 * @param {string} args.actor - Requesting login.
 * @param {string} args.actorPermission - Repository permission.
 * @param {string} args.headSha - Reviewed head SHA.
 * @returns {string} Denial reason, or ''.
 */
export function approvalDenial(args) {
  const approval = /** @type {Record<string, unknown>} */ (args.config.approval ?? {});
  if (approval.enabled === false) return 'approval is disabled';
  if (!canApprove(args.actorPermission)) return 'actor cannot approve';
  if (approval.allowAuthor === false && String(args.pullRequest.authorLogin ?? '') === args.actor) {
    return 'the author cannot approve';
  }
  if (args.pullRequest.state !== 'open') return 'pull request is not open';
  if (args.pullRequest.draft === true) return 'pull request is a draft';
  if (args.pullRequest.isFork === true) return 'fork pull requests are not reviewed';
  if (String(args.pullRequest.headSha ?? '') !== args.headSha) {
    return 'the pull request head changed during the review';
  }
  if (args.reviewComplete !== true) return 'the review is incomplete';
  if (!isReviewComplete(args.metadata, args.config)) return 'the review is incomplete';
  return '';
}

/**
 * Decide one review event.
 * @param {object} args - Decision arguments.
 * @param {string} args.command - `review` or `approve`.
 * @param {Array<Record<string, unknown>>} args.findings - Validated findings.
 * @param {Record<string, unknown>} args.metadata - PR metadata.
 * @param {Record<string, unknown>} args.pullRequest - PR state.
 * @param {string} args.actor - Requesting login.
 * @param {string} args.actorPermission - Repository permission.
 * @param {string} args.headSha - Reviewed head SHA.
 * @param {Record<string, unknown>} args.config - Review config.
 * @param {{ state: string, headSha: string } | undefined} [args.previousReview] - Latest App review.
 * @returns {{ event: string, reason: string, dismissBlocking: boolean }} Decision.
 */
export function decideReview(args) {
  const blocking = hasBlockingFindings(args.findings, args.config);
  if (args.command !== 'approve') {
    const complete = args.reviewComplete === true && isReviewComplete(args.metadata, args.config);
    const sameHeadBlock =
      args.previousReview?.blocking === true && args.previousReview.headSha === args.headSha;
    return {
      event: blocking ? 'REQUEST_CHANGES' : 'COMMENT',
      reason: blocking ? 'blocking findings' : 'clean review',
      dismissBlocking: !blocking && complete && !sameHeadBlock,
    };
  }
  if (blocking) {
    return { event: 'REQUEST_CHANGES', reason: 'blocking findings', dismissBlocking: false };
  }
  const denial = approvalDenial(args);
  if (denial.length > 0) {
    return { event: 'COMMENT', reason: denial, dismissBlocking: false };
  }
  if (args.previousReview?.blocking === true && args.previousReview.headSha === args.headSha) {
    return {
      event: 'NONE',
      reason: 'approval requires a new commit',
      dismissBlocking: false,
    };
  }
  return { event: 'APPROVE', reason: 'clean review', dismissBlocking: false };
}
