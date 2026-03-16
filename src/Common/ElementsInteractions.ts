import { type Frame, type Page } from 'playwright-core';

import ScraperError from '../Scrapers/Base/ScraperError.js';
import {
  CLICK_BUTTON_DELAY_MAX_MS,
  CLICK_BUTTON_DELAY_MIN_MS,
  ELEMENT_HTML_CAPTURE_LIMIT,
  FILL_INPUT_DELAY_MAX_MS,
  FILL_INPUT_DELAY_MIN_MS,
  IFRAME_DEFAULT_TIMEOUT_MS,
  IFRAME_POLL_INTERVAL_MS,
  PAGE_TEXT_CAPTURE_LIMIT,
} from './Config/ElementsInteractionConfig.js';
import { getDebug } from './Debug.js';
import { humanDelay, waitUntil } from './Waiting.js';

const LOG = getDebug('elements');

/**
 * Capture visible text from the page body for diagnostic logging.
 * @param pageOrFrame - The Playwright page or frame to capture text from.
 * @returns The first 400 characters of visible body text.
 */
export async function capturePageText(pageOrFrame: Page | Frame): Promise<string> {
  return pageOrFrame
    .evaluate(
      (limit: number): string => document.body.innerText.replaceAll(/\s+/g, ' ').slice(0, limit),
      PAGE_TEXT_CAPTURE_LIMIT,
    )
    .catch(() => '(context unavailable)');
}

/**
 * Capture outer HTML of a matched element for diagnostic logging.
 * @param pageOrFrame - The Playwright page or frame to search.
 * @param selector - The CSS selector for the target element.
 * @returns A truncated preview of the element's outer HTML.
 */
async function captureElementHtml(pageOrFrame: Page | Frame, selector: string): Promise<string> {
  return pageOrFrame
    .evaluate(
      ({ sel, limit }: { sel: string; limit: number }): string =>
        document.querySelector(sel)?.outerHTML.slice(0, limit) ?? '—',
      { sel: selector, limit: ELEMENT_HTML_CAPTURE_LIMIT },
    )
    .catch(() => '(context unavailable)');
}

/** Options for waiting on element visibility or attachment. */
export interface IWaitOptions {
  visible?: boolean;
  timeout?: number;
}

/** Options for evaluating a single element in a page context. */
export interface IPageEvalOpts<TResult> {
  selector: string;
  defaultResult: TResult;
  callback: (element: Element, ...args: unknown[]) => TResult;
}

/** Options for evaluating multiple elements in a page context. */
export interface IPageEvalAllOpts<TResult> {
  selector: string;
  defaultResult: TResult;
  callback: (elements: Element[], ...args: unknown[]) => TResult;
}

/**
 * Wait until a selector is present (or visible) on the page.
 * @param page - The Playwright page or frame to wait in.
 * @param elementSelector - The CSS selector to wait for.
 * @param opts - Visibility and timeout options.
 * @returns True after the element is found.
 */
async function waitUntilElementFound(
  page: Page | Frame,
  elementSelector: string,
  opts: IWaitOptions = {},
): Promise<boolean> {
  const state = opts.visible ? 'visible' : 'attached';
  const startMs = Date.now();
  try {
    await page.waitForSelector(elementSelector, { state, timeout: opts.timeout });
    LOG.debug('waitForSelector %s → found (%dms)', elementSelector, Date.now() - startMs);
    const html = await captureElementHtml(page, elementSelector);
    LOG.debug('element html: %s', html);
  } catch (e) {
    LOG.debug('waitForSelector %s → TIMEOUT (%dms)', elementSelector, Date.now() - startMs);
    const text = await capturePageText(page);
    LOG.debug('page text: %s', text);
    throw e;
  }
  return true;
}

/**
 * Wait until a selector disappears (becomes hidden) from the page.
 * @param page - The Playwright page to wait in.
 * @param elementSelector - The CSS selector to wait for disappearance.
 * @param timeout - Optional timeout in milliseconds.
 * @returns True after the element disappears.
 */
async function waitUntilElementDisappear(
  page: Page,
  elementSelector: string,
  timeout?: number,
): Promise<boolean> {
  await page.waitForSelector(elementSelector, { state: 'hidden', timeout });
  return true;
}

/**
 * Wait for a matching iframe to appear on the page.
 * @param page - The Playwright page to search frames within.
 * @param framePredicate - A function that returns true for the target frame.
 * @param timeout - Maximum time to wait in milliseconds.
 * @returns The matched frame, or false if not found within timeout.
 */
async function waitForIframe(
  page: Page,
  framePredicate: (frame: Frame) => boolean,
  timeout: number,
): Promise<Frame | false> {
  let frame: Frame | false = false;
  await waitUntil(
    () => {
      frame = page.frames().find(framePredicate) ?? false;
      return Promise.resolve(frame !== false);
    },
    'waiting for iframe',
    { timeout, interval: IFRAME_POLL_INTERVAL_MS },
  );
  return frame;
}

/**
 * Wait for a matching iframe and throw if not found.
 * @param page - The Playwright page to search frames within.
 * @param framePredicate - A function that returns true for the target frame.
 * @param opts - Timeout, visibility, and description options.
 * @returns The matched frame.
 */
async function waitUntilIframeFound(
  page: Page,
  framePredicate: (frame: Frame) => boolean,
  opts: IWaitOptions & { description?: string } = {},
): Promise<Frame> {
  const { timeout = IFRAME_DEFAULT_TIMEOUT_MS, description = '' } = opts;
  const frame = await waitForIframe(page, framePredicate, timeout);

  if (frame === false) {
    throw new ScraperError(`failed to find iframe: ${description}`);
  }

  return frame;
}

