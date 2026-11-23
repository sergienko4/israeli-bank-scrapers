export function parseReview(text: string): Record<string, unknown>;

export function reviewEvent(review: Record<string, unknown>): string;

export function selectPresentationFindings(
  findings: Record<string, unknown>[],
  config: Record<string, unknown>,
): Record<string, unknown>[];

export function validateReview(
  value: Record<string, unknown>,
  maxFindings: number,
  added?: Map<string, Set<number>>,
): {
  summary: string;
  guidelines_read: string[];
  findings: Array<Record<string, unknown>>;
  complete: boolean;
};

export function isPostedComplete(
  review: { complete: boolean },
  metadata: Record<string, unknown>,
  config: Record<string, unknown>,
  headSha: string,
): boolean;

export function parseAddedLines(diff: string): Map<string, Set<number>>;

export function mapFindings(
  findings: Array<Record<string, unknown>>,
  added: Map<string, Set<number>>,
  maxInline: number,
): {
  inline: Array<Record<string, unknown>>;
  overflow: Array<Record<string, unknown>>;
};

export function buildReview(args: Record<string, unknown>): Record<string, unknown>;

export function postReview(args: Record<string, unknown>): Promise<Record<string, unknown>>;

export function postFailure(args: Record<string, unknown>): Promise<Record<string, unknown>>;

export function markCreated(): Promise<void>;

export function markFindings(count: number): Promise<void>;
