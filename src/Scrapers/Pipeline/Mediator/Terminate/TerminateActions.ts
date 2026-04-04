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
import type { IBrowserState, IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../Types/Procedure.js';

/** Whether a single cleanup handler completed without error. */
type CleanupOk = boolean;

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
  if (isFailed) logger.debug({ event: 'cleanup-error', message: result.errorMessage });
  return result;
}

/**
 * Run a single cleanup handler, swallowing any error.
 * @param cleanup - The cleanup function returning Procedure<void>.
 * @param logger - Logger for error reporting.
 * @returns Succeed if cleanup passed, fail if it failed or threw.
 */
async function runCleanup(
  cleanup: CleanupFn,
  logger: IPipelineContext['logger'],
): Promise<Procedure<void>> {
  try {
    const result = await cleanup();
    return logCleanupResult(result, logger);
  } catch (error) {
    const msg = toErrorMessage(error as Error).slice(0, 80);
    logger.debug({ event: 'cleanup-error', message: msg });
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
  const didSucceed: CleanupOk = isOk(result);
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
 * @param input - Pipeline context with browser state.
 * @returns Always succeed(input).
 */
async function executeRunCleanups(input: IPipelineContext): Promise<Procedure<IPipelineContext>> {
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
  executeSignalDone,
  executeStartCleanup,
  runAllCleanups,
};
