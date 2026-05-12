/**
 * Unit tests for ElementsInputActions — deepFillInput + setValue paths.
 */

import type { Locator, Page } from 'playwright-core';

import {
  deepFillInput,
  fillInput,
  setValue,
} from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementsInputActions.js';

/** Behaviour toggles for the mock locator. */
interface ILocScript {
  fillOk: boolean;
  siblingCount: number;
  pressOk: boolean;
  evaluateOk: boolean;
}

/**
 * Build a mock Locator with scripted fill/pressSequentially/evaluate.
 * @param script - Behaviour.
 * @returns Mock Locator.
 */
function makeLocator(script: ILocScript): Locator {
  /** Counter for tracking evaluate calls. */
  let evalCount = 0;
  const self = {
    /**
     * First.
     * @returns Self.
     */
    first: (): Locator => self as unknown as Locator,
    /**
     * Fill.
     * @returns Script-controlled fill.
     */
    fill: (): Promise<boolean> => {
      if (script.fillOk) return Promise.resolve(true);
      return Promise.reject(new Error('fill fail'));
    },
    /**
     * Focus.
     * @returns Resolved.
     */
    focus: (): Promise<boolean> => Promise.resolve(true),
    /**
     * pressSequentially.
     * @returns Script-controlled press.
     */
    pressSequentially: (): Promise<boolean> => {
      if (script.pressOk) return Promise.resolve(true);
      return Promise.reject(new Error('press fail'));
    },
    /**
     * evaluate — returns sibling count on first call, then void.
     * @returns Sibling count or resolved value.
     */
    evaluate: (): Promise<number | boolean> => {
      evalCount += 1;
      if (evalCount === 1) return Promise.resolve(script.siblingCount);
      if (!script.evaluateOk) return Promise.reject(new Error('evaluate fail'));
      return Promise.resolve(true);
    },
  };
  return self as unknown as Locator;
}

/**
 * Build a mock Page that returns the provided locator and resolves evaluate.
 * @param loc - Locator to return.
 * @returns Mock Page (callable evaluate also counts so tests can assert the
 *   Angular helper injection fires once per fill).
 */
function makePage(loc: Locator): Page {
  return {
    /**
     * locator.
     * @returns Mock locator.
     */
    locator: (): Locator => loc,
    /**
     * evaluate.
     * @returns Resolved.
     */
    evaluate: (): Promise<boolean> => Promise.resolve(true),
  } as unknown as Page;
}

/** Captures evaluate invocations so tests can assert Angular sync ran. */
interface ITrackedEvaluations {
  pageEvaluateCount: number;
  locatorEvaluateCount: number;
}

/**
 * Build a counting Page + Locator pair. Tests on the single-input success
 * path use this to assert that `ensureAngularHelper(ctx)` (which calls
 * `ctx.evaluate(SCRIPT)`) AND `syncAngularModel(ctx, sel, val)` (which calls
 * `ctx.locator(sel).first().evaluate(cb, val)`) BOTH fire — the live signal
 * Isracard CI run `25727925437` was missing.
 *
 * @param script - Behaviour toggles.
 * @param tracker - Mutable counter object the caller inspects.
 * @returns Page wired up with the counting locator.
 */
function makeCountingPage(script: ILocScript, tracker: ITrackedEvaluations): Page {
  /** Locator-evaluate hits. */
  let locatorEvalCount = 0;
  const self = {
    /**
     * First.
     * @returns Self.
     */
    first: (): Locator => self as unknown as Locator,
    /**
     * Fill.
     * @returns Script-controlled fill.
     */
    fill: (): Promise<boolean> => {
      if (script.fillOk) return Promise.resolve(true);
      return Promise.reject(new Error('fill fail'));
    },
    /**
     * Focus.
     * @returns Resolved.
     */
    focus: (): Promise<boolean> => Promise.resolve(true),
    /**
     * pressSequentially.
     * @returns Resolved.
     */
    pressSequentially: (): Promise<boolean> => Promise.resolve(true),
    /**
     * Evaluate — first call serves the sibling-count check, subsequent
     * calls (Angular sync helper invocation) are counted.
     * @returns Sibling count or true.
     */
    evaluate: (): Promise<number | boolean> => {
      locatorEvalCount += 1;
      tracker.locatorEvaluateCount = locatorEvalCount;
      if (locatorEvalCount === 1) return Promise.resolve(script.siblingCount);
      return Promise.resolve(true);
    },
  };
  const loc = self as unknown as Locator;
  return {
    /**
     * locator.
     * @returns The shared counting locator.
     */
    locator: (): Locator => loc,
    /**
     * evaluate — counts so tests can verify Angular helper injection fired.
     * @returns Resolved.
     */
    evaluate: (): Promise<boolean> => {
      tracker.pageEvaluateCount += 1;
      return Promise.resolve(true);
    },
  } as unknown as Page;
}

