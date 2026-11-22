export function decideFromEnv(
  env: NodeJS.ProcessEnv,
  fetchImpl?: typeof fetch,
): Promise<{
  event: string;
  reason: string;
  dismissBlocking: boolean;
}>;

export function hasBlockingReview(
  reviews: Record<string, unknown>[],
  appLogin: string,
  headSha: string,
): boolean;
