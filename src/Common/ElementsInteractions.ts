import { type Frame, type Page } from 'playwright';

import type { PageEvalAllOpts } from '../Interfaces/Common/PageEvalAllOpts';
import type { PageEvalOpts } from '../Interfaces/Common/PageEvalOpts';
import type { WaitOptions } from '../Interfaces/Common/WaitOptions';
import { ScraperWebsiteChangedError } from '../Scrapers/Base/ScraperWebsiteChangedError';
import { getDebug } from './Debug';
import { humanDelay, waitUntil } from './Waiting';

export type { PageEvalAllOpts } from '../Interfaces/Common/PageEvalAllOpts';
export type { PageEvalOpts } from '../Interfaces/Common/PageEvalOpts';
export type { WaitOptions } from '../Interfaces/Common/WaitOptions';

const LOG = getDebug('elements');

/**
 * Extracts a short snippet of visible text from the page body for diagnostic logging.
 * Returns a fallback string when the page context is unavailable (e.g. navigating away).
 *
 * @param pageOrFrame - the Playwright Page or Frame to extract text from
 * @returns up to 400 characters of whitespace-collapsed body text, or '(context unavailable)'
 */
export async function capturePageText(pageOrFrame: Page | Frame): Promise<string> {
  return pageOrFrame
    .evaluate((): string => document.body.innerText.replace(/\s+/g, ' ').slice(0, 400))
    .catch(() => '(context unavailable)');
}

/**
 * Returns up to 300 characters of the outer HTML of the first element matching the selector,
 * for use in diagnostic log messages. Returns '—' when the element is not found.
 *
 * @param pageOrFrame - the Playwright Page or Frame to query
 * @param selector - a CSS selector identifying the element to capture
 * @returns a truncated outerHTML string, or '(context unavailable)' on error
 */
async function captureElementHtml(pageOrFrame: Page | Frame, selector: string): Promise<string> {
  return pageOrFrame
    .evaluate(
      (sel: string): string => document.querySelector(sel)?.outerHTML.slice(0, 300) ?? '—',
      selector,
    )
    .catch(() => '(context unavailable)');
}

/**
 * Waits until the specified element is present in the DOM (or visible, if opts.visible is set).
 * Logs a diagnostic snippet of the element HTML on success, or the page text on timeout.
 *
 * @param page - the Playwright Page or Frame to query
 * @param elementSelector - a CSS selector for the element to wait for
 * @param opts - optional waiting configuration including timeout and visibility requirements
 */
async function waitUntilElementFound(
  page: Page | Frame,
  elementSelector: string,
  opts: WaitOptions = {},
): Promise<void> {
  const state = opts.visible ? 'visible' : 'attached';
  const startMs = Date.now();
  try {
    await page.waitForSelector(elementSelector, { state, timeout: opts.timeout });
    LOG.info('waitForSelector %s → found (%dms)', elementSelector, Date.now() - startMs);
    LOG.info('element html: %s', await captureElementHtml(page, elementSelector));
  } catch (e) {
    LOG.info('waitForSelector %s → TIMEOUT (%dms)', elementSelector, Date.now() - startMs);
    LOG.info('page text: %s', await capturePageText(page));
    throw e;
  }
}

/**
 * Waits until the specified element is hidden or removed from the DOM.
 *
 * @param page - the Playwright Page to query
 * @param elementSelector - a CSS selector for the element to wait on
 * @param timeout - maximum time to wait in milliseconds; uses Playwright default when omitted
 */
async function waitUntilElementDisappear(
  page: Page,
  elementSelector: string,
  timeout?: number,
): Promise<void> {
  await page.waitForSelector(elementSelector, { state: 'hidden', timeout });
}

/**
 * Polls the page's frame list until a frame matching the predicate appears or the timeout expires.
 *
 * @param page - the Playwright Page whose child frames are searched
 * @param framePredicate - a function that returns true for the desired frame
 * @param timeout - maximum polling duration in milliseconds
 * @returns the matching Frame, or undefined when the timeout expires without a match
 */
async function waitForIframe(
  page: Page,
  framePredicate: (frame: Frame) => boolean,
  timeout: number,
): Promise<Frame | undefined> {
  let frame: Frame | undefined;
  await waitUntil(
    () => {
      frame = page.frames().find(framePredicate);
      return Promise.resolve(!!frame);
    },
    'waiting for iframe',
    { timeout, interval: 1000 },
  );
  return frame;
}

/**
 * Waits until an iframe matching the predicate appears on the page, then returns it.
 * Throws ScraperWebsiteChangedError when no matching frame is found within the timeout.
 *
 * @param page - the Playwright Page whose child frames are searched
 * @param framePredicate - a function that returns true for the desired frame
 * @param opts - optional timeout (ms) and a human-readable description for error messages
 * @returns the matching Frame
 */
async function waitUntilIframeFound(
  page: Page,
  framePredicate: (frame: Frame) => boolean,
  opts: WaitOptions & { description?: string } = {},
): Promise<Frame> {
  const { timeout = 30000, description = '' } = opts;
  const frame = await waitForIframe(page, framePredicate, timeout);

  if (!frame) {
    throw new ScraperWebsiteChangedError(
      'ElementsInteractions',
      `failed to find iframe: ${description}`,
    );
  }

  return frame;
}

/**
 * Clears the target input field and types the given value character-by-character with a
 * randomised human-like delay between keystrokes to reduce bot-detection risk.
 *
 * @param pageOrFrame - the Playwright Page or Frame containing the input element
 * @param inputSelector - a CSS selector identifying the input field
 * @param inputValue - the text to type into the field
 */
