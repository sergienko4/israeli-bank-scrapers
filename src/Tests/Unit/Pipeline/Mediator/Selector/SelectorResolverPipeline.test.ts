/**
 * Unit tests for SelectorResolverPipeline — buildNotFoundContext + probeMainPage + probeIframes.
 */

import type { Frame, Page } from 'playwright-core';

import type {
  IFieldConfig,
  SelectorCandidate,
} from '../../../../../Scrapers/Base/Config/LoginConfig.js';
import {
  buildNotFoundContext,
  probeIframes,
  probeMainPage,
  resolveInMainContext,
  searchInChildFrames,
} from '../../../../../Scrapers/Pipeline/Mediator/Selector/SelectorResolverPipeline.js';

/**
 * Build a mock Page with scripted $() and title() behaviour.
 * @param pageTitle - Page title returned by title().
 * @returns Mock page.
 */
function makePage(pageTitle = 'Mock Bank'): Page {
  return {
    /**
     * $ returns null (nothing found).
     * @returns Resolved null.
     */
    $: (): Promise<unknown> => Promise.resolve(null),
    /**
     * Title resolver.
     * @returns Resolved title string.
     */
    title: (): Promise<string> => Promise.resolve(pageTitle),
    /**
     * Locator shim — always 0 count.
     * @returns Fake locator.
     */
    locator: (): unknown => ({
      /**
       * First.
       * @returns Self.
       */
      first: (): unknown => ({
        /**
         * Count.
         * @returns 0.
         */
        count: (): Promise<number> => Promise.resolve(0),
      }),
    }),
    /**
     * frames — empty list.
     * @returns Empty array.
     */
    frames: (): Frame[] => [],
    /**
     * mainFrame.
     * @returns Self cast.
     */
    mainFrame: (): Frame => ({}) as Frame,
  } as unknown as Page;
}

/** Dummy field config for tests. */
const FIELD: IFieldConfig = {
  credentialKey: 'username',
  selectors: [{ kind: 'css', value: '#missing' }],
};

describe('buildNotFoundContext', () => {
  it('returns isResolved=false with diagnostic message', async () => {
    const page = makePage();
    const result = await buildNotFoundContext({
      pageOrFrame: page,
      field: FIELD,
      pageUrl: 'https://bank.co.il/login',
      bankCandidates: [...FIELD.selectors],
      wellKnownCandidates: [{ kind: 'name', value: 'user' }],
    });
    expect(result.isResolved).toBe(false);
    expect(result.resolvedVia).toBe('notResolved');
    expect(result.message).toContain('username');
    expect(result.message).toContain('Mock Bank');
  });

  it('handles title() failure with (unknown) fallback', async () => {
    const page = {
      ...makePage(),
      /**
       * Title throws.
       * @returns Rejected promise.
       */
      title: (): Promise<string> => Promise.reject(new Error('no title')),
    };
    const result = await buildNotFoundContext({
      pageOrFrame: page,
      field: FIELD,
      pageUrl: 'https://b.co.il',
      bankCandidates: [],
      wellKnownCandidates: [],
    });
    expect(result.message).toContain('(unknown)');
  });
});

describe('probeMainPage', () => {
  it('returns empty match when no candidates match', async () => {
    const page = makePage();
    const result = await probeMainPage({
      pageOrFrame: page,
      field: FIELD,
      pageUrl: 'https://b.co.il',
      bankCandidates: [...FIELD.selectors],
      wellKnownCandidates: [],
    });
    expect('isResolved' in result).toBe(false);
  });

  it('returns not-resolved match when both groups empty', async () => {
    const page = makePage();
    const result = await probeMainPage({
      pageOrFrame: page,
      field: FIELD,
      pageUrl: 'https://b.co.il',
      bankCandidates: [],
      wellKnownCandidates: [],
    });
    expect('isResolved' in result).toBe(false);
  });
});

describe('probeIframes', () => {
  it('returns empty match when page has no child frames', async () => {
    const page = makePage();
    const result = await probeIframes(page, {
      pageOrFrame: page,
      field: FIELD,
      pageUrl: 'https://b.co.il',
      bankCandidates: [...FIELD.selectors],
      wellKnownCandidates: [],
    });
    expect('isResolved' in result).toBe(false);
  });
});

describe('searchInChildFrames', () => {
  it('returns empty when no child frames', async () => {
    const page = makePage();
    const result = await searchInChildFrames(page, []);
    expect(result.selector).toBe('');
  });
});

describe('resolveInMainContext', () => {
  it('returns empty for context where nothing matches', async () => {
    const page = makePage();
    const candidates: SelectorCandidate[] = [{ kind: 'css', value: '#missing' }];
    const result = await resolveInMainContext(page, candidates, 'username');
    expect(result.selector).toBe('');
  });
});
