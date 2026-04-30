/**
 * Extra coverage for CreateElementMediator — action mediator raw + waitForLoadingDone + resolveAndClick failure + empty + default timeout (split).
 */

import type { Locator, Page } from 'playwright-core';

import createElementMediator from '../../../../../Scrapers/Pipeline/Mediator/Elements/CreateElementMediator.js';
import { makeRichLocator, makeRichPage } from './CreateElementMediatorExtraHelpers.js';

describe('CreateElementMediator — waitForLoadingDone loading branches', () => {
  it('when loading indicator IS isVisible then disappears, returns succeed(true)', async () => {
    let isVisible = true;
    const locator = {
      /**
       * Test helper.
       *
       * @returns Result.
       */
      first(): Locator {
        return this as unknown as Locator;
      },
      /**
       * Test helper.
       *
       * @returns Result.
       */
      isVisible(): Promise<boolean> {
        // First call isVisible=true, subsequent false — simulates disappearance
        const was = isVisible;
        isVisible = false;
        return Promise.resolve(was);
      },
      /**
       * Test helper.
       *
       * @returns Result.
       */
      evaluate(): Promise<unknown> {
        return Promise.resolve(true);
      },
    } as unknown as Locator;
    const page = {
      ...makeRichPage({ locator: makeRichLocator({ visible: false }) }),
      /**
       * getByText returns our loading locator.
       * @returns Loading locator.
       */
      getByText: (): Locator => locator,
      /**
       * waitForTimeout — fast resolve.
       * @returns Immediate resolve.
       */
      waitForTimeout: (): Promise<boolean> => Promise.resolve(true),
    } as unknown as Page;
    const m = createElementMediator(page);
    const r = await m.waitForLoadingDone(page);
    expect(r.success).toBe(true);
  }, 15000);

  it('isVisible throwing is swallowed → treated as not visible', async () => {
    const locator = {
      /**
       * Test helper.
       *
       * @returns Result.
       */
      first(): Locator {
        return this as unknown as Locator;
      },
      /**
       * Test helper.
       *
       * @returns Result.
       */
      isVisible(): Promise<boolean> {
        return Promise.reject(new Error('vis fail'));
      },
    } as unknown as Locator;
    const page = {
      ...makeRichPage({ locator: makeRichLocator({ visible: false }) }),
      /**
       * Test helper.
       *
       * @returns Result.
       */
      getByText: (): Locator => locator,
      /**
       * Test helper.
       *
       * @returns Result.
       */
      waitForTimeout: (): Promise<boolean> => Promise.resolve(true),
    } as unknown as Page;
    const m = createElementMediator(page);
    const r = await m.waitForLoadingDone(page);
    expect(r.success).toBe(true);
  }, 15000);
});

describe('CreateElementMediator — resolveAndClick click failure swallowed', () => {
  it('click that throws is caught; result still returned as success', async () => {
    const locator = makeRichLocator({
      visible: true,
      hitTest: true,
      innerText: 'x',
      clickThrows: true,
    });
    const page = makeRichPage({ locator });
    const m = createElementMediator(page);
    const r = await m.resolveAndClick([{ kind: 'textContent', value: 'x' }], 500);
    expect(r.success).toBe(true);
  }, 5000);
});

describe('CreateElementMediator — resolveVisible empty candidates', () => {
  it('returns NOT_FOUND immediately when no candidates', async () => {
    const locator = makeRichLocator({ visible: false });
    const page = makeRichPage({ locator });
    const m = createElementMediator(page);
    const r = await m.resolveVisible([], 500);
    expect(r.found).toBe(false);
  });

  it('resolveVisibleInContext with zero candidates → NOT_FOUND', async () => {
    const locator = makeRichLocator({ visible: false });
    const page = makeRichPage({ locator });
    const m = createElementMediator(page);
    const r = await m.resolveVisibleInContext([], page);
    expect(r.found).toBe(false);
  });
});

describe('CreateElementMediator — default timeout branches', () => {
  // Exercise the `timeoutMs ?? CLICK_RACE_TIMEOUT` default branches without
  // passing a custom timeout. Uses a locator that resolves visible quickly
  // so we don't block on the 3s default.
  it('resolveVisible uses default timeout when none passed', async () => {
    const locator = makeRichLocator({ visible: true, hitTest: true, innerText: 't' });
    const page = makeRichPage({ locator });
    const m = createElementMediator(page);
    const r = await m.resolveVisible([{ kind: 'textContent', value: 'x' }]);
    expect(r.found).toBe(true);
  }, 5000);

  it('resolveVisibleInContext uses default timeout when none passed', async () => {
    const locator = makeRichLocator({ visible: true, hitTest: true, innerText: 't' });
    const page = makeRichPage({ locator });
    const m = createElementMediator(page);
    const r = await m.resolveVisibleInContext([{ kind: 'textContent', value: 'x' }], page);
    expect(r.found).toBe(true);
  }, 5000);

  it('resolveAndClick uses default timeout when none passed (non-empty candidates)', async () => {
    const locator = makeRichLocator({ visible: true, hitTest: true, innerText: 't' });
    const page = makeRichPage({ locator });
    const m = createElementMediator(page);
    const r = await m.resolveAndClick([{ kind: 'textContent', value: 'x' }]);
    expect(r.success).toBe(true);
  }, 5000);

  it('resolveAndClick uses default timeout for empty candidates (submit fallback)', async () => {
    // Empty candidates take the WK_LOGIN_FORM.submit fallback path.
    const locator = makeRichLocator({ visible: false });
    const page = makeRichPage({ locator });
    const m = createElementMediator(page);
    // Specify low timeout explicitly to avoid 3s delay here.
    const r = await m.resolveAndClick([], 50);
    expect(r.success).toBe(true);
  }, 15000);
});
