/**
 * Page evaluation helpers — pageEval, pageEvalAll, dropdown, readyState.
 * Extracted from ElementsInteractions.ts to respect max-lines.
 */

import type { Frame, Page } from 'playwright-core';

import { getDebug as createLogger } from '../../Types/Debug.js';
import { toErrorMessage } from '../../Types/ErrorUtils.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import type { IPageEvalAllOpts, IPageEvalOpts } from './ElementsInteractions.js';

const LOG = createLogger('elements-eval');

type SelectorStr = string;
type OpResult = boolean;
type OptionValue = string;
type OptionName = string;

/**
 * Wait for the document to reach readyState complete.
 * @param ctx - The Page or Frame to wait on.
 * @returns True if ready, false on failure.
 */
async function waitForReadyState(ctx: Page | Frame): Promise<OpResult> {
  try {
    await ctx.waitForFunction((): OpResult => document.readyState === 'complete');
    return true;
  } catch {
    return false;
  }
}

/**
 * Evaluate a callback on all matching elements.
 * @param ctx - The Playwright page or frame.
 * @param opts - Selector, default result, and callback options.
 * @returns The callback result, or default if no elements found.
 */
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
    const msg = toErrorMessage(error as Error);
    LOG.debug({
      message: `pageEvalAll(${maskVisibleText(selector)}) error: ${maskVisibleText(msg)}`,
    });
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
    const msg = toErrorMessage(error as Error);
    LOG.debug({
      message: `pageEval(${maskVisibleText(selector)}) error: ${maskVisibleText(msg)}`,
    });
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
async function dropdownSelect(
  ctx: Page,
  selectSelector: SelectorStr,
  value: OptionValue,
): Promise<OpResult> {
  await ctx.selectOption(selectSelector, value);
  return true;
}

/**
 * Build the option extraction callback for browser context.
 * @param optSel - Option selector string.
 * @returns Array of name/value pairs.
 */
function optionExtractor(optSel: SelectorStr): { name: OptionName; value: OptionValue }[] {
  const elements = document.querySelectorAll<HTMLOptionElement>(optSel);
  return Array.from(elements)
    .filter((o): OpResult => Boolean(o.value))
    .map((o): { name: OptionName; value: OptionValue } => ({ name: o.text, value: o.value }));
}

/**
 * Extract all option elements from a dropdown.
 * @param ctx - The Playwright page.
 * @param selector - CSS selector for the select element.
 * @returns Array of name/value pairs.
 */
async function dropdownElements(
  ctx: Page,
  selector: SelectorStr,
): Promise<{ name: OptionName; value: OptionValue }[]> {
  const optionSelector = `${selector} > option`;
  return ctx.evaluate(optionExtractor, optionSelector);
}

export { dropdownElements, dropdownSelect, pageEval, pageEvalAll };
