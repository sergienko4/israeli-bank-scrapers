export function parseReview(text: string): Record<string, unknown>;

export function validateReview(
  value: Record<string, unknown>,
  maxFindings: number,
): {
  summary: string;
  guidelines_read: string[];
  findings: Array<Record<string, unknown>>;
};

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
