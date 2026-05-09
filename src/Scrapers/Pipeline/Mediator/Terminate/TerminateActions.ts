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

/** Type alias for the cleanup function signature from IBrowserState. */
type CleanupFn = IBrowserState['cleanups'][number];

/**
 * Wall-clock ceiling for a single cleanup function. Live Isracard run
 * `10-05-2026_02023248` hung in TERMINATE.POST for ~9 min because
 * Playwright's `page.close()` cleanup waits for the network to go
 * idle and Isracard's frontend JavaScript keeps firing keepAlive POSTs
 * every 30 s — the page never settles. Each cleanup gets the budget
 * via `Promise.race`; on timeout we surface a fail-loud Procedure and
 * the LIFO walk continues so other cleanups still run.
 */
const CLEANUP_BUDGET_MS = 5000;

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
 * Build a wall-clock guard that resolves to a fail-loud Procedure when
 * the budget elapses. Uses the project's `createPromise` helper so the
 * no-`new`-Promise rule stays satisfied. Every callback returns truthy
 * to satisfy the no-`void` architecture rule.
 *
 * @param ms - Wall-clock budget for the cleanup.
 * @returns Promise that resolves to a fail Procedure after `ms`.
 */
function cleanupTimeoutGuard(ms: number): Promise<Procedure<void>> {
  /**
   * Promise executor — schedules the deadline.
   *
   * @param resolve - Promise resolver.
   * @returns True after the timer is armed.
   */
  const arm = (resolve: (value: Procedure<void>) => boolean): boolean => {
    /**
     * Timer fire — resolves with the timeout fail.
     *
     * @returns True after resolving the guard promise.
     */
    const fire = (): boolean => {
      const timeoutFail = fail(
        ScraperErrorTypes.Generic,
        `cleanup: budget elapsed after ${String(ms)}ms`,
      );
      return resolve(timeoutFail);
    };
    globalThis.setTimeout(fire, ms);
    return true;
  };
  return createPromise<Procedure<void>>(arm);
}

/**
 * Run a single cleanup handler with a wall-clock budget. Swallows any
 * error. The budget protects against a hung cleanup blocking the
 * pipeline (live Isracard regression — see `CLEANUP_BUDGET_MS`).
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
    const cleanupCall = cleanup();
    const guard = cleanupTimeoutGuard(CLEANUP_BUDGET_MS);
    const result = await Promise.race([cleanupCall, guard]);
    return logCleanupResult(result, logger);
  } catch (error) {
    const msg = toErrorMessage(error as Error).slice(0, 80);
    logger.debug({ message: msg });
    return fail(ScraperErrorTypes.Generic, `cleanup: ${msg}`);
  }
}

/**
 * Run cleanups recursively in LIFO order (index decreasing).
 * @param cleanups - Cleanup functions registered during init.
 * @param logger - Logger for error reporting.
 * @param index - Current index (starts at last element).
 * @returns Count of successful cleanups.
 */
async function runCleanupsRecursive(
  cleanups: readonly CleanupFn[],
  logger: IPipelineContext['logger'],
  index: number,
): Promise<number> {
  if (index < 0) return 0;
  const result = await runCleanup(cleanups[index], logger);
  const didSucceed: boolean = isOk(result);
  const restCount = await runCleanupsRecursive(cleanups, logger, index - 1);
  if (!didSucceed) return restCount;
  return restCount + 1;
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
  return await runCleanupsRecursive(cleanups, logger, lastIndex);
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
  await runCleanupsRecursive(cleanups, ctx.logger, lastIndex);
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
  await runCleanupsRecursive(cleanups, input.logger, lastIndex);
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
