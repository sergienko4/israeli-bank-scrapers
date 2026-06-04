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
 * Browser-side callback for `syncAngularModel` — invokes the previously
 * injected `window.__PIPELINE_NG_SYNC__` helper on the resolved element.
 * Self-contained (no captured closures) — Playwright serializes the
 * function source for transport.
 * @param el - DOM element passed by locator.evaluate.
 * @param val - Value to sync into the Angular ng-model controller.
 * @returns Always `true`.
 */
function browserCallNgSync(el: Element, val: string): boolean {
  const w = globalThis as unknown as Record<string, unknown>;
  const fn = w.__PIPELINE_NG_SYNC__ as ((e: Element, v: string) => boolean) | undefined;
  if (fn) fn(el, val);
  return true;
}

/**
 * Best-effort attempt at the AngularJS sync — swallows any locator/eval
 * exception (opportunistic helper, never the source of truth).
 * @param ctx - Page or Frame.
 * @param selector - Playwright selector.
 * @param value - Value to sync.
 * @returns Resolves regardless of inner failure.
 */
async function tryAngularSync(ctx: Page | Frame, selector: string, value: string): Promise<void> {
  try {
    await ctx.locator(selector).first().evaluate(browserCallNgSync, value);
  } catch {
    // Locator-chain or evaluate threw synchronously — opportunistic noop.
  }
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
  await tryAngularSync(ctx, selector, value);
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
 * Tier-1 strict fill attempt — Playwright `.fill()` with native input event
 * dispatch. Returns boolean so callers don't have to handle the rejection.
 * @param locator - Bound input locator (`.first()` already applied).
 * @param value - Value to fill.
 * @returns True iff `.fill()` resolved before the timeout.
 */
async function attemptFillStrict(
  locator: ReturnType<Page['locator']>,
  value: string,
): Promise<boolean> {
  return locator
    .fill(value, { timeout: FILL_ATTEMPT_TIMEOUT_MS })
    .then((): true => true)
    .catch((): false => false);
}

/**
 * Inject the AngularJS helper into the page, then call it on the resolved
 * element. The two steps are paired so callers express intent as one path.
 * @param ctx - Page or Frame.
 * @param selector - Playwright selector for the input.
 * @param value - Value to sync into ng-model.
 * @returns Result of `syncAngularModel`.
 */
async function runAngularSyncPath(
  ctx: Page | Frame,
  selector: string,
  value: string,
): Promise<boolean> {
  await ensureAngularHelper(ctx);
  return syncAngularModel(ctx, selector, value);
}

/** Bundled args for `clearAndPressSequentially` / fallback path — fits 3-param ceiling. */
interface IPressSeqArgs {
  readonly ctx: Page | Frame;
  readonly locator: ReturnType<Page['locator']>;
  readonly selector: string;
  readonly value: string;
  readonly didFill: boolean;
  readonly isPinBuffer: boolean;
}

/**
 * Clear-on-success (if `didFill`) then focus + pressSequentially the value
 * char-by-char. Re-firing as keypresses triggers `keydown`/`keyup` handlers
 * that auto-advance to the next PIN-buffer input.
 * @param args - Bundled press-sequentially args.
 * @returns Resolves after pressSequentially completes (failures swallowed).
 */
async function clearAndPressSequentially(args: IPressSeqArgs): Promise<void> {
  if (args.didFill) {
    await args.locator.fill('', { timeout: FILL_ATTEMPT_TIMEOUT_MS }).catch((): false => false);
  }
  await args.locator.focus().catch((): false => false);
  const seqOpts = { delay: PRESS_SEQUENTIALLY_DELAY_MS };
  await args.locator.pressSequentially(args.value, seqOpts).catch((): false => false);
}

/**
 * Final DOM-events + AngularJS-sync pass for non-PIN-buffer fallback flows.
 * Mutates the input value directly and dispatches input/change/blur events.
 * @param args - Bundled press-sequentially args (reused for the suffix path).
 * @returns Result of `runAngularSyncPath`.
 */
async function finalizeWithDomEvents(args: IPressSeqArgs): Promise<boolean> {
  await args.locator.evaluate(setValueAndFireEvents, args.value);
  return runAngularSyncPath(args.ctx, args.selector, args.value);
}

/**
 * Fallback path entry: pressSequentially → either PIN-buffer short-circuit
 * (preserves distributed state) or DOM events + AngularJS sync.
 * @param args - Bundled press-sequentially args.
 * @returns True after fallback completes.
 */
async function runPressSequentiallyPath(args: IPressSeqArgs): Promise<boolean> {
  await clearAndPressSequentially(args);
  if (args.isPinBuffer) {
    LOG.trace({
      message: 'PIN-buffer: skipping DOM/Model overwrite to preserve distributed state',
    });
    return true;
  }
  return finalizeWithDomEvents(args);
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
  const didFill = await attemptFillStrict(locator, value);
  const siblings = didFill ? await safeSiblingCount(locator) : 0;
  if (didFill && siblings <= 1) return runAngularSyncPath(ctx, selector, value);
  const isPinBuffer = didFill && siblings > 1;
  return runPressSequentiallyPath({ ctx, locator, selector, value, didFill, isPinBuffer });
}

/**
 * Browser-side: assign the value directly without firing events.
 * Self-contained — Playwright serializes ONLY this function.
 * @param input - DOM input element handed in by `locator.evaluate`.
 * @param val - Value to assign to `input.value`.
 * @returns True after assignment.
 */
function assignValueInBrowser(input: Element, val: string): boolean {
  (input as HTMLInputElement).value = val;
  return true;
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
  const locator = pageOrFrame.locator(inputSelector).first();
  await locator.evaluate(assignValueInBrowser, inputValue);
  return true;
}

export { deepFillInput, deepFillInput as fillInput, setValue };
