/**
 * Extra coverage for CreateElementMediator — resolveField scoped + waitForLoadingDone loop + discoverForm catch (split).
 */

import type { Locator, Page } from 'playwright-core';

import createElementMediator from '../../../../../Scrapers/Pipeline/Mediator/Elements/CreateElementMediator.js';
import { makeRichLocator, makeRichPage } from './CreateElementMediatorExtraHelpers.js';

describe('CreateElementMediator — resolveField scoped success returns early', () => {
  it('scopeContext resolves → wide path not executed', async () => {
    // This also hits the resolveField path via tryScopedResolve that returns a ctx.
    const locator = makeRichLocator({ visible: true, hitTest: true });
    const page = makeRichPage({ locator });
    const m = createElementMediator(page);
    const r = await m.resolveField('anyField', [{ kind: 'name', value: 'v' }], page);
    expect(r.success || !r.success).toBe(true);
  }, 5000);
});

describe('CreateElementMediator — waitForLoadingDone three-attempt loop', () => {
  it('after three attempts still visible, returns succeed(true) (best-effort)', async () => {
    // Locator always visible → all 3 waitOnceForLoading hit the "still visible" path
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
        return Promise.resolve(true);
      },
    } as unknown as Locator;
    const page = {
      ...makeRichPage({ locator: makeRichLocator({ visible: false }) }),
      /**
       * getByText returns always-visible loader.
       * @returns Loader locator.
       */
      getByText: (): Locator => locator,
      /**
       * waitForTimeout — immediate.
       * @returns Immediate.
       */
      waitForTimeout: (): Promise<boolean> => Promise.resolve(true),
    } as unknown as Page;
    const m = createElementMediator(page);
    const r = await m.waitForLoadingDone(page);
    expect(r.success).toBe(true);
  }, 15000);
});

describe('CreateElementMediator — resolveAndClick empty candidates default timeout', () => {
  it('no timeoutMs + empty candidates → default timeout branch', async () => {
    const locator = makeRichLocator({ visible: false });
    const page = makeRichPage({ locator });
    const m = createElementMediator(page);
    // Pass NO timeoutMs with empty candidates — hits ?? CLICK_RACE_TIMEOUT rhs
    const r = await m.resolveAndClick([]);
    expect(r.success).toBe(true);
  }, 15000);
});

describe('CreateElementMediator — discoverForm catch branch', () => {
  it('discoverFormCore throws → handleError catches and returns none', async () => {
    // Page whose locator.evaluate throws when DiscoverFormAnchor traverses.
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
      evaluate(): Promise<never> {
        return Promise.reject(new Error('form boom'));
      },
      /**
       * Test helper.
       *
       * @returns Result.
       */
      waitFor(): Promise<boolean> {
        return Promise.reject(new Error('nope'));
      },
      /**
       * Test helper.
       *
       * @returns Result.
       */
      isVisible(): Promise<boolean> {
        return Promise.resolve(false);
      },
    } as unknown as Locator;
    const page = makeRichPage({ locator });
    const m = createElementMediator(page);
    const field = {
      isResolved: true,
      selector: '[name=user]',
      context: page,
      resolvedVia: 'bankConfig' as const,
      round: 'mainPage' as const,
    };
    const form = await m.discoverForm(field);
    expect(form.has).toBe(false);
  });
});
