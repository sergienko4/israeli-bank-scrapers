/**
 * Extra coverage for CreateElementMediator — snapshotValue text-path + traceElementIdentity catch (split).
 */

import type { Locator } from 'playwright-core';

import createElementMediator from '../../../../../Scrapers/Pipeline/Mediator/Elements/CreateElementMediator.js';
import { makeRichLocator, makeRichPage } from './CreateElementMediatorExtraHelpers.js';

describe('CreateElementMediator — snapshotValue text-path branches', () => {
  it('target unset (default self) returns innerText', async () => {
    const locator = makeRichLocator({ visible: true, hitTest: true, innerText: 'hello' });
    const page = makeRichPage({ locator });
    const m = createElementMediator(page);
    const r = await m.resolveVisible([{ kind: 'textContent', value: 'x' }], 500);
    expect(r.found).toBe(true);
    if (r.found) expect(r.value).toBe('hello');
  }, 5000);

  it('innerText catch → empty string fallback', async () => {
    // Force innerText to throw
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
      waitFor(): Promise<boolean> {
        return Promise.resolve(true);
      },
      /**
       * Test helper.
       *
       * @returns Result.
       */
      evaluate(): Promise<unknown> {
        return Promise.resolve(true);
      },
      /**
       * Test helper.
       *
       * @returns Result.
       */
      innerText(): Promise<string> {
        return Promise.reject(new Error('no text'));
      },
      /**
       * Test helper.
       *
       * @returns Result.
       */
      getAttribute(): Promise<string | false> {
        return Promise.resolve(false);
      },
      /**
       * Test helper.
       *
       * @returns Result.
       */
      click(): Promise<boolean> {
        return Promise.resolve(true);
      },
    } as unknown as Locator;
    const page = makeRichPage({ locator });
    const m = createElementMediator(page);
    const r = await m.resolveVisible([{ kind: 'textContent', value: 'x' }], 500);
    expect(r.found).toBe(true);
    if (r.found) expect(r.value).toBe('');
  }, 5000);

  it('target:href with getAttribute throw falls back to ancestor walk-up', async () => {
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
      waitFor(): Promise<boolean> {
        return Promise.resolve(true);
      },
      /**
       * Test helper.
       *
       * @param fn - Parameter.
       * @returns Result.
       */
      evaluate(fn: unknown): Promise<unknown> {
        const src = String(fn);
        if (src.includes('elementFromPoint')) return Promise.resolve(true);
        if (src.includes('closest')) return Promise.resolve('/ancestor-path');
        return Promise.resolve('(trace)');
      },
      /**
       * Test helper.
       *
       * @returns Result.
       */
      innerText(): Promise<string> {
        return Promise.resolve('');
      },
      /**
       * Test helper.
       *
       * @returns Result.
       */
      getAttribute(): Promise<string | false> {
        return Promise.reject(new Error('no attr'));
      },
      /**
       * Test helper.
       *
       * @returns Result.
       */
      click(): Promise<boolean> {
        return Promise.resolve(true);
      },
    } as unknown as Locator;
    const page = makeRichPage({ locator });
    const m = createElementMediator(page);
    const r = await m.resolveVisible([{ kind: 'textContent', value: 'x', target: 'href' }], 500);
    expect(r.found).toBe(true);
    if (r.found) expect(r.value).toBe('/ancestor-path');
  }, 5000);

  it('target:href with ancestor evaluate throw falls through to empty', async () => {
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
      waitFor(): Promise<boolean> {
        return Promise.resolve(true);
      },
      /**
       * Test helper.
       *
       * @param fn - Parameter.
       * @returns Result.
       */
      evaluate(fn: unknown): Promise<unknown> {
        const src = String(fn);
        if (src.includes('elementFromPoint')) return Promise.resolve(true);
        if (src.includes('closest')) return Promise.reject(new Error('walkUp boom'));
        return Promise.resolve('(trace)');
      },
      /**
       * Test helper.
       *
       * @returns Result.
       */
      innerText(): Promise<string> {
        return Promise.resolve('');
      },
      /**
       * Test helper.
       *
       * @returns Result.
       */
      getAttribute(): Promise<string | false> {
        return Promise.resolve('');
      },
      /**
       * Test helper.
       *
       * @returns Result.
       */
      click(): Promise<boolean> {
        return Promise.resolve(true);
      },
    } as unknown as Locator;
    const page = makeRichPage({ locator });
    const m = createElementMediator(page);
    const r = await m.resolveVisible([{ kind: 'textContent', value: 'x', target: 'href' }], 500);
    expect(r.found).toBe(true);
    if (r.found) expect(r.value).toBe('');
  }, 5000);
});

describe('CreateElementMediator — traceElementIdentity catch branch', () => {
  it('identity evaluate rejection still produces a race result', async () => {
    let callCount = 0;
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
      waitFor(): Promise<boolean> {
        return Promise.resolve(true);
      },
      /**
       * Test helper.
       *
       * @param fn - Parameter.
       * @returns Result.
       */
      evaluate(fn: unknown): Promise<unknown> {
        callCount += 1;
        const src = String(fn);
        if (src.includes('elementFromPoint')) return Promise.resolve(true);
        // Throw in extractIdentity (className-branch)
        if (src.includes('className')) return Promise.reject(new Error('id boom'));
        return Promise.resolve('');
      },
      /**
       * Test helper.
       *
       * @returns Result.
       */
      innerText(): Promise<string> {
        return Promise.resolve('ok');
      },
      /**
       * Test helper.
       *
       * @returns Result.
       */
      getAttribute(): Promise<string | false> {
        return Promise.resolve(false);
      },
      /**
       * Test helper.
       *
       * @returns Result.
       */
      click(): Promise<boolean> {
        return Promise.resolve(true);
      },
    } as unknown as Locator;
    const page = makeRichPage({ locator });
    const m = createElementMediator(page);
    const r = await m.resolveVisible([{ kind: 'textContent', value: 'x' }], 500);
    expect(r.found).toBe(true);
    expect(callCount).toBeGreaterThan(0);
  }, 5000);
});
