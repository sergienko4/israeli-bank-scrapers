/**
 * Pipeline middleware — interceptors and cleanup for phase execution.
 * Extracted from PipelineExecutor to respect 150-line Core/ limit.
 */

import { createMockInterceptor } from '../../Interceptors/MockInterceptor.js';
import { createSnapshotInterceptor } from '../../Interceptors/SnapshotInterceptor.js';
import { runAllCleanups } from '../../Phases/Terminate/TerminatePhase.js';
import type { BasePhase } from '../../Types/BasePhase.js';
import type { IPipelineInterceptor } from '../../Types/Interceptor.js';
import type { PhaseName } from '../../Types/Phase.js';
import type { IBrowserState, IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { isOk, succeed } from '../../Types/Procedure.js';

/** Mutable state for phase reduction. */
export interface IContextTracker {
  readonly phases: readonly BasePhase[];
  readonly interceptors: readonly IPipelineInterceptor[];
  lastCtx: IPipelineContext;
}

/**
 * Extract browser cleanups from context.
 * @param ctx - Pipeline context with optional browser.
 * @returns Cleanup functions array.
 */
function extractCleanups(ctx: IPipelineContext): IBrowserState['cleanups'] {
  if (!ctx.browser.has) return [];
  return ctx.browser.value.cleanups;
}

/**
 * Run browser cleanup from tracked context.
 * @param tracker - Context tracker with last known state.
 * @param logger - Logger for error reporting.
 * @returns Count of successful cleanups.
 */
export async function ensureBrowserCleanup(
  tracker: IContextTracker,
  logger: IPipelineContext['logger'],
): Promise<number> {
  const cleanups = extractCleanups(tracker.lastCtx);
  if (cleanups.length === 0) return 0;
  return await runAllCleanups(cleanups, logger);
}

/**
 * Run interceptors sequentially.
 * @param interceptors - Ordered interceptor list.
 * @param ctx - Current pipeline context.
 * @param index - Current interceptor index.
 * @param nextPhase - Name of the phase about to run.
 * @returns Updated context or failure.
 */
/** Bundled args for interceptor reduction. */
interface IInterceptorArgs {
  readonly interceptors: readonly IPipelineInterceptor[];
  readonly nextPhase: PhaseName;
}

/**
 * Run interceptors sequentially.
 * @param args - Interceptor list + next phase name.
 * @param ctx - Current pipeline context.
 * @param index - Current interceptor index.
 * @returns Updated context or failure.
 */
async function runInterceptors(
  args: IInterceptorArgs,
  ctx: IPipelineContext,
  index: number,
): Promise<Procedure<IPipelineContext>> {
  if (index >= args.interceptors.length) return succeed(ctx);
  const result = await args.interceptors[index].beforePhase(ctx, args.nextPhase);
  if (!isOk(result)) return result;
  return await runInterceptors(args, result.value, index + 1);
}

/**
 * Assemble the interceptor chain — prepend env-gated interceptors (mock +
 * snapshot) ahead of the bank's descriptor interceptors so those modes work
 * for any bank. Each env-gated factory returns an inert interceptor when its
 * env flag is unset, so cost is near-zero when disabled.
 * @param base - Interceptors registered by the bank's pipeline builder.
 * @returns Combined, ordered interceptor list.
 */
export function assembleInterceptors(
  base: readonly IPipelineInterceptor[],
): readonly IPipelineInterceptor[] {
  const mock = createMockInterceptor();
  const snapshot = createSnapshotInterceptor();
  return [mock, snapshot, ...base];
}

/**
 * Apply interceptors if browser available.
 * @param tracker - Context tracker with interceptors.
 * @param ctx - Current pipeline context.
 * @param nextPhase - Name of the phase about to run.
 * @returns Updated context after interceptors.
 */
export async function applyInterceptors(
  tracker: IContextTracker,
  ctx: IPipelineContext,
  nextPhase: PhaseName,
): Promise<Procedure<IPipelineContext>> {
  if (!ctx.browser.has) return succeed(ctx);
  if (tracker.interceptors.length === 0) return succeed(ctx);
  const args: IInterceptorArgs = { interceptors: tracker.interceptors, nextPhase };
  return await runInterceptors(args, ctx, 0);
}
