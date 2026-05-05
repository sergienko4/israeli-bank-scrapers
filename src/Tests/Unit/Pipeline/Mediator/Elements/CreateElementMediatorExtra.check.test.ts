/**
 * Extra coverage for CreateElementMediator — getAttributeValue + checkAttribute branches (split).
 */

import type { Locator } from 'playwright-core';

import createElementMediator from '../../../../../Scrapers/Pipeline/Mediator/Elements/CreateElementMediator.js';
import { makeRichLocator, makeRichPage } from './CreateElementMediatorExtraHelpers.js';

describe('CreateElementMediator — getAttributeValue with null return', () => {
  // hits `attr ?? ''` branch where getAttribute returns null
  it('returns empty string when attribute is explicitly null', async () => {
    const locator = makeRichLocator({ visible: true, hitTest: true, attr: null });
    const page = makeRichPage({ locator });
    const m = createElementMediator(page);
    const race = await m.resolveVisible([{ kind: 'textContent', value: 'x' }], 500);
    expect(race.found).toBe(true);
    const v = await m.getAttributeValue(race, 'nope');
    expect(v).toBe('');
  }, 5000);

  it('returns empty string on getAttribute throw', async () => {
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
        return Promise.resolve('t');
      },
      /**
       * Test helper.
       *
       * @returns Result.
       */
      getAttribute(): Promise<string | false> {
        return Promise.reject(new Error('attr fail'));
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
    const race = await m.resolveVisible([{ kind: 'textContent', value: 'x' }], 500);
    expect(race.found).toBe(true);
    const v = await m.getAttributeValue(race, 'x');
    expect(v).toBe('');
  }, 5000);
});

describe('CreateElementMediator — checkAttribute with empty attr', () => {
  it('returns false when attribute is empty string', async () => {
    const locator = makeRichLocator({ visible: true, hitTest: true, attr: '' });
    const page = makeRichPage({ locator });
    const m = createElementMediator(page);
    const race = await m.resolveVisible([{ kind: 'textContent', value: 'x' }], 500);
    expect(race.found).toBe(true);
    const r = await m.checkAttribute(race, 'x');
    expect(r.success).toBe(true);
    if (r.success) expect(r.value).toBe(false);
  }, 5000);

  it('returns false when getAttribute throws', async () => {
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
        return Promise.resolve('');
      },
      /**
       * Test helper.
       *
       * @returns Result.
       */
      getAttribute(): Promise<string | false> {
        return Promise.reject(new Error('boom'));
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
    const race = await m.resolveVisible([{ kind: 'textContent', value: 'x' }], 500);
    const r = await m.checkAttribute(race, 'x');
    expect(r.success).toBe(true);
    if (r.success) expect(r.value).toBe(false);
  }, 5000);
});

// ═══════════════════════════════════════════════════════════
// Wave 5 — Agent M branch coverage extensions
// ═══════════════════════════════════════════════════════════
