import { type Frame, type Page } from 'playwright-core';

import ScraperError from '../../Base/ScraperError.js';
import { getDebug } from '../Types/Debug.js';
import { toErrorMessage } from '../Types/ErrorUtils.js';
import {
  CLICK_BUTTON_DELAY_MAX_MS,
  CLICK_BUTTON_DELAY_MIN_MS,
  ELEMENT_HTML_CAPTURE_LIMIT,
  FILL_INPUT_DELAY_MAX_MS,
  FILL_INPUT_DELAY_MIN_MS,
  IFRAME_DEFAULT_TIMEOUT_MS,
  IFRAME_POLL_INTERVAL_MS,
  PAGE_TEXT_CAPTURE_LIMIT,
} from './ElementsInteractionConfig.js';
import { humanDelay, waitUntil } from './Waiting.js';

const LOG = getDebug('elements');

/** CSS/XPath selector string. */
type SelectorStr = string;
/** Input value to fill. */
type InputValue = string;
/** Whether an operation completed. */
type OpResult = boolean;
/** Page text capture. */
type PageText = string;
/** HTML capture string. */
type HtmlCapture = string;
/** Timeout in milliseconds. */
type TimeoutMs = number;
/** Option value string. */
type OptionValue = string;
/** Option display name. */
type OptionName = string;

/**
 * Capture visible text from the page body for diagnostic logging.
 * @param pageOrFrame - The Playwright page or frame to capture text from.
 * @returns The first 400 characters of visible body text.
 */
export async function capturePageText(pageOrFrame: Page | Frame): Promise<PageText> {
  return pageOrFrame
    .evaluate(
      (limit: TimeoutMs): PageText =>
        document.body.innerText.replaceAll(/\s+/g, ' ').slice(0, limit),
      PAGE_TEXT_CAPTURE_LIMIT,
    )
    .catch((): PageText => '(context unavailable)');
}

/**
 * Capture outer HTML of a matched element for diagnostic logging.
 * @param pageOrFrame - The Playwright page or frame to search.
 * @param selector - The CSS selector for the target element.
 * @returns A truncated preview of the element's outer HTML.
 */
async function captureElementHtml(
  pageOrFrame: Page | Frame,
  selector: SelectorStr,
): Promise<HtmlCapture> {
  return pageOrFrame
    .evaluate(
      ({ sel, limit }: { sel: SelectorStr; limit: TimeoutMs }): HtmlCapture =>
        document.querySelector(sel)?.outerHTML.slice(0, limit) ?? '—',
      { sel: selector, limit: ELEMENT_HTML_CAPTURE_LIMIT },
    )
    .catch((): PageText => '(context unavailable)');
}

/** Options for waiting on element visibility or attachment. */
export interface IWaitOptions {
  visible?: OpResult;
  timeout?: TimeoutMs;
}

/** Options for evaluating a single element in a page context. */
export interface IPageEvalOpts<TResult> {
  selector: SelectorStr;
  defaultResult: TResult;
  callback: (element: Element, ...args: unknown[]) => TResult;
}

/** Options for evaluating multiple elements in a page context. */
export interface IPageEvalAllOpts<TResult> {
  selector: SelectorStr;
  defaultResult: TResult;
  callback: (elements: Element[], ...args: unknown[]) => TResult;
}

/**
 * Resolve the Playwright wait state from the visibility flag.
 * @param visible - Whether to wait for visibility.
 * @returns 'visible' or 'attached'.
 */
