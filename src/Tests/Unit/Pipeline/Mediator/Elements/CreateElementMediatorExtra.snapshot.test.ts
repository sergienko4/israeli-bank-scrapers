/**
 * Extra coverage for CreateElementMediator — snapshotValue href + mediator features + resolveField scope fallback + isTrulyVisible (split).
 */

import type { Locator, Page } from 'playwright-core';

import type { SelectorCandidate } from '../../../../../Scrapers/Base/Config/LoginConfigTypes.js';
import createElementMediator from '../../../../../Scrapers/Pipeline/Mediator/Elements/CreateElementMediator.js';
import { makeRichLocator, makeRichPage, TestError } from './CreateElementMediatorExtraHelpers.js';

describe('CreateElementMediator — snapshotValue href target + fallback', () => {
  it('resolveVisible with target:href returns direct href attribute', async () => {
    const locator = makeRichLocator({
      visible: true,
      hitTest: true,
      attr: '/menu/transactions',
    });
    const page = makeRichPage({ locator });
    const m = createElementMediator(page);
    const race = await m.resolveVisible(
      [{ kind: 'textContent', value: 'Transactions', target: 'href' }],
      500,
    );
    expect(race.found).toBe(true);
    if (race.found) expect(race.value).toBe('/menu/transactions');
  }, 5000);

  it('resolveVisible with target:href falls back to ancestor href when direct is empty', async () => {
    // Locator returns empty string for getAttribute but resolves via evaluate (walkUp).
    const locator = {
      /**
       * first.
       * @returns Self.
       */
      first(): Locator {
        return this as unknown as Locator;
      },
      /**
       * waitFor — visible only.
       * @returns Resolves.
       */
      waitFor(): Promise<boolean> {
        return Promise.resolve(true);
      },
      /**
       * evaluate — returns string for walkUpToAnchorHref, true for hit-test.
       * @param fn - Function being evaluated.
       * @returns Scripted.
       */
      evaluate(fn: unknown): Promise<unknown> {
        const fnStr = String(fn);
        if (fnStr.includes('elementFromPoint')) return Promise.resolve(true);
        if (fnStr.includes('closest')) return Promise.resolve('/from-ancestor');
        return Promise.resolve('(trace)');
      },
      /**
       * getAttribute — empty.
       * @returns Empty.
       */
      getAttribute(): Promise<string> {
        return Promise.resolve('');
      },
      /**
       * innerText.
       * @returns Empty.
       */
      innerText(): Promise<string> {
        return Promise.resolve('');
      },
      /**
       * click.
       * @returns Resolves.
       */
      click(): Promise<boolean> {
        return Promise.resolve(true);
      },
    } as unknown as Locator;
    const page = makeRichPage({ locator });
    const m = createElementMediator(page);
    const race = await m.resolveVisible(
      [{ kind: 'textContent', value: 'Txns', target: 'href' }],
      500,
    );
    expect(race.found).toBe(true);
    if (race.found) expect(race.value).toBe('/from-ancestor');
  }, 5000);
});

