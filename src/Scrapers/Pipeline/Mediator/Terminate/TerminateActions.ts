/**
 * TERMINATE phase Mediator actions — PRE/ACTION/POST/FINAL.
 * Phase orchestrates ONLY. All cleanup logic here.
 *
 * PRE:    guard (no browser → passthrough)
 * ACTION: run LIFO cleanups — never fails
 * POST:   stamp diagnostics with cleanup count
 * FINAL:  stamp lastAction
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { toErrorMessage } from '../../Types/ErrorUtils.js';
import type {
  IActionContext,
  IBootstrapContext,
  IBrowserState,
  IPipelineContext,
} from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../Types/Procedure.js';
import { createPromise } from '../Timing/TimingActions.js';
import { TERMINATE_CLEANUP_BUDGET_MS } from '../Timing/TimingConfig.js';

/** Type alias for the cleanup function signature from IBrowserState. */
type CleanupFn = IBrowserState['cleanups'][number];

/**
 * Log a cleanup failure if the result is not OK.
 * @param result - The cleanup procedure result.
 * @param logger - Logger for error reporting.
 * @returns The same result, unchanged.
 */
function logCleanupResult(
  result: Procedure<void>,
  logger: IPipelineContext['logger'],
): Procedure<void> {
  const isFailed = !isOk(result);
  if (isFailed) logger.debug({ message: result.errorMessage });
  return result;
}

/**
 * Build a wall-clock guard that resolves to a fail-loud Procedure
 * when the budget elapses. Constructs the timeout fail-Procedure
 * once outside the executor closure so the body stays small.
 *
 * @param ms - Wall-clock budget for the cleanup.
 * @returns Promise that resolves to a fail Procedure after `ms`.
 */
function cleanupTimeoutGuard(ms: number): Promise<Procedure<void>> {
  const timeoutFail = fail(
    ScraperErrorTypes.Generic,
    `cleanup: budget elapsed after ${String(ms)}ms`,
  );
  return createPromise<Procedure<void>>((resolve): boolean => {
    globalThis.setTimeout((): boolean => resolve(timeoutFail), ms);
    return true;
  });
}

/**
 * Execute a single cleanup with the wall-clock guard race. Extracted so
 * the surrounding {@link runCleanup} stays within the per-function cap.
 *
 * @param cleanup - Cleanup function returning Procedure<void>.
 * @param logger - Logger for error reporting.
 * @returns The cleanup result (or the timeout fail Procedure).
 */
async function runCleanupGuarded(
  cleanup: CleanupFn,
  logger: IPipelineContext['logger'],
): Promise<Procedure<void>> {
  const cleanupCall = cleanup();
  const guard = cleanupTimeoutGuard(TERMINATE_CLEANUP_BUDGET_MS);
  const result = await Promise.race([cleanupCall, guard]);
  return logCleanupResult(result, logger);
}

/**
 * Translate a thrown cleanup error into a fail Procedure, capping the
 * message length so logs remain bounded.
 *
 * @param error - Caught error from the cleanup call.
 * @param logger - Logger for debug emission.
 * @returns Fail Procedure with the truncated message.
 */
function handleCleanupError(error: unknown, logger: IPipelineContext['logger']): Procedure<void> {
  const msg = toErrorMessage(error as Error).slice(0, 80);
  logger.debug({ message: msg });
  return fail(ScraperErrorTypes.Generic, `cleanup: ${msg}`);
}

/**
 * Run a single cleanup handler with a wall-clock budget. Swallows any
 * error. The budget protects against a hung cleanup blocking the
 * pipeline (live Isracard regression — see `TERMINATE_CLEANUP_BUDGET_MS`).
 *
 * @param cleanup - The cleanup function returning Procedure<void>.
 * @param logger - Logger for error reporting.
 * @returns Succeed if cleanup passed within budget, fail otherwise.
 */
async function runCleanup(
  cleanup: CleanupFn,
  logger: IPipelineContext['logger'],
): Promise<Procedure<void>> {
  try {
    return await runCleanupGuarded(cleanup, logger);
  } catch (error) {
    return handleCleanupError(error, logger);
  }
}

/** Logger alias used by the recursive cleanup driver. */
type CleanupLogger = IPipelineContext['logger'];

