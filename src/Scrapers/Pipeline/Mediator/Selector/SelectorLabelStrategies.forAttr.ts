/**
 * for-attribute label resolution: locate an input via its label's `for=` id.
 */

import type { Frame, Page } from 'playwright-core';

import { maskVisibleText } from '../../Types/LogEvent.js';
import { isFillableInput } from './SelectorLabelStrategies.elements.js';
import { logField, logMsg } from './SelectorLabelStrategies.logging.js';

/**
 * Log NOT_FOUND outcome and return ''.
 * @param field - The field tag for the diagnostic.
 * @returns Empty string sentinel.
 */
function logMissAndEmpty(field: string): string {
  logField(field, 'NOT_FOUND');
  return '';
}

/**
 * Log NOT-FILLABLE outcome and return ''.
 * @param forAttr - The for-attribute value.
 * @param labelValue - The visible label text.
 * @returns Empty string sentinel.
 */
function logFillFailAndEmpty(forAttr: string, labelValue: string): string {
  const masked = maskVisibleText(labelValue);
  logMsg(`labelText "${masked}" for="${forAttr}" → NOT FILLABLE`);
  return '';
}

/**
 * Check whether `#${forAttr}` exists in the given context.
 * @param ctx - Page or Frame.
 * @param inputSelector - The `#id` selector.
 * @returns True when at least one matching node exists.
 */
async function inputExists(ctx: Page | Frame, inputSelector: string): Promise<boolean> {
  return (await ctx.locator(inputSelector).count()) > 0;
}

/** Inputs for {@link checkFillAndLog}. */
interface ICheckFillArgs {
  ctx: Page | Frame;
  selector: string;
  forAttr: string;
  labelValue: string;
}

/**
 * Verify the resolved selector is fillable, emit the matching log line.
 * @param args - Context, selector, original for-attr, and label text.
 * @returns The selector on success, '' when not fillable.
 */
async function checkFillAndLog(args: ICheckFillArgs): Promise<string> {
  const isFill = await isFillableInput(args.ctx, args.selector);
  if (!isFill) return logFillFailAndEmpty(args.forAttr, args.labelValue);
  logField(`labelText:${maskVisibleText(args.labelValue)}`, 'FOUND');
  return args.selector;
}

/**
 * Find the input element referenced by a label's for attribute.
 * @param ctx - The Playwright Page or Frame to search in.
 * @param forAttr - The for attribute value from the label.
 * @param labelValue - The visible label text (for diagnostic logging).
 * @returns The CSS selector for the input, or empty string if not found.
 */
async function findInputByForAttr(
  ctx: Page | Frame,
  forAttr: string,
  labelValue: string,
): Promise<string> {
  const selector = `#${forAttr}`;
  const isExisting = await inputExists(ctx, selector);
  if (!isExisting) return logMissAndEmpty(`labelText:for=${maskVisibleText(forAttr)}`);
  return checkFillAndLog({ ctx, selector, forAttr, labelValue });
}

export default findInputByForAttr;

export { findInputByForAttr };
