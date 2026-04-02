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

/** AngularJS event descriptors: [name, bubbles]. */
const ANGULAR_EVENTS: readonly [string, boolean][] = [
  ['input', true],
  ['change', false],
  ['blur', false],
];

/**
 * Dispatch a list of events on an element.
 * @param el - Target DOM element.
 * @param events - Array of [name, bubbles] tuples.
 * @returns True after all events dispatched.
 */
function dispatchEvents(el: Element, events: readonly [string, boolean][]): OpResult {
  for (const [name, isBubbling] of events) {
    const evt: Event = Reflect.construct(Event, [name, { bubbles: isBubbling }]);
    el.dispatchEvent(evt);
  }
  return true;
}

/**
 * Browser-context: set input value and dispatch AngularJS events.
 * @param el - DOM input element.
 * @param val - Value to set.
 * @returns True after events dispatched.
 */
function dispatchAngularEvents(el: Element, val: InputValue): OpResult {
  (el as HTMLInputElement).value = val;
  return dispatchEvents(el, ANGULAR_EVENTS);
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
