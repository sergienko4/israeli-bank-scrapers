export function argsFromEnv(env: NodeJS.ProcessEnv): Record<string, unknown>;

export function stageIds(
  ids: { commentId: number; checkRunId: number },
  env: NodeJS.ProcessEnv,
): { commentId: number; checkRunId: number };
