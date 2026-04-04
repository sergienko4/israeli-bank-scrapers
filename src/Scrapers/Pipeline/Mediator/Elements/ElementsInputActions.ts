/**
 * Low-level input fill — single strategy via mediator pattern.
 * Primary: Playwright .fill() (types char-by-char, triggers native events).
 * Fallback: DOM value + events + AngularJS Injected Helper.
 */

import { type Frame, type Page } from 'playwright-core';

import { getDebug as createLogger } from '../../Types/Debug.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import { humanDelay } from '../Timing/Waiting.js';
import {
  FILL_ATTEMPT_TIMEOUT_MS,
  FILL_INPUT_DELAY_MAX_MS,
  FILL_INPUT_DELAY_MIN_MS,
  PRESS_SEQUENTIALLY_DELAY_MS,
} from './ElementsInteractionConfig.js';

const LOG = createLogger('elements');

type SelectorStr = string;
type InputValue = string;
type OpResult = boolean;

/**
 * AngularJS Injected Helper — defined as string, injected into page context.
 * Playwright evaluate() with strings runs at page level (no element injection).
 * The helper is called via element.evaluate((el,val) => window.__fn__(el,val)).
 */
const ANGULAR_HELPER_SCRIPT = [
  'window.__PIPELINE_NG_SYNC__ = function(el, val) {',
  '  var ng = window.angular;',
  '  if (!ng) return;',
  '  try {',
  '    var ngEl = ng.element(el);',
  '    var ctrl = ngEl.controller("ngModel");',
  '    if (!ctrl || typeof ctrl.$setViewValue !== "function") return;',
  '    ctrl.$setViewValue(val);',
  '    if (typeof ctrl.$commitViewValue === "function") ctrl.$commitViewValue();',
  '    var s = ngEl.scope();',
  '    if (s && typeof s.$apply === "function") s.$apply();',
  '  } catch(e) {}',
  '};',
].join('');

/**
 * Inject the AngularJS sync helper into the page/frame context.
 * Idempotent — safe to call multiple times (overwrites same global).
 * @param ctx - Page or Frame to inject into.
 * @returns True after injection.
 */
async function ensureAngularHelper(ctx: Page | Frame): Promise<OpResult> {
  await ctx.evaluate(ANGULAR_HELPER_SCRIPT).catch((): false => false);
  return true;
}

/**
 * Call the injected AngularJS helper on a specific element.
 * The element IS passed because we use a function reference (not string).
 * @param ctx - Page or Frame.
 * @param selector - Playwright selector.
 * @param value - Value to sync.
 * @returns True after sync attempt.
 */
async function syncAngularModel(
  ctx: Page | Frame,
  selector: SelectorStr,
  value: InputValue,
): Promise<OpResult> {
  await ctx
    .locator(selector)
    .first()
    .evaluate((el: Element, val: string): OpResult => {
      const w = window as unknown as Record<string, unknown>;
      const fn = w.__PIPELINE_NG_SYNC__ as ((e: Element, v: string) => boolean) | undefined;
      if (fn) fn(el, val);
      return true;
    }, value)
    .catch((): false => false);
  return true;
}

/**
 * Browser-context fallback: set DOM value + fire input/change/blur events.
 * Self-contained — Playwright serializes ONLY this function.
 * @param el - DOM input element (passed by locator.evaluate).
 * @param val - Value to set.
 * @returns True after events dispatched.
 */
function setValueAndFireEvents(el: Element, val: InputValue): OpResult {
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
 * Fill a form input via mediator — Playwright .fill() with DOM+Angular fallback.
 * Step 1: Try Playwright .fill() — types char-by-char, triggers ALL native events.
 * Step 2: If .fill() times out — DOM events + AngularJS Injected Helper.
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
  LOG.debug({ event: 'login-fill', field: maskVisibleText(selector), result: 'FOUND' });
  await humanDelay(FILL_INPUT_DELAY_MIN_MS, FILL_INPUT_DELAY_MAX_MS);
  const locator = ctx.locator(selector).first();
  const didFill = await locator
    .fill(value, { timeout: FILL_ATTEMPT_TIMEOUT_MS })
    .then((): OpResult => true)
    .catch((): false => false);
  if (didFill) return true;
  // Fallback: DOM events + Angular Injected Helper
  await locator.focus().catch((): false => false);
  const seqOpts = { delay: PRESS_SEQUENTIALLY_DELAY_MS };
  await locator.pressSequentially(value, seqOpts).catch((): false => false);
  await locator.evaluate(setValueAndFireEvents, value);
  await ensureAngularHelper(ctx);
  return syncAngularModel(ctx, selector, value);
}

/**
 * Set a form input value directly via DOM evaluation (no events).
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

export { deepFillInput, deepFillInput as fillInput, setValue };
