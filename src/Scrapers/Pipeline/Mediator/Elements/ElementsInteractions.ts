/**
 * Element interactions — fill, click, capture, presence check.
 * Low-level input helpers in ElementsInputHelpers.ts.
 * Wait helpers re-exported from ElementWaitAction.ts.
 * Eval helpers re-exported from PageEvalAction.ts.
 */

import { type Frame, type Page } from 'playwright-core';

import { getDebug as createLogger } from '../../Types/Debug.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import { humanDelay } from '../Timing/Waiting.js';
import {
  CLICK_BUTTON_DELAY_MAX_MS,
  CLICK_BUTTON_DELAY_MIN_MS,
  ELEMENT_HTML_CAPTURE_LIMIT,
  PAGE_TEXT_CAPTURE_LIMIT,
} from './ElementsInteractionConfig.js';

const LOG = createLogger('elements');

/** Options for waiting on element visibility or attachment. */
export interface IWaitOptions {
  visible?: boolean;
  timeout?: number;
}

/** Options for evaluating a single element. */
export interface IPageEvalOpts<TResult> {
  selector: string;
  defaultResult: TResult;
  callback: (element: Element, ...args: unknown[]) => TResult;
}

/** Options for evaluating multiple elements. */
export interface IPageEvalAllOpts<TResult> {
  selector: string;
  defaultResult: TResult;
  callback: (elements: Element[], ...args: unknown[]) => TResult;
}

/**
 * Capture visible text from the page body for diagnostics.
 * @param pageOrFrame - Page or frame.
 * @returns First 400 chars of body text.
 */
export async function capturePageText(pageOrFrame: Page | Frame): Promise<string> {
  return pageOrFrame
    .evaluate(
      (limit: number): string => document.body.innerText.replaceAll(/\s+/g, ' ').slice(0, limit),
      PAGE_TEXT_CAPTURE_LIMIT,
    )
    .catch((): string => '(context unavailable)');
}

/**
 * Capture outer HTML of a matched element for diagnostics.
 * @param pageOrFrame - Page or frame.
 * @param selector - CSS selector.
 * @returns Truncated outer HTML preview.
 */
async function captureElementHtml(pageOrFrame: Page | Frame, selector: string): Promise<string> {
  return pageOrFrame
    .evaluate(
      ({ sel, limit }: { sel: string; limit: number }): string =>
        document.querySelector(sel)?.outerHTML.slice(0, limit) ?? '—',
      { sel: selector, limit: ELEMENT_HTML_CAPTURE_LIMIT },
    )
    .catch((): string => '(context unavailable)');
}

/**
 * Click a button with human-like delay.
 * @param ctx - Page or frame.
 * @param buttonSelector - CSS selector.
 * @returns True after click.
 */
async function clickButton(ctx: Page | Frame, buttonSelector: string): Promise<boolean> {
  LOG.debug({
    message: `click ${maskVisibleText(buttonSelector)}`,
  });
  await humanDelay(CLICK_BUTTON_DELAY_MIN_MS, CLICK_BUTTON_DELAY_MAX_MS);
  await ctx.locator(buttonSelector).first().click();
  return true;
}

/**
 * Click a link via locator.
 * @param ctx - Page.
 * @param aSelector - CSS selector for anchor.
 * @returns True after click.
 */
async function clickLink(ctx: Page, aSelector: string): Promise<boolean> {
  await ctx.locator(aSelector).first().click();
  return true;
}

/**
 * Check whether an element exists.
 * @param pageOrFrame - Page or frame.
 * @param selector - CSS selector.
 * @returns True if exists.
 */
async function elementPresentOnPage(pageOrFrame: Page | Frame, selector: string): Promise<boolean> {
  return (await pageOrFrame.locator(selector).count()) > 0;
}

export { deepFillInput, fillInput, setValue } from './ElementsInputActions.js';
export {
  waitUntilElementDisappear,
  waitUntilElementFound,
  waitUntilIframeFound,
} from './ElementWaitAction.js';
export { dropdownElements, dropdownSelect, pageEval, pageEvalAll } from './PageEvalAction.js';

export { captureElementHtml, clickButton, clickLink, elementPresentOnPage };