/**
 * Fill a form input field with a human-like delay.
 * @param pageOrFrame - The Playwright page or frame containing the input.
 * @param inputSelector - CSS selector for the input element.
 * @param inputValue - The value to fill into the input.
 * @returns True after the input is filled.
 */
async function fillInput(
  pageOrFrame: Page | Frame,
  inputSelector: string,
  inputValue: string,
): Promise<boolean> {
  LOG.debug('fill %s', inputSelector);
  await humanDelay(FILL_INPUT_DELAY_MIN_MS, FILL_INPUT_DELAY_MAX_MS);
  await pageOrFrame.locator(inputSelector).first().fill(inputValue);
  return true;
}

/**
 * Set a form input value directly via DOM evaluation.
 * @param pageOrFrame - The Playwright page or frame containing the input.
 * @param inputSelector - CSS selector for the input element.
 * @param inputValue - The value to set on the input.
 * @returns True after the value is set.
 */
async function setValue(
  pageOrFrame: Page | Frame,
  inputSelector: string,
  inputValue: string,
): Promise<boolean> {
  await pageOrFrame
    .locator(inputSelector)
    .first()
    .evaluate((input: Element, val: string) => {
      (input as HTMLInputElement).value = val;
    }, inputValue);
  return true;
}

/**
 * Click a button element with a human-like delay.
 * @param page - The Playwright page or frame containing the button.
 * @param buttonSelector - CSS selector for the button element.
 * @returns True after the button is clicked.
 */
async function clickButton(page: Page | Frame, buttonSelector: string): Promise<boolean> {
  LOG.debug('click %s', buttonSelector);
  await humanDelay(CLICK_BUTTON_DELAY_MIN_MS, CLICK_BUTTON_DELAY_MAX_MS);
  await page.locator(buttonSelector).first().click();
  return true;
}

/**
 * Click a link element via DOM evaluation.
 * @param page - The Playwright page containing the link.
 * @param aSelector - CSS selector for the anchor element.
 * @returns True after the link is clicked.
 */
async function clickLink(page: Page, aSelector: string): Promise<boolean> {
  await page.locator(aSelector).first().click();
  return true;
}

/**
 * Evaluate a callback on all matching elements, with a default fallback.
 * @param page - The Playwright page or frame to evaluate within.
 * @param opts - Selector, default result, and callback options.
 * @returns The callback result, or the default if no elements found.
 */
async function pageEvalAll<TResult>(
  page: Page | Frame,
  opts: IPageEvalAllOpts<TResult>,
): Promise<TResult> {
  const { selector, defaultResult, callback } = opts;
  let result = defaultResult;
  try {
    await page.waitForFunction(() => document.readyState === 'complete');
    result = await page.locator(selector).evaluateAll(callback);
  } catch {
    // evaluateAll passes an empty array when no elements match; catch any remaining errors.
  }

  return result;
}

/**
 * Evaluate a callback on a single matching element, with a default fallback.
 * @param page - The Playwright page or frame to evaluate within.
 * @param opts - Selector, default result, and callback options.
 * @returns The callback result, or the default if no element found.
 */
async function pageEval<TResult>(
  page: Page | Frame,
  opts: IPageEvalOpts<TResult>,
): Promise<TResult> {
  const { selector, defaultResult, callback } = opts;
  let result = defaultResult;
  try {
    await page.waitForFunction(() => document.readyState === 'complete');
    result = await page.locator(selector).first().evaluate(callback);
  } catch {
    // Locator throws when no element matches; return the default result instead.
  }

  return result;
}

/**
 * Check whether an element matching the selector exists on the page.
 * @param pageOrFrame - The Playwright page or frame to search.
 * @param selector - The CSS selector to check for.
 * @returns True if the element exists, false otherwise.
 */
async function elementPresentOnPage(pageOrFrame: Page | Frame, selector: string): Promise<boolean> {
  return (await pageOrFrame.locator(selector).count()) > 0;
}

/**
 * Select a value from a dropdown element.
 * @param page - The Playwright page containing the dropdown.
 * @param selectSelector - CSS selector for the select element.
 * @param value - The option value to select.
 * @returns True after the selection is made.
 */
async function dropdownSelect(page: Page, selectSelector: string, value: string): Promise<boolean> {
  await page.selectOption(selectSelector, value);
  return true;
}

/**
 * Extract all option elements from a dropdown as name/value pairs.
 * @param page - The Playwright page containing the dropdown.
 * @param selector - CSS selector for the select element.
 * @returns Array of objects with name and value properties.
 */
async function dropdownElements(
  page: Page,
  selector: string,
): Promise<{ name: string; value: string }[]> {
  const optionSelector = `${selector} > option`;
  const options = await page.evaluate((optSel: string) => {
    const elements = document.querySelectorAll<HTMLOptionElement>(optSel);
    return Array.from(elements)
      .filter(o => o.value)
      .map(o => {
        return {
          name: o.text,
          value: o.value,
        };
      });
  }, optionSelector);
  return options;
}

export {
  clickButton,
  clickLink,
  dropdownElements,
  dropdownSelect,
  elementPresentOnPage,
  fillInput,
  pageEval,
  pageEvalAll,
  setValue,
  waitUntilElementDisappear,
  waitUntilElementFound,
  waitUntilIframeFound,
};
