export function progressBody(stage: string, marker?: string, externalId?: string): string;

export function finishSummary(conclusion: string, findings?: number, failed?: boolean): string;

export function findProgressComment(
  args: Record<string, unknown>,
): Promise<Record<string, unknown> | undefined>;

export function upsertProgressComment(
  args: Record<string, unknown>,
  existing: Record<string, unknown> | undefined,
): Promise<Record<string, unknown>>;

export function findCheckRun(
  args: Record<string, unknown>,
): Promise<Record<string, unknown> | undefined>;

export function createCheckRun(args: Record<string, unknown>): Promise<Record<string, unknown>>;

export function startProgress(args: Record<string, unknown>): Promise<{
  commentId: number;
  checkRunId: number;
}>;

export function finishProgress(args: Record<string, unknown>): Promise<void>;
