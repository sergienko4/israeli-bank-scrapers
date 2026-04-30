/**
 * Branch coverage for the disabled-attribute filter in `isTrulyVisible`.
 *
 * The filter rejects elements that have `disabled=""` or
 * `aria-disabled="true"` BEFORE the elementFromPoint hit-test. These
 * branches are reached on bank pages that render a disabled placeholder
 * button on top of a working anchor (Wix template pattern).
 */

import createElementMediator from '../../../../../Scrapers/Pipeline/Mediator/Elements/CreateElementMediator.js';
import type { ICallbackRecorder } from './CreateElementMediatorCallbacksHelpers.js';
import {
  makeInvokingLocator,
  makeMockElement,
  makePage,
} from './CreateElementMediatorCallbacksHelpers.js';

/** Type alias for the captured isTrulyVisible callback. */
type HitCallback = (e: Element, mockMode: boolean) => boolean;

describe('isTrulyVisible — disabled-attribute filter branches', () => {
  it('rejects element with disabled="" attribute and aria-disabled="true"', async () => {
    const rec: ICallbackRecorder = { callbacks: [] };
    const seed = makeMockElement({});
    const locator = makeInvokingLocator(seed, rec);
    const page = makePage(locator);
    const origDoc = (globalThis as { document?: Document }).document;
    (globalThis as { document: unknown }).document = {
      /**
       * Stub elementFromPoint for capture phase.
       * @returns Seed element so the call resolves cleanly.
       */
      elementFromPoint: (): Element => seed,
    };
    try {
      const m = createElementMediator(page);
      await m.resolveVisible([{ kind: 'textContent', value: 'x' }], 200);
      const hitCb = rec.callbacks.find(
        (c): c is HitCallback => typeof c === 'function' && String(c).includes('elementFromPoint'),
      );
      expect(hitCb).toBeDefined();
      if (hitCb) {
        const disabledEl = makeMockElement({ disabled: true });
        const didRunDisabled = hitCb(disabledEl, false);
        expect(didRunDisabled).toBe(false);
        const ariaDisabledEl = makeMockElement({ ariaDisabled: 'true' });
        const didRunAriaDisabled = hitCb(ariaDisabledEl, false);
        expect(didRunAriaDisabled).toBe(false);
      }
    } finally {
      if (origDoc) (globalThis as { document: unknown }).document = origDoc;
      else delete (globalThis as { document?: unknown }).document;
    }
  }, 5000);
});
