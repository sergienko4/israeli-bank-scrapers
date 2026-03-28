/**
 * Terminate phase — cleanup browser resources in LIFO order.
 * Extracted from BaseScraperWithBrowser.terminate().
 * Never fails the pipeline — cleanup errors are logged and swallowed.
 */

import { ScraperErrorTypes } from '../../Base/ErrorTypes.js';
import { toErrorMessage } from '../Types/ErrorUtils.js';
import type { IPipelineStep } from '../Types/Phase.js';
import type { IBrowserState, IPipelineContext } from '../Types/PipelineContext.js';
import type { Procedure } from '../Types/Procedure.js';
import { fail, isOk, succeed } from '../Types/Procedure.js';

/** Whether a single cleanup handler completed without error. */
type CleanupOk = boolean;

/** Type alias for the cleanup function signature from IBrowserState. */
type CleanupFn = IBrowserState['cleanups'][number];

/**
 * Run a single cleanup handler, swallowing any error.
 * Maps the Procedure result to a boolean for counting.
 * @param cleanup - The cleanup function returning Procedure<void>.
 * @param logger - Logger for error reporting.
 * @returns True if cleanup succeeded, false if it failed or threw.
 */
async function runCleanup(
  cleanup: CleanupFn,
  logger: IPipelineContext['logger'],
): Promise<Procedure<void>> {
  try {
    const result = await cleanup();
    if (!isOk(result)) {
      logger.debug('cleanup returned failure: %s', result.errorMessage);
    }
    return result;
  } catch (error) {
    const msg = toErrorMessage(error as Error).slice(0, 80);
    logger.debug('cleanup error (swallowed): %s', msg);
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
 * Execute the terminate phase — LIFO cleanup, never fails.
 * @param _ctx - Current pipeline context (unused).
 * @param input - Input context with browser state.
 * @returns Always succeed(input).
 */
async function executeTerminate(
  _ctx: IPipelineContext,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  if (!input.browser.has) return succeed(input);
  const cleanups = input.browser.value.cleanups;
  const lastIndex = cleanups.length - 1;
  await runCleanupsRecursive(cleanups, input.logger, lastIndex);
  return succeed(input);
}

/** Terminate step — runs reverse-order cleanup handlers. */
const TERMINATE_STEP: IPipelineStep<IPipelineContext, IPipelineContext> = {
  name: 'terminate',
  execute: executeTerminate,
};

export default TERMINATE_STEP;
export { runAllCleanups, TERMINATE_STEP };
