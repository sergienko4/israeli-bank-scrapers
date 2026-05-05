/**
 * Pipeline finalizer — runs every interceptor's optional afterPipeline hook
 * before the executor closes the browser. Split from PipelineMiddleware.ts
 * to respect the 150-line Core/ file limit.
 *
 * Best-effort: any throw inside a finalizer is swallowed so snapshot failure
 * cannot block cleanup.
 */

import type { IPipelineInterceptor } from '../../Types/Interceptor.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';

/** Count of interceptors whose afterPipeline hook ran. */
type FinalizerCount = number;

/** Whether an interceptor exposed an afterPipeline hook. */
type HasFinalizer = boolean;

/**
 * Run one interceptor's optional afterPipeline hook, swallowing any throw.
 * @param interceptor - Interceptor to finalize.
 * @param ctx - Last accumulated pipeline context.
 * @returns True if a finalizer ran, false when absent.
 */
async function runOneFinalizer(
  interceptor: IPipelineInterceptor,
  ctx: IPipelineContext,
): Promise<HasFinalizer> {
  if (!interceptor.afterPipeline) return false;
  await interceptor.afterPipeline(ctx).catch((): false => false);
  return true;
}

/**
 * Run every interceptor's afterPipeline hook in parallel.
 * @param interceptors - Ordered interceptor list.
 * @param ctx - Last accumulated pipeline context.
 * @returns Count of interceptors that exposed a finalizer.
 */
async function runAfterPipeline(
  interceptors: readonly IPipelineInterceptor[],
  ctx: IPipelineContext,
): Promise<FinalizerCount> {
  /**
   * Wrapper bound to ctx — used with Array.map so Promise.all receives a
   * named function reference instead of a nested inline call.
   * @param i - Interceptor to finalize.
   * @returns Whether a finalizer ran.
   */
  const finalizeOne = (i: IPipelineInterceptor): Promise<HasFinalizer> => runOneFinalizer(i, ctx);
  const jobs = interceptors.map(finalizeOne);
  const outcomes = await Promise.all(jobs);
  return outcomes.filter(Boolean).length;
}

export { runAfterPipeline };
export default runAfterPipeline;
