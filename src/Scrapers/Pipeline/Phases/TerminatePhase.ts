/**
 * Terminate phase — cleanup browser resources in LIFO order.
 * Extracted from BaseScraperWithBrowser.terminate().
 * Never fails the pipeline — cleanup errors are logged and swallowed.
 */

import { toErrorMessage } from '../Types/ErrorUtils.js';
import type { IPipelineStep } from '../Types/Phase.js';
import type { IPipelineContext } from '../Types/PipelineContext.js';
import type { Procedure } from '../Types/Procedure.js';
import { succeed } from '../Types/Procedure.js';

/**
 * Run a single cleanup handler, swallowing any error.
 * @param cleanup - The cleanup function to run.
 * @param logger - Logger for error reporting.
 * @returns True if cleanup succeeded, false if it threw.
 */
async function runCleanup(
  cleanup: () => Promise<boolean>,
  logger: IPipelineContext['logger'],
): Promise<boolean> {
  try {
    await cleanup();
    return true;
  } catch (error) {
    const msg = toErrorMessage(error as Error).slice(0, 80);
    logger.debug('cleanup error (swallowed): %s', msg);
    return false;
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
  cleanups: readonly (() => Promise<boolean>)[],
  logger: IPipelineContext['logger'],
  index: number,
): Promise<number> {
  if (index < 0) return 0;
  const didSucceed = await runCleanup(cleanups[index], logger);
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
  cleanups: readonly (() => Promise<boolean>)[],
  logger: IPipelineContext['logger'],
): Promise<number> {
  const lastIndex = cleanups.length - 1;
  return runCleanupsRecursive(cleanups, logger, lastIndex);
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
