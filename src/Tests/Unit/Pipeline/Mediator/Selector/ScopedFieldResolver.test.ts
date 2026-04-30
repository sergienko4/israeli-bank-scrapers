/**
 * Unit tests for ScopedFieldResolver — resolves fields inside a form scope.
 */

import type { Page } from 'playwright-core';

import type { SelectorCandidate } from '../../../../../Scrapers/Base/Config/LoginConfigTypes.js';
import probeScopedField from '../../../../../Scrapers/Pipeline/Mediator/Selector/ScopedFieldResolver.js';

/**
 * Build a mock Page where locator(selector).count() resolves a scripted number.
 * @param countsBySelector - Map of selector substring to count value.
 * @returns Mock page.
 */
function makeCountingPage(countsBySelector: Record<string, number>): Page {
  return {
    /**
     * Mock locator.
     * @param sel - Selector string.
     * @returns Locator with count.
     */
    locator: (sel: string) => ({
      /**
       * Count elements.
       * @returns Scripted count.
       */
      count: (): Promise<number> => {
        const entry = Object.entries(countsBySelector).find(([key]) => sel.includes(key));
        return Promise.resolve(entry ? entry[1] : 0);
      },
    }),
  } as unknown as Page;
}

describe('probeScopedField', () => {
  it('returns not-found when no candidate matches', async () => {
    const page = makeCountingPage({});
    const candidates: SelectorCandidate[] = [{ kind: 'css', value: '#missing' }];
    const result = await probeScopedField(page, candidates);
    expect(result.isResolved).toBe(false);
    expect(result.resolvedVia).toBe('notResolved');
    expect(result.round).toBe('notResolved');
  });

  it('returns first matching candidate as resolved', async () => {
    const page = makeCountingPage({ '#username': 1 });
    const candidates: SelectorCandidate[] = [
      { kind: 'css', value: '#missing' },
      { kind: 'css', value: '#username' },
    ];
    const result = await probeScopedField(page, candidates);
    expect(result.isResolved).toBe(true);
    expect(result.resolvedVia).toBe('wellKnown');
    expect(result.round).toBe('mainPage');
    expect(result.selector).toBe('#username');
  });

  it('resolves first of multiple matches', async () => {
    const page = makeCountingPage({ '#a': 1, '#b': 1 });
    const candidates: SelectorCandidate[] = [
      { kind: 'css', value: '#a' },
      { kind: 'css', value: '#b' },
    ];
    const result = await probeScopedField(page, candidates);
    expect(result.selector).toBe('#a');
  });

  it('returns not-found when locator count throws (catch path)', async () => {
    const page = {
      /**
       * Mock locator with failing count.
       * @returns Locator.
       */
      locator: () => ({
        /**
         * Throws.
         * @returns Rejected promise.
         */
        count: (): Promise<number> => Promise.reject(new Error('detached')),
      }),
    } as unknown as Page;
    const candidates: SelectorCandidate[] = [{ kind: 'css', value: '#x' }];
    const result = await probeScopedField(page, candidates);
    expect(result.isResolved).toBe(false);
  });

  it('records resolvedKind from the matched candidate', async () => {
    const page = makeCountingPage({ '[name="pw"]': 1 });
    const candidates: SelectorCandidate[] = [{ kind: 'name', value: 'pw' }];
    const result = await probeScopedField(page, candidates);
    expect(result.isResolved).toBe(true);
    expect(result.resolvedKind).toBe('name');
  });
});
