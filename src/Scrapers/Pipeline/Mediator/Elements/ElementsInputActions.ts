/**
 * Low-level input fill helpers — fillInput, setValue, angularModelFill.
 * Extracted from ElementsInteractions.ts to respect max-lines.
 */

import { type Frame, type Page } from 'playwright-core';

import { getDebug as createLogger } from '../../Types/Debug.js';
import { humanDelay } from '../Timing/Waiting.js';
import { FILL_INPUT_DELAY_MAX_MS, FILL_INPUT_DELAY_MIN_MS } from './ElementsInteractionConfig.js';

const LOG = createLogger('elements');

type SelectorStr = string;
type InputValue = string;
type OpResult = boolean;

/**
 * Fill a form input with human-like delay.
 * @param pageOrFrame - Page or frame.
 * @param inputSelector - CSS selector for input.
 * @param inputValue - Value to fill.
 * @returns True after fill.
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
 * @param pageOrFrame - Page or frame.
 * @param inputSelector - CSS selector.
 * @param inputValue - Value to set.
 * @returns True after set.
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
 * Swallow evaluate failures.
 * @returns False.
 */
const CATCH_FALSE = (): OpResult => false;

/**
 * Check for data-uw-hidden-control attribute (UserWay).
 * @param ctx - Page or Frame.
 * @param selector - Element selector.
 * @returns True if hidden-control attribute present.
 */
async function isHiddenControlElement(ctx: Page | Frame, selector: SelectorStr): Promise<OpResult> {
  return ctx
    .locator(selector)
    .first()
    .evaluate((el: Element): OpResult => el.hasAttribute('data-uw-hidden-control'))
    .catch(CATCH_FALSE);
}

/**
 * Browser-context: set input value and dispatch AngularJS events.
 * Self-contained — all logic inline for Playwright evaluate() serialization.
 * Works on ALL browsers (Chrome, Firefox, Camoufox).
 * @param el - DOM input element.
 * @param val - Value to set.
 * @returns True after events dispatched.
 */
function dispatchAngularEvents(el: Element, val: InputValue): OpResult {
  (el as HTMLInputElement).value = val;
  const inputEvt = Reflect.construct(Event, ['input', { bubbles: true }]);
  el.dispatchEvent(inputEvt);
  const changeEvt = Reflect.construct(Event, ['change', { bubbles: false }]);
  el.dispatchEvent(changeEvt);
  const blurEvt = Reflect.construct(Event, ['blur', { bubbles: false }]);
  el.dispatchEvent(blurEvt);
  return true;
}

/**
 * Fill via DOM + AngularJS-compatible event dispatch.
 * @param ctx - Page or Frame.
 * @param selector - Input selector.
 * @param value - Value to set.
 * @returns True after fill + events.
 */
async function angularModelFill(
  ctx: Page | Frame,
  selector: SelectorStr,
  value: InputValue,
): Promise<OpResult> {
  await humanDelay(FILL_INPUT_DELAY_MIN_MS, FILL_INPUT_DELAY_MAX_MS);
  return ctx.locator(selector).first().evaluate(dispatchAngularEvents, value);
}

/**
 * Fill a form input — auto-detects UserWay hidden-control elements.
 * @param ctx - Page or Frame.
 * @param selector - Input selector.
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

export { deepFillInput, fillInput, setValue };