describe('deepFillInput', () => {
  it('returns true after Playwright .fill() success with single sibling', async () => {
    const loc = makeLocator({ fillOk: true, siblingCount: 1, pressOk: true, evaluateOk: true });
    const page = makePage(loc);
    const isOk = await deepFillInput(page, '#u', 'val');
    expect(isOk).toBe(true);
  });

  it('falls through to fallback when .fill() times out', async () => {
    const loc = makeLocator({ fillOk: false, siblingCount: 1, pressOk: true, evaluateOk: true });
    const page = makePage(loc);
    const isOk = await deepFillInput(page, '#u', 'v');
    expect(isOk).toBe(true);
  });

  it('PIN-buffer detection: skips DOM/Angular overwrite when siblings > 1', async () => {
    const loc = makeLocator({ fillOk: true, siblingCount: 4, pressOk: true, evaluateOk: true });
    const page = makePage(loc);
    const isOk = await deepFillInput(page, '#pin', '1234');
    expect(isOk).toBe(true);
  });

  it('handles pressSequentially failures silently', async () => {
    const loc = makeLocator({ fillOk: false, siblingCount: 1, pressOk: false, evaluateOk: true });
    const page = makePage(loc);
    const isOk = await deepFillInput(page, '#u', 'v');
    expect(isOk).toBe(true);
  });

  it('fillInput alias behaves identically to deepFillInput', async () => {
    const loc = makeLocator({ fillOk: true, siblingCount: 1, pressOk: true, evaluateOk: true });
    const page = makePage(loc);
    const isOk = await fillInput(page, '#u', 'v');
    expect(isOk).toBe(true);
  });

  it('ISRA-CI-LOGIN-001 — single-input success path injects Angular sync helper', async () => {
    // Live CI signal: Isracard run `25727925437` filled #otpLoginPwd via
    // Playwright .fill() but the Angular form rejected the subsequent
    // submit because `$scope.password` was empty (`ng-pristine
    // ng-untouched ng-invalid-required` classes persisted). The fix:
    // on the single-input success path, run `ensureAngularHelper(ctx)`
    // (page.evaluate injects the helper) + `syncAngularModel` (locator
    // .evaluate invokes the helper on the element). For non-Angular
    // banks the helper is a noop (returns early on `!window.angular`),
    // so the change is regression-safe.
    const tracker: ITrackedEvaluations = { pageEvaluateCount: 0, locatorEvaluateCount: 0 };
    const page = makeCountingPage(
      { fillOk: true, siblingCount: 1, pressOk: true, evaluateOk: true },
      tracker,
    );
    const isOk = await deepFillInput(page, '#otpLoginPwd', 'super-secret');
    expect(isOk).toBe(true);
    // ensureAngularHelper injects the script via page.evaluate exactly once
    // for the single-input success branch.
    expect(tracker.pageEvaluateCount).toBe(1);
    // locator.evaluate fires twice: once for sibling-count check, once for
    // the Angular sync (window.__PIPELINE_NG_SYNC__ invocation).
    expect(tracker.locatorEvaluateCount).toBe(2);
  });
});

describe('setValue', () => {
  it('calls locator.evaluate to set value and returns true', async () => {
    const loc = makeLocator({ fillOk: true, siblingCount: 1, pressOk: true, evaluateOk: true });
    const page = makePage(loc);
    const isOk = await setValue(page, '#u', 'raw');
    expect(isOk).toBe(true);
  });
});
