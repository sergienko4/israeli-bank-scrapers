export const REVIEW_EVENTS: Set<string>;

export function hasBlockingFindings(
  findings: Array<Record<string, unknown>>,
  config: Record<string, unknown>,
): boolean;

export function isReviewComplete(
  metadata: Record<string, unknown>,
  config: Record<string, unknown>,
): boolean;

export function canApprove(permission: unknown): boolean;

export function approvalDenial(args: Record<string, unknown>): string;

export function decideReview(args: Record<string, unknown>): {
  event: string;
  reason: string;
  dismissBlocking: boolean;
};
