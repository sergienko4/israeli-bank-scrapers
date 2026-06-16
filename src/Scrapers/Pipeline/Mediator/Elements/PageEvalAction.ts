/**
 * Page evaluation helpers — pageEval, pageEvalAll, dropdown, readyState.
 * Extracted from ElementsInteractions.ts to respect max-lines.
 */

import type { Frame, Page } from 'playwright-core';

import { getDebug as createLogger } from '../../Types/Debug.js';
import { toError } from '../../Types/ErrorUtils.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import type { IPageEvalAllOpts, IPageEvalOpts } from './ElementsActionTypes.js';

const LOG = createLogger('elements-eval');

/**
 * Wait for the document to reach readyState complete.
 * @param ctx - The Page or Frame to wait on.
 * @returns True if ready, false on failure.
 */
async function waitForReadyState(ctx: Page | Frame): Promise<boolean> {
  try {
    await ctx.waitForFunction((): boolean => document.readyState === 'complete');
    return true;
  } catch {
    return false;
  }
}

/**
 * Shared error logger for the pageEval/pageEvalAll catch arms.
 * Uses {@link toError} to safely normalise non-Error throws
 * (e.g. `throw 'string'`, `throw {…}`, `throw 42`) — the previous
 * `toErrorMessage(error as Error)` cast crashed when a callback
 * threw anything other than `Error` or `string`.
 * @param label - Function name for the log message ('pageEval' / 'pageEvalAll').
 * @param selector - Selector being evaluated (masked before emit).
 * @param error - Caught error from the evaluate call.
 * @returns True after emit (callers discard).
 */
function logEvalError(label: string, selector: string, error: unknown): true {
  const msg = toError(error).message;
  LOG.debug({
    message: `${label}(${maskVisibleText(selector)}) error: ${maskVisibleText(msg)}`,
  });
  return true;
}

/**
 * Evaluate a callback on all matching elements.
 * @param ctx - The Playwright page or frame.
 * @param opts - Selector, default result, and callback options.
 * @returns The callback result, or default if no elements found.
 */
async function pageEvalAll<TResult>(
  ctx: Page | Frame,
  opts: IPageEvalAllOpts<TResult>,
): Promise<TResult> {
  const { selector, defaultResult, callback } = opts;
  if (!(await waitForReadyState(ctx))) return defaultResult;
  const locator = ctx.locator(selector);
  if ((await locator.count()) === 0) return defaultResult;
  try {
    return await locator.evaluateAll(callback);
  } catch (error) {
    logEvalError('pageEvalAll', selector, error);
    return defaultResult;
  }
}

/**
 * Evaluate a callback on a single matching element.
 * @param ctx - The Playwright page or frame.
 * @param opts - Selector, default result, and callback options.
 * @returns The callback result, or default if no element found.
 */
async function pageEval<TResult>(
  ctx: Page | Frame,
  opts: IPageEvalOpts<TResult>,
): Promise<TResult> {
  const { selector, defaultResult, callback } = opts;
  if (!(await waitForReadyState(ctx))) return defaultResult;
  const locator = ctx.locator(selector);
  if ((await locator.count()) === 0) return defaultResult;
  try {
    return await locator.first().evaluate(callback);
  } catch (error) {
    logEvalError('pageEval', selector, error);
    return defaultResult;
  }
}

/**
 * Select a value from a dropdown element.
 * @param ctx - The Playwright page.
 * @param selectSelector - CSS selector for the select element.
 * @param value - The option value to select.
 * @returns True after selection.
 */
async function dropdownSelect(ctx: Page, selectSelector: string, value: string): Promise<boolean> {
  await ctx.selectOption(selectSelector, value);
  return true;
}

/**
 * Build the option extraction callback for browser context.
 * @param optSel - Option selector string.
 * @returns Array of name/value pairs.
 */
function optionExtractor(optSel: string): { name: string; value: string }[] {
  const elements = document.querySelectorAll<HTMLOptionElement>(optSel);
  return Array.from(elements)
    .filter((o): boolean => Boolean(o.value))
    .map((o): { name: string; value: string } => ({ name: o.text, value: o.value }));
}

/**
 * Extract all option elements from a dropdown.
 * @param ctx - The Playwright page.
 * @param selector - CSS selector for the select element.
 * @returns Array of name/value pairs.
 */
async function dropdownElements(
  ctx: Page,
  selector: string,
): Promise<{ name: string; value: string }[]> {
  const optionSelector = `${selector} > option`;
  return ctx.evaluate(optionExtractor, optionSelector);
}

export { dropdownElements, dropdownSelect, pageEval, pageEvalAll };
