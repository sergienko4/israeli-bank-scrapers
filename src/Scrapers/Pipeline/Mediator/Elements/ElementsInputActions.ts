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
 *
 * <p>Wrapped in try/catch (not just `.catch`) because some contexts
 * (test mocks lacking `evaluate`, restricted cross-origin frames)
 * throw SYNCHRONOUSLY before the returned promise even forms — the
 * `.catch` on the chain would never see those. Failure is silent by
 * design: the Angular sync is opportunistic, not load-bearing.
 *
 * @param ctx - Page or Frame to inject into.
 * @returns True after injection (or silent noop on unsupported ctx).
 */
async function ensureAngularHelper(ctx: Page | Frame): Promise<boolean> {
  try {
    await ctx.evaluate(ANGULAR_HELPER_SCRIPT);
  } catch {
    // Unsupported context (mock without evaluate, restricted frame, etc.).
  }
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
  selector: string,
  value: string,
): Promise<boolean> {
  try {
    await ctx
      .locator(selector)
      .first()
      .evaluate((el: Element, val: string): boolean => {
        const w = globalThis as unknown as Record<string, unknown>;
        const fn = w.__PIPELINE_NG_SYNC__ as ((e: Element, v: string) => boolean) | undefined;
        if (fn) fn(el, val);
        return true;
      }, value);
  } catch {
    // Locator-chain or evaluate threw synchronously (mock ctx, missing
    // method, restricted frame). Sync is opportunistic — safe to noop.
  }
  return true;
}

/**
 * Browser-context fallback: set DOM value + fire input/change/blur events.
 * Self-contained — Playwright serializes ONLY this function.
 * @param el - DOM input element (passed by locator.evaluate).
 * @param val - Value to set.
 * @returns True after events dispatched.
 */
function setValueAndFireEvents(el: Element, val: string): boolean {
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
 * Count sibling inputs under the same parent — PIN-buffer clusters have >1.
 * @param el - The target input element.
 * @returns Number of input siblings (1 for regular, >1 for PIN-buffer).
 */
function countSiblingInputs(el: Element): number {
  return el.parentElement?.querySelectorAll('input').length ?? 1;
}

/**
 * Safely count sibling inputs — catches mock/detached element errors.
 * @param locator - Playwright locator.
 * @returns Sibling count (defaults to 1 on error).
 */
async function safeSiblingCount(locator: ReturnType<Page['locator']>): Promise<number> {
  try {
    const count = await locator.evaluate(countSiblingInputs);
    const isValid = typeof count === 'number' && count > 0;
    return (isValid && count) || 1;
  } catch {
    return 1;
  }
}

/**
 * Fill a form input via mediator — Playwright .fill() with DOM+Angular fallback.
 * PIN-buffer detection: if .fill() succeeds but input has sibling inputs,
 * clear and fall through to pressSequentially (fires keypress for auto-advance).
 *
 * <p>Single-input success path also runs the AngularJS sync helper. Playwright's
 * `.fill()` dispatches the native `input` event, which is enough for React /
 * Vue / native forms — but AngularJS 1.x's `ng-model` directive needs
 * `$setViewValue` + `$apply` to update the bound `$scope` field. Without that,
 * a subsequent `ng-click` submit handler reads an empty `$scope` and rejects
 * the form even though the DOM value is populated. The helper is idempotent
 * for non-Angular pages (returns early when `window.angular` is undefined).
 * Live evidence: Isracard CI run `25727925437` — `#otpLoginPwd` filled, DOM
 * value set, but `ng-pristine ng-untouched ng-invalid-required` classes
 * persisted across the click → `vm.ResendNewLogin('password','login')` saw
 * empty `$scope.password` → no navigation → LOGIN.POST detected scope-intact
 * → retry found form gone → 0 fields filled → reveal-missing downstream.
 *
 * @param ctx - Page or Frame.
 * @param selector - Input selector.
 * @param value - Value to fill.
 * @returns True after fill.
 */
async function deepFillInput(ctx: Page | Frame, selector: string, value: string): Promise<boolean> {
  LOG.debug({ field: maskVisibleText(selector), result: 'FOUND' });
  await humanDelay(FILL_INPUT_DELAY_MIN_MS, FILL_INPUT_DELAY_MAX_MS);
  const locator = ctx.locator(selector).first();
  const didFill = await locator
    .fill(value, { timeout: FILL_ATTEMPT_TIMEOUT_MS })
    .then((): boolean => true)
    .catch((): false => false);
  const siblings = didFill && (await safeSiblingCount(locator));
  const isSingleInput = didFill && typeof siblings === 'number' && siblings <= 1;
  if (isSingleInput) {
    await ensureAngularHelper(ctx);
    return syncAngularModel(ctx, selector, value);
  }
  if (didFill)
    await locator.fill('', { timeout: FILL_ATTEMPT_TIMEOUT_MS }).catch((): false => false);
  // Fallback: DOM events + Angular Injected Helper
  const isPinBuffer = didFill && typeof siblings === 'number' && siblings > 1;
  await locator.focus().catch((): false => false);
  const seqOpts = { delay: PRESS_SEQUENTIALLY_DELAY_MS };
  await locator.pressSequentially(value, seqOpts).catch((): false => false);
  if (isPinBuffer) {
    LOG.trace({
      message: 'PIN-buffer: skipping DOM/Model overwrite to preserve distributed state',
    });
    return true;
  }
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
  inputSelector: string,
  inputValue: string,
): Promise<boolean> {
  await pageOrFrame
    .locator(inputSelector)
    .first()
    .evaluate((input: Element, val: string): boolean => {
      (input as HTMLInputElement).value = val;
      return true;
    }, inputValue);
  return true;
}

export { deepFillInput, deepFillInput as fillInput, setValue };