function resolveWaitState(visible?: OpResult): 'visible' | 'attached' {
  if (visible) return 'visible';
  return 'attached';
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
  elementSelector: SelectorStr,
  opts: IWaitOptions = {},
): Promise<OpResult> {
  const state = resolveWaitState(opts.visible);
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
  elementSelector: SelectorStr,
  timeout?: TimeoutMs,
): Promise<OpResult> {
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
  framePredicate: (frame: Frame) => OpResult,
  timeout: TimeoutMs,
): Promise<Frame | false> {
  let frame: Frame | false = false;
  await waitUntil(
    (): Promise<OpResult> => {
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
  framePredicate: (frame: Frame) => OpResult,
  opts: IWaitOptions & { description?: PageText } = {},
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
/**
 * Fill a form input field with a human-like delay.
 * @param pageOrFrame - The Playwright page or frame containing the input.
 * @param inputSelector - CSS selector for the input element.
 * @param inputValue - The value to fill into the input.
 * @returns True after the input is filled.
 */
async function fillInput(
  pageOrFrame: Page | Frame,
  inputSelector: SelectorStr,
  inputValue: InputValue,
): Promise<OpResult> {
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
  inputSelector: SelectorStr,
  inputValue: InputValue,
): Promise<OpResult> {
  await pageOrFrame
    .locator(inputSelector)
    .first()
    .evaluate((input: Element, val: InputValue): OpResult => {
      (input as HTMLInputElement).value = val;
      return true;
    }, inputValue);
  return true;
}

/**
 * Check whether a form input has the data-uw-hidden-control attribute.
 * UserWay-obscured inputs carry this attribute — standard fill() will not trigger ng-model.
 * @param ctx - Playwright Page or Frame containing the element.
 * @param selector - Playwright selector of the resolved element.
 * @returns True if the hidden-control attribute is present.
 */
async function isHiddenControlElement(ctx: Page | Frame, selector: SelectorStr): Promise<OpResult> {
  const locator = ctx.locator(selector).first();
  /**
   * Catch evaluate failure (element absent) — treat as no hidden-control.
   * @returns False.
   */
  const catchFalse = (): OpResult => false;
  const hasAttr = await locator
    .evaluate((el: Element): OpResult => el.hasAttribute('data-uw-hidden-control'))
    .catch(catchFalse);
  return hasAttr;
}

/**
 * Set a form input value via DOM evaluation with AngularJS-compatible event dispatch.
 * Dispatches input (bubbles:true), change, and blur to satisfy ng-model listeners.
 * @param ctx - Playwright Page or Frame containing the input.
 * @param selector - Playwright selector of the target input.
 * @param value - Value to set.
 * @returns True after the value is set and events dispatched.
 */
async function angularModelFill(
  ctx: Page | Frame,
  selector: SelectorStr,
  value: InputValue,
): Promise<OpResult> {
  await humanDelay(FILL_INPUT_DELAY_MIN_MS, FILL_INPUT_DELAY_MAX_MS);
  const locator = ctx.locator(selector).first();
  return locator.evaluate(dispatchAngularEvents, value);
}

/**
 * Browser-context: set input value and dispatch AngularJS-compatible events.
 * Self-contained — Playwright serializes only this function.
 * @param el - The DOM input element.
 * @param val - The value to set.
 * @returns True after events are dispatched.
 */
function dispatchAngularEvents(el: Element, val: InputValue): OpResult {
  (el as HTMLInputElement).value = val;
  const events: [string, boolean][] = [
    ['input', true],
    ['change', false],
    ['blur', false],
  ];
  for (const [name, isBubbling] of events) {
    const evt: Event = Reflect.construct(Event, [name, { bubbles: isBubbling }]);
    el.dispatchEvent(evt);
  }
  return true;
}

/**
 * Fill a form input — auto-detects data-uw-hidden-control (UserWay-obscured) elements.
 * Hidden-control elements use DOM evaluate + AngularJS-compatible event dispatch.
 * Standard elements use Playwright fill() with human delay.
 * @param ctx - Playwright Page or Frame containing the input.
 * @param selector - Playwright selector of the target input.
 * @param value - Value to fill.
 * @returns True after fill.
 */
async function deepFillInput(
  ctx: Page | Frame,
  selector: SelectorStr,
  value: InputValue,
): Promise<OpResult> {
  const isHidden = await isHiddenControlElement(ctx, selector);
  if (isHidden) return angularModelFill(ctx, selector, value);
  return fillInput(ctx, selector, value);
}

/**
 * Click a button element with a human-like delay.
 * @param page - The Playwright page or frame containing the button.
 * @param buttonSelector - CSS selector for the button element.
 * @returns True after the button is clicked.
 */
async function clickButton(page: Page | Frame, buttonSelector: SelectorStr): Promise<OpResult> {
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
async function clickLink(page: Page, aSelector: SelectorStr): Promise<OpResult> {
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
  const isReady = await waitForReadyState(page);
  if (!isReady) return defaultResult;
  const locator = page.locator(selector);
  if ((await locator.count()) === 0) return defaultResult;
  try {
    return await locator.evaluateAll(callback);
  } catch (error) {
    const msg = toErrorMessage(error as Error);
    LOG.debug('pageEvalAll(%s) error: %s', selector, msg);
    return defaultResult;
  }
}

/**
 * Wait for the page document to reach readyState complete.
 * @param page - The Page or Frame to wait on.
 * @returns True if ready, false on failure.
 */
async function waitForReadyState(page: Page | Frame): Promise<OpResult> {
  try {
    await page.waitForFunction((): OpResult => document.readyState === 'complete');
    return true;
  } catch {
    return false;
  }
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
  const isReady = await waitForReadyState(page);
  if (!isReady) return defaultResult;
  const locator = page.locator(selector);
  if ((await locator.count()) === 0) return defaultResult;
  try {
    return await locator.first().evaluate(callback);
  } catch (error) {
    const msg = toErrorMessage(error as Error);
    LOG.debug('pageEval(%s) error: %s', selector, msg);
    return defaultResult;
  }
}

/**
 * Check whether an element matching the selector exists on the page.
 * @param pageOrFrame - The Playwright page or frame to search.
 * @param selector - The CSS selector to check for.
 * @returns True if the element exists, false otherwise.
 */
async function elementPresentOnPage(
  pageOrFrame: Page | Frame,
  selector: SelectorStr,
): Promise<OpResult> {
  return (await pageOrFrame.locator(selector).count()) > 0;
}

/**
 * Select a value from a dropdown element.
 * @param page - The Playwright page containing the dropdown.
 * @param selectSelector - CSS selector for the select element.
 * @param value - The option value to select.
 * @returns True after the selection is made.
 */
async function dropdownSelect(
  page: Page,
  selectSelector: SelectorStr,
  value: OptionValue,
): Promise<OpResult> {
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
  selector: SelectorStr,
): Promise<{ name: OptionName; value: OptionValue }[]> {
  const optionSelector = `${selector} > option`;
  const options = await page.evaluate(
    (optSel: SelectorStr): { name: OptionName; value: OptionValue }[] => {
      const elements = document.querySelectorAll<HTMLOptionElement>(optSel);
      return Array.from(elements)
        .filter((o): OpResult => Boolean(o.value))
        .map((o): { name: OptionName; value: OptionValue } => ({
          name: o.text,
          value: o.value,
        }));
    },
    optionSelector,
  );
  return options;
}

export {
  clickButton,
  clickLink,
  deepFillInput,
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