describe('CreateElementMediator full mediator features', () => {
  it('discoverErrors handles evaluate returning array shape', async () => {
    const locator = makeRichLocator({ visible: false });
    const page = makeRichPage({ locator });
    // Override evaluate to return empty array for FormErrorDiscovery
    const patchedPage = {
      ...page,
      /**
       * evaluate returning empty array for DOM item scanning.
       * @returns Empty array.
       */
      evaluate: (): Promise<unknown[]> => Promise.resolve([]),
    } as unknown as Page;
    const m = createElementMediator(patchedPage);
    const result = await m.discoverErrors(patchedPage);
    expect(typeof result.hasErrors).toBe('boolean');
  });

  it('scopeToForm returns candidates unchanged when no cache', () => {
    const locator = makeRichLocator({ visible: false });
    const page = makeRichPage({ locator });
    const m = createElementMediator(page);
    const candidates: SelectorCandidate[] = [{ kind: 'name', value: 'user' }];
    const scoped = m.scopeToForm(candidates);
    expect(scoped.length).toBe(1);
  });

  it('waitForLoadingDone resolves succeed(true) when no indicators visible', async () => {
    const locator = makeRichLocator({ visible: false });
    const page = makeRichPage({ locator });
    const m = createElementMediator(page);
    const r = await m.waitForLoadingDone(page);
    expect(r.success).toBe(true);
  }, 15000);

  it('discoverForm returns none when field context has no form anchor', async () => {
    const locator = makeRichLocator({ visible: false });
    const page = makeRichPage({ locator });
    const m = createElementMediator(page);
    const field = {
      isResolved: false,
      selector: '',
      context: page,
      resolvedVia: 'notResolved' as const,
      round: 'notResolved' as const,
    };
    const form = await m.discoverForm(field);
    expect(form.has).toBe(false);
  });

  it('resolveField returns failure when empty candidates + main page miss', async () => {
    const locator = makeRichLocator({ visible: false });
    const page = makeRichPage({ locator });
    const m = createElementMediator(page);
    const result = await m.resolveField('username', []);
    expect(result.success).toBe(false);
  });

  it('resolveClickable delegates to __submit__ resolution', async () => {
    const locator = makeRichLocator({ visible: false });
    const page = makeRichPage({ locator });
    const m = createElementMediator(page);
    const r = await m.resolveClickable([]);
    expect(r.success).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════
// Wave 4 / Agent J — branch coverage extensions
// ═══════════════════════════════════════════════════════════

describe('CreateElementMediator — resolveField scope fallback paths', () => {
  it('resolveField with scopeContext falls through to wide scan when scoped misses', async () => {
    const locator = makeRichLocator({ visible: false });
    const page = makeRichPage({ locator });
    const m = createElementMediator(page);
    // Provide scopeContext + formSelector → tryScopedResolve runs, then wide runs.
    const result = await m.resolveField(
      'field-name',
      [{ kind: 'name', value: 'x' }],
      page,
      '#form',
    );
    expect(result.success).toBe(false);
  });

  it('resolveField without scopeContext only runs wide scan', async () => {
    const locator = makeRichLocator({ visible: false });
    const page = makeRichPage({ locator });
    const m = createElementMediator(page);
    const result = await m.resolveField('k', [{ kind: 'name', value: 'a' }]);
    expect(result.success).toBe(false);
  });

  it('resolveField catches thrown errors and returns failure', async () => {
    const locator = makeRichLocator({ visible: false });
    const page = {
      ...makeRichPage({ locator }),
      /**
       * getByLabel throws to trigger handleResolveError.
       * @returns Throws.
       */
      getByLabel: (): Locator => {
        throw new TestError('resolver boom');
      },
    } as unknown as Page;
    const m = createElementMediator(page);
    const r = await m.resolveField('field', [{ kind: 'ariaLabel', value: 'X' }]);
    expect(r.success).toBe(false);
  });
});

describe('CreateElementMediator — isTrulyVisible evaluate-callback branches', () => {
  it('hit-test that returns true marks element visible (winner selected)', async () => {
    const locator = makeRichLocator({ visible: true, hitTest: true, innerText: 'x' });
    const page = makeRichPage({ locator });
    const m = createElementMediator(page);
    const r = await m.resolveVisible([{ kind: 'textContent', value: 'x' }], 500);
    expect(r.found).toBe(true);
  }, 5000);

  it('hit-test returns false → fallback to first fulfilled picks winner', async () => {
    const locator = makeRichLocator({ visible: true, hitTest: false });
    const page = makeRichPage({ locator });
    const m = createElementMediator(page);
    const r = await m.resolveVisible([{ kind: 'textContent', value: 'x' }], 500);
    expect(r.found).toBe(true);
  }, 5000);

  it('isTrulyVisible catches evaluate exceptions and returns false', async () => {
    // Locator where evaluate throws under hit-test → isTrulyVisible returns false (catch branch)
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
      evaluate(): Promise<never> {
        return Promise.reject(new Error('eval boom'));
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
    // Element passes visible race but fails all hit-tests → fallback to first fulfilled.
    expect(r.found).toBe(true);
  }, 5000);
});
