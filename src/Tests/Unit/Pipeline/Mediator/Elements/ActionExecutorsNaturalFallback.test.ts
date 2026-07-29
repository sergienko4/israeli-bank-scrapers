/**
 * Natural-click resilience — an intercepted click must degrade to the
 * JS-evaluate tier instead of dying on the 15s actionability timeout.
 *
 * Evidence (Docker E2E-real, 2026-07-29, Max): the resolver legitimately
 * falls back to a merely-visible winner when EVERY candidate fails the
 * elementFromPoint hit-test (documented "cookie-banner parity" in
 * `Create/Hittest.ts#resolveWinner`). HOME survives that because it clicks
 * via `clickForceCascade`; PRE-LOGIN used `clickNaturalPath`, whose body
 * had only Tier 1 despite its JSDoc promising "Tier 1 → Tier 3". An
 * occluded winner therefore burned ELEMENTS_CLICK_TIMEOUT_MS and threw:
 *
 *   locator.click: Timeout 15000ms exceeded
 *     <div class="cdk-overlay-backdrop …> intercepts pointer events
 *
 * This suite pins the promised cascade so the natural path degrades like
 * the force path instead of failing the phase on interception alone.
 *
 * <p>Each test counts per-tier invocations rather than asserting only on
 * the boolean result: `clickElementImpl` returns `true` from the
 * last-resort tier by contract, so a bare `isOk` assertion would still
 * pass if a tier were skipped entirely.
 */

import { clickElementImpl } from '../../../../../Scrapers/Pipeline/Mediator/Elements/ActionExecutors.js';
import { makeFrame, makeLocator } from './ActionExecutorsHelpers.js';

/**
 * Rejection mimicking Playwright's pointer-interception timeout.
 * @returns A promise that always rejects.
 */
const INTERCEPTED = (): Promise<never> =>
  Promise.reject(new Error('locator.click: Timeout 15000ms exceeded'));

/**
 * Visible-text locator for Max's personal-area entry point — the control
 * whose click the CDK backdrop swallowed in the field evidence above.
 * Interaction code addresses elements by what the user can read, never by
 * structural CSS.
 */
const TEXT_TARGET = 'text=כניסה לאיזור האישי';

/**
 * Semantic aria-label target. Tier 4 parses `[aria-label="…"]` out of the
 * selector by contract (see `clickViaAriaLabel`), so exercising that tier
 * requires this accessible-name form — it is the semantic locator the
 * guidelines prefer, not a structural CSS selector.
 */
const ARIA_TARGET = '[aria-label="סגירה"]';

/** Per-tier invocation counters for one cascade run. */
interface ITierCalls {
  click: number;
  evaluate: number;
  frameEvaluate: number;
}

/** Stand-in DOM snapshot returned to `captureClickForensics`. */
const FORENSICS_SNAPSHOT = { tag: 'DIV', id: '', classes: '', text: '', outerHtml: '' };

/**
 * Build a locator/frame pair that tallies which tiers actually execute.
 * @param script - Whether the natural click and/or the JS tier reject.
 * @param script.clickFails - Natural click (Tier 1) rejects.
 * @param script.evaluateFails - JS evaluate (Tier 3) rejects.
 * @returns The counters plus the frame under test.
 */
function makeCountingFrame(script: { clickFails: boolean; evaluateFails: boolean }): {
  calls: ITierCalls;
  frame: ReturnType<typeof makeFrame>;
} {
  const calls: ITierCalls = { click: 0, evaluate: 0, frameEvaluate: 0 };
  const locator = makeLocator({
    /**
     * Tier 1 — natural click.
     * @returns Resolved or rejected per script.
     */
    click: (): Promise<boolean> => {
      calls.click += 1;
      return script.clickFails ? INTERCEPTED() : Promise.resolve(true);
    },
    /**
     * Tier 3 — JS evaluate.
     *
     * <p>`captureClickForensics` also calls `locator.evaluate`, so the two
     * are told apart by their second argument: forensics passes
     * `CLICK_OUTER_HTML_MAX` (a number), the click tier passes `null`.
     * @param _fn - Browser-side function (unused by the stub).
     * @param arg - Second evaluate argument; `null` marks the click tier.
     * @returns Resolved or rejected per script.
     */
    evaluate: (_fn: unknown, arg?: unknown): Promise<unknown> => {
      const isClickTier = arg === null;
      if (!isClickTier) return Promise.resolve(FORENSICS_SNAPSHOT);
      calls.evaluate += 1;
      if (script.evaluateFails) return Promise.reject(new Error('evaluate timeout'));
      return Promise.resolve(true);
    },
  });
  const frame = makeFrame(locator);
  /**
   * Tier 4 — direct DOM query by accessible name.
   * @returns Resolved true.
   */
  frame.evaluate = (): Promise<boolean> => {
    calls.frameEvaluate += 1;
    return Promise.resolve(true);
  };
  return { calls, frame };
}

describe('clickNaturalPath — intercepted-click fallback', () => {
  it('falls back to the JS tier when the natural click is intercepted', async () => {
    const { calls, frame } = makeCountingFrame({ clickFails: true, evaluateFails: false });
    const isOk = await clickElementImpl({ frame, selector: TEXT_TARGET });
    expect(isOk).toBe(true);
    expect(calls.click).toBe(1);
    expect(calls.evaluate).toBe(1);
    expect(calls.frameEvaluate).toBe(0);
  });

  it('reaches the last-resort tier when the natural click and JS tier fail', async () => {
    const { calls, frame } = makeCountingFrame({ clickFails: true, evaluateFails: true });
    const isOk = await clickElementImpl({ frame, selector: ARIA_TARGET });
    expect(isOk).toBe(true);
    expect(calls.click).toBe(1);
    expect(calls.evaluate).toBe(1);
    expect(calls.frameEvaluate).toBe(1);
  });

  it('leaves the happy path untouched when the natural click succeeds', async () => {
    const { calls, frame } = makeCountingFrame({ clickFails: false, evaluateFails: false });
    const isOk = await clickElementImpl({ frame, selector: TEXT_TARGET });
    expect(isOk).toBe(true);
    expect(calls.click).toBe(1);
    expect(calls.evaluate).toBe(0);
    expect(calls.frameEvaluate).toBe(0);
  });
});
