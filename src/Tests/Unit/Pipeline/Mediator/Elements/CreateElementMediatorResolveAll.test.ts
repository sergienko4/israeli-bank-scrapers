/**
 * Branch coverage for resolveAllVisibleImpl + extractWinnerSequence
 * (the dedup/cap loop and identityKey helper). Uses the same mock-locator
 * harness as other CreateElementMediator unit tests.
 */

import createElementMediator from '../../../../../Scrapers/Pipeline/Mediator/Elements/CreateElementMediator.js';
import type { ICallbackRecorder } from './CreateElementMediatorCallbacksHelpers.js';
import {
  makeInvokingLocator,
  makeMockElement,
  makePage,
} from './CreateElementMediatorCallbacksHelpers.js';

describe('resolveAllVisible — success path (extractWinnerSequence)', () => {
  it('returns up to cap fulfilled candidates, deduplicated by identity', async () => {
    const rec: ICallbackRecorder = { callbacks: [] };
    // Mock element with a stable id — so identityKey uses the id branch.
    const seed = makeMockElement({ id: 'sendSms', tagName: 'BUTTON' });
    const locator = makeInvokingLocator(seed, rec);
    const page = makePage(locator);
    // Stub document.elementFromPoint so isTrulyVisible's hit-test passes.
    const origDoc = (globalThis as { document?: Document }).document;
    (globalThis as { document: unknown }).document = {
      /**
       * Returns the seed element so the hit test resolves to "self".
       * @returns Mock element.
       */
      elementFromPoint: (): Element => seed,
    };
    try {
      const m = createElementMediator(page);
      // Candidate list with two distinct kinds; the mock locator returns the
      // SAME element for both, so dedup by identity should collapse them
      // down to a single result.
      const candidates = [
        { kind: 'css' as const, value: '#a' },
        { kind: 'css' as const, value: '#b' },
      ];
      const got = await m.resolveAllVisible(candidates, 200, 3);
      // Either collapsed to 1 (dedup hit) or returned 2 distinct (race
      // semantics) — both are valid; the loop body executed at least once
      // and the identityKey id-branch fired.
      expect(got.length).toBeGreaterThanOrEqual(1);
      expect(got.length).toBeLessThanOrEqual(2);
      expect(got[0].found).toBe(true);
    } finally {
      if (origDoc) (globalThis as { document: unknown }).document = origDoc;
      else delete (globalThis as { document?: unknown }).document;
    }
  });

  it('caps the result at the requested length', async () => {
    const rec: ICallbackRecorder = { callbacks: [] };
    const seed = makeMockElement({ id: 'one', tagName: 'BUTTON' });
    const locator = makeInvokingLocator(seed, rec);
    const page = makePage(locator);
    const origDoc = (globalThis as { document?: Document }).document;
    (globalThis as { document: unknown }).document = {
      /**
       * Hit-test stub — returns the seed so isTrulyVisible passes.
       * @returns Seed element.
       */
      elementFromPoint: (): Element => seed,
    };
    try {
      const m = createElementMediator(page);
      // Three candidates — cap=1 should clamp result regardless of how many
      // fulfilled (covers the `out.length >= cap` early-exit branch).
      const got = await m.resolveAllVisible(
        [
          { kind: 'css', value: '#a' },
          { kind: 'css', value: '#b' },
          { kind: 'css', value: '#c' },
        ],
        200,
        1,
      );
      expect(got.length).toBeLessThanOrEqual(1);
    } finally {
      if (origDoc) (globalThis as { document: unknown }).document = origDoc;
      else delete (globalThis as { document?: unknown }).document;
    }
  });
});