async function fillInput(
  pageOrFrame: Page | Frame,
  inputSelector: string,
  inputValue: string,
): Promise<void> {
  LOG.info('fill %s', inputSelector);
  await humanDelay(200, 600);
  await pageOrFrame.$eval(inputSelector, (input: Element) => {
    (input as HTMLInputElement).value = '';
  });
  await pageOrFrame
    .locator(inputSelector)
    .pressSequentially(inputValue, { delay: 50 + Math.random() * 100 });
}

/**
 * Directly sets the `.value` property of an input element via page evaluation,
 * bypassing keyboard events. Use this for hidden or programmatically controlled inputs
 * where character-by-character typing is not required.
 *
 * @param pageOrFrame - the Playwright Page or Frame containing the input element
 * @param inputSelector - a CSS selector identifying the input field
 * @param inputValue - the value to assign directly to the element
 */
async function setValue(
  pageOrFrame: Page | Frame,
  inputSelector: string,
  inputValue: string,
): Promise<void> {
  await pageOrFrame.$eval(
    inputSelector,
    (input: Element, [value]: string[]) => {
      (input as HTMLInputElement).value = value;
    },
    [inputValue],
  );
}

/**
 * Simulates a human-like button click with a random pre-click delay,
 * triggering the click via DOM evaluation to bypass Playwright's click checks.
 *
 * @param page - the Playwright Page or Frame containing the button
 * @param buttonSelector - a CSS selector identifying the button element
 */
async function clickButton(page: Page | Frame, buttonSelector: string): Promise<void> {
  LOG.info('click %s', buttonSelector);
  await humanDelay(200, 800);
  await page.$eval(buttonSelector, el => {
    (el as HTMLElement).click();
  });
}

/**
 * Clicks an anchor or link element by triggering a DOM click event via page evaluation.
 *
 * @param page - the Playwright Page containing the link element
 * @param aSelector - a CSS selector identifying the link element to click
 */
async function clickLink(page: Page, aSelector: string): Promise<void> {
  await page.$eval(aSelector, (el: Element) => {
    (el as HTMLElement).click();
  });
}

/**
 * Evaluates a callback against all elements matching the selector, returning a typed result.
 * Waits for the document to be fully loaded before querying. Returns opts.defaultResult when
 * no elements are found, swallowing the "no elements" error silently.
 *
 * @param page - the Playwright Page or Frame to query
 * @param opts - configuration containing the selector, default result, and mapping callback
 * @returns the result of calling opts.callback with all matched elements, or opts.defaultResult
 */
async function pageEvalAll<TResult>(
  page: Page | Frame,
  opts: PageEvalAllOpts<TResult>,
): Promise<TResult> {
  const { selector, defaultResult, callback } = opts;
  let result = defaultResult;
  try {
    await page.waitForFunction(() => document.readyState === 'complete');
    result = await page.$$eval(selector, callback);
  } catch (e) {
    // Swallow "no elements found" errors and return the default result instead.
    if (!(e as Error).message.startsWith('Error: failed to find elements matching selector')) {
      throw e;
    }
  }

  return result;
}

/**
 * Evaluates a callback against the first element matching the selector, returning a typed result.
 * Waits for the document to be fully loaded before querying. Returns opts.defaultResult when
 * the element is not found, swallowing the "no element" error silently.
 *
 * @param page - the Playwright Page or Frame to query
 * @param opts - configuration containing the selector, default result, and mapping callback
 * @returns the result of calling opts.callback with the matched element, or opts.defaultResult
 */
async function pageEval<TResult>(
  page: Page | Frame,
  opts: PageEvalOpts<TResult>,
): Promise<TResult> {
  const { selector, defaultResult, callback } = opts;
  let result = defaultResult;
  try {
    await page.waitForFunction(() => document.readyState === 'complete');
    result = await page.$eval(selector, callback);
  } catch (e) {
    // Swallow "no elements found" errors and return the default result instead.
    if (!(e as Error).message.startsWith('Error: failed to find element matching selector')) {
      throw e;
    }
  }

  return result;
}

/**
 * Checks whether at least one element matching the selector exists in the DOM right now.
 *
 * @param pageOrFrame - the Playwright Page or Frame to query
 * @param selector - a CSS selector to look for
 * @returns true when at least one matching element is attached to the DOM
 */
async function elementPresentOnPage(pageOrFrame: Page | Frame, selector: string): Promise<boolean> {
  return (await pageOrFrame.$(selector)) !== null;
}

/**
 * Selects an option in a native HTML select element by its value attribute.
 *
 * @param page - the Playwright Page containing the select element
 * @param selectSelector - a CSS selector identifying the select element
 * @param value - the option value to select
 */
async function dropdownSelect(page: Page, selectSelector: string, value: string): Promise<void> {
  await page.selectOption(selectSelector, value);
}

/**
 * Retrieves all non-empty options from a native HTML select element as name/value pairs.
 *
 * @param page - the Playwright Page containing the select element
 * @param selector - a CSS selector identifying the select element
 * @returns an array of option objects with display text and value attribute
 */
async function dropdownElements(
  page: Page,
  selector: string,
): Promise<{ name: string; value: string }[]> {
  const optionSelector = `${selector} > option`;
  const options = await page.evaluate(sel => {
    const optionElements = document.querySelectorAll<HTMLOptionElement>(sel);
    return Array.from(optionElements)
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