/**
 * Tally the cleanup outcome for one cleanup call. Pulled out so
 * {@link runCleanupsRecursive} stays under the per-function LoC budget.
 * @param didSucceed - Result of the cleanup at this index.
 * @param restCount - Successful-cleanup count for the rest of the stack.
 * @returns Updated successful-cleanup count.
 */
function tallyCleanup(didSucceed: boolean, restCount: number): number {
  if (!didSucceed) return restCount;
  return restCount + 1;
}

/** Bundled args for the recursive cleanup driver — keeps params ≤ 3. */
interface IRecursiveCleanupArgs {
  readonly cleanups: readonly CleanupFn[];
  readonly logger: CleanupLogger;
  readonly index: number;
}

/**
 * Run cleanups recursively in LIFO order (index decreasing).
 * @param args - Bundled cleanups + logger + index.
 * @returns Count of successful cleanups.
 */
async function runCleanupsRecursive(args: IRecursiveCleanupArgs): Promise<number> {
  if (args.index < 0) return 0;
  const result = await runCleanup(args.cleanups[args.index], args.logger);
  const didSucceed = isOk(result);
  const restCount = await runCleanupsRecursive({ ...args, index: args.index - 1 });
  return tallyCleanup(didSucceed, restCount);
}

/**
 * Run all cleanup handlers in LIFO order. Entry point for emergency cleanup.
 * @param cleanups - Cleanup functions registered during init.
 * @param logger - Logger for error reporting.
 * @returns Count of successful cleanups.
 */
async function runAllCleanups(
  cleanups: readonly CleanupFn[],
  logger: IPipelineContext['logger'],
): Promise<number> {
  const lastIndex = cleanups.length - 1;
  return runCleanupsRecursive({ cleanups, logger, index: lastIndex });
}

/**
 * PRE: Guard — no browser means nothing to clean up.
 * @param input - Pipeline context.
 * @returns Pass-through.
 */
function executeStartCleanup(input: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  const result = succeed(input);
  return Promise.resolve(result);
}

/**
 * ACTION: Run LIFO cleanups — never fails the pipeline.
 * TERMINATE has no mediator, so buildActionContext passes full context as IActionContext.
 * The runtime object IS IPipelineContext — browser is available via property probe.
 * @param input - Action context (full context at runtime — no mediator sealing).
 * @returns Always succeed(input).
 */
async function executeRunCleanups(input: IActionContext): Promise<Procedure<IActionContext>> {
  const ctx = input as IBootstrapContext;
  if (!ctx.browser.has) return succeed(input);
  const cleanups = ctx.browser.value.cleanups;
  const lastIndex = cleanups.length - 1;
  await runCleanupsRecursive({ cleanups, logger: ctx.logger, index: lastIndex });
  return succeed(input);
}

/**
 * Run browser cleanups from full context (POST stage).
 * Used by TERMINATE.POST which has full IPipelineContext.
 * @param input - Full pipeline context with browser.
 * @returns Succeed after cleanups.
 */
async function executeRunCleanupsFromContext(
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  if (!input.browser.has) return succeed(input);
  const cleanups = input.browser.value.cleanups;
  const lastIndex = cleanups.length - 1;
  await runCleanupsRecursive({ cleanups, logger: input.logger, index: lastIndex });
  return succeed(input);
}

/**
 * POST: Stamp diagnostics with cleanup result.
 * @param input - Pipeline context.
 * @returns Updated context with diagnostics.
 */
function executeLogResults(input: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  const diag = { ...input.diagnostics, lastAction: 'terminate-post' };
  const result = succeed({ ...input, diagnostics: diag });
  return Promise.resolve(result);
}

/**
 * FINAL: Stamp lastAction — done.
 * @param input - Pipeline context.
 * @returns Updated context.
 */
function executeSignalDone(input: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  const diag = { ...input.diagnostics, lastAction: 'terminate-done' };
  const result = succeed({ ...input, diagnostics: diag });
  return Promise.resolve(result);
}

export {
  executeLogResults,
  executeRunCleanups,
  executeRunCleanupsFromContext,
  executeSignalDone,
  executeStartCleanup,
  runAllCleanups,
};
