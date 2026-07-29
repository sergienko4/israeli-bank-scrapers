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
 */

import { clickElementImpl } from '../../../../../Scrapers/Pipeline/Mediator/Elements/ActionExecutors.js';
import { makeFrame, makeLocator } from './ActionExecutorsHelpers.js';

/**
 * Rejection mimicking Playwright's pointer-interception timeout.
 * @returns A promise that always rejects.
 */
const INTERCEPTED = (): Promise<never> =>
  Promise.reject(new Error('locator.click: Timeout 15000ms exceeded'));

describe('clickNaturalPath — intercepted-click fallback', () => {
  it('falls back to the JS tier when the natural click is intercepted', async () => {
    const locator = makeLocator({ click: INTERCEPTED });
    const frame = makeFrame(locator);
    const isOk = await clickElementImpl({ frame, selector: '#layout-header' });
    expect(isOk).toBe(true);
  });

  it('still resolves when both the natural click and the JS tier fail', async () => {
    /**
     * Stub evaluate that also fails, forcing the last-resort tier.
     * @returns A promise that always rejects.
     */
    const failingEvaluate = (): Promise<never> => Promise.reject(new Error('evaluate timeout'));
    const locator = makeLocator({ click: INTERCEPTED, evaluate: failingEvaluate });
    const frame = makeFrame(locator);
    const isOk = await clickElementImpl({ frame, selector: '[aria-label="Close popup"]' });
    expect(isOk).toBe(true);
  });

  it('leaves the happy path untouched when the natural click succeeds', async () => {
    const locator = makeLocator();
    const frame = makeFrame(locator);
    const isOk = await clickElementImpl({ frame, selector: '#ok' });
    expect(isOk).toBe(true);
  });
});
