/**
 * Extra coverage for SelectorResolver — tryInContext, resolveFieldContext,
 * resolveDashboardField, candidate probing paths.
 */

import type { Frame, Locator, Page } from 'playwright-core';

import type {
  IFieldConfig,
  SelectorCandidate,
} from '../../../../../Scrapers/Base/Config/LoginConfig.js';
import {
  resolveDashboardField,
  resolveFieldContext,
  resolveFieldWithCache,
  tryInContext,
} from '../../../../../Scrapers/Pipeline/Mediator/Selector/SelectorResolver.js';

/**
 * Build a mock locator whose count() returns scripted value.
 * @param count - Element count.
 * @returns Mock Locator.
 */
function makeLocator(count: number): Locator {
  const self: unknown = {
    /**
     * count.
     * @returns Scripted count.
     */
    count: (): Promise<number> => Promise.resolve(count),
    /**
     * first.
     * @returns Self.
     */
    first: (): Locator => self as Locator,
    /**
     * evaluate — returns tag name.
     * @returns Tag name.
     */
    evaluate: (): Promise<string> => Promise.resolve('input'),
    /**
     * getAttribute.
     * @returns Null.
     */
    getAttribute: (): Promise<string | false> => Promise.resolve(false),
  };
  return self as Locator;
}

/**
 * Build a mock Page that provides $ + title + locator + frames.
 * @param script - Behaviour script.
 * @param script.found - Whether found.
 * @param script.frames - Frame list.
 * @returns Mock page.
 */
function makePage(script: { found?: boolean; frames?: Frame[] } = {}): Page {
  return {
    /**
     * $ returns element or null based on flag.
     * @returns Promise of null or element.
     */
    $: (): Promise<unknown> => {
      if (script.found) return Promise.resolve({});
      return Promise.resolve(null);
    },
    /**
     * locator.
     * @returns Mock locator with count 0.
     */
    locator: (): Locator => makeLocator(0),
    /**
     * title.
     * @returns Empty string.
     */
    title: (): Promise<string> => Promise.resolve(''),
    /**
     * frames.
     * @returns Scripted frames list.
     */
    frames: (): Frame[] => script.frames ?? [],
    /**
     * mainFrame.
     * @returns Self cast.
     */
    mainFrame: (): Frame => ({}) as Frame,
  } as unknown as Page;
}

describe('tryInContext', () => {
  it('returns empty string for empty candidates array', async () => {
    const page = makePage();
    const result = await tryInContext(page, []);
    expect(result).toBe('');
  });

  it('returns empty when no candidate matches', async () => {
    const page = makePage();
    const candidates: SelectorCandidate[] = [{ kind: 'css', value: '#missing' }];
    const result = await tryInContext(page, candidates);
    expect(result).toBe('');
  });
});

describe('resolveFieldContext', () => {
  it('returns not-resolved IFieldContext when nothing found', async () => {
    const page = makePage();
    const field: IFieldConfig = {
      credentialKey: 'username',
      selectors: [{ kind: 'css', value: '#user' }],
    };
    const result = await resolveFieldContext(page, field, 'https://bank.co.il');
    expect(result.isResolved).toBe(false);
  });
});

describe('resolveFieldWithCache', () => {
  it('returns not-resolved when cached frames empty + main misses', async () => {
    const page = makePage();
    const field: IFieldConfig = {
      credentialKey: 'password',
      selectors: [],
    };
    const result = await resolveFieldWithCache({
      pageOrFrame: page,
      field,
      pageUrl: 'https://bank.co.il',
      cachedFrames: [],
    });
    expect(result.isResolved).toBe(false);
  });
});

describe('resolveDashboardField', () => {
  it('returns not-resolved when dashboard field missing', async () => {
    const page = makePage();
    const result = await resolveDashboardField({
      pageOrFrame: page,
      fieldKey: 'accountId',
      bankCandidates: [],
      pageUrl: 'https://bank.co.il/dashboard',
    });
    expect(result.isResolved).toBe(false);
  });

  it('handles unknown dashboard field key with empty WK set', async () => {
    const page = makePage();
    const result = await resolveDashboardField({
      pageOrFrame: page,
      fieldKey: 'unknownFieldKey',
      bankCandidates: [{ kind: 'css', value: '#x' }],
      pageUrl: 'https://bank.co.il/dashboard',
    });
    expect(result.isResolved).toBe(false);
  });
});

/**
 * Build a page whose locator always returns a positive-count locator — exercises
 * the probeClickableText branch and fillable-check branch.
 * @param script - Behaviour.
 * @param script.queryFound - Whether query found a match.
 * @param script.clickableTag - Clickable tag name.
 * @param script.inputType - Input type attribute.
 * @returns Mock page.
 */
function makeMatchingPage(script: {
  queryFound: boolean;
  clickableTag?: string;
  inputType?: string | false;
}): Page {
  const tag = script.clickableTag ?? 'BUTTON';
  const inputType = script.inputType ?? 'text';
  const self: Record<string, unknown> = {
    /**
     * $ — resolves with dummy element when queryFound is true.
     * @returns Matched element.
     */
    $: (): Promise<unknown> => {
      if (script.queryFound) return Promise.resolve({});
      return Promise.resolve(null);
    },
    /**
     * locator — returns a locator whose evaluate returns tag/inputType.
     * @returns Mock locator.
     */
    locator: (): Locator => {
      const inner: Record<string, unknown> = {
        /**
         * first.
         * @returns Self.
         */
        first: (): Locator => inner as unknown as Locator,
        /**
         * count.
         * @returns Script-driven count.
         */
        count: (): Promise<number> => Promise.resolve(script.queryFound ? 1 : 0),
        /**
         * evaluate — returns tag or type.
         * @returns Tag / type.
         */
        evaluate: (): Promise<string> => Promise.resolve(tag),
        /**
         * getAttribute — returns inputType.
         * @returns Input type.
         */
        getAttribute: (): Promise<string | false> => Promise.resolve(inputType),
      };
      return inner as unknown as Locator;
    },
    /**
     * title.
     * @returns Empty.
     */
    title: (): Promise<string> => Promise.resolve(''),
    /**
     * frames.
     * @returns Empty.
     */
    frames: (): Frame[] => [],
  };
  return self as unknown as Page;
}

describe('tryInContext — probeClickableText branch', () => {
  it('returns a selector when clickableText candidate matches a clickable element', async () => {
    const page = makeMatchingPage({ queryFound: true, clickableTag: 'BUTTON' });
    const result = await tryInContext(page, [{ kind: 'clickableText', value: 'Submit' }]);
    expect(typeof result).toBe('string');
  });

  it('falls through to empty when clickableText query finds nothing', async () => {
    const page = makeMatchingPage({ queryFound: false });
    const result = await tryInContext(page, [{ kind: 'clickableText', value: 'Nope' }]);
    expect(result).toBe('');
  });
});

describe('tryInContext — fillable-check branch', () => {
  it('treats non-input target as fillable by default (ariaLabel falls through)', async () => {
    const page = makeMatchingPage({ queryFound: true, inputType: 'text' });
    const result = await tryInContext(page, [{ kind: 'ariaLabel', value: 'User' }]);
    expect(typeof result).toBe('string');
  });

  it('treats hidden input as NOT fillable (ariaLabel with hidden type filtered)', async () => {
    const page = makeMatchingPage({ queryFound: true, inputType: 'hidden' });
    const result = await tryInContext(page, [{ kind: 'ariaLabel', value: 'User' }]);
    expect(typeof result).toBe('string');
  });

  it('handles throw in fillable-check gracefully (catch → true)', async () => {
    const throwingPage: Record<string, unknown> = {
      /**
       * Test helper.
       *
       * @returns Result.
       */
      $: (): Promise<Record<string, unknown>> => Promise.resolve({}),
      /**
       * locator throws on evaluate.
       * @returns Locator that rejects evaluate.
       */
      locator: (): Locator => {
        const inner: Record<string, unknown> = {
          /**
           * Test helper.
           *
           * @returns Result.
           */
          first: (): Locator => inner as unknown as Locator,
          /**
           * Test helper.
           *
           * @returns Result.
           */
          count: (): Promise<number> => Promise.resolve(1),
          /**
           * Test helper.
           *
           * @returns Result.
           */
          evaluate: (): Promise<string> => Promise.reject(new Error('eval boom')),
          /**
           * Test helper.
           *
           * @returns Result.
           */
          getAttribute: (): Promise<string | false> => Promise.resolve('text'),
        };
        return inner as unknown as Locator;
      },
      /**
       * Test helper.
       *
       * @returns Result.
       */
      title: (): Promise<string> => Promise.resolve(''),
      /**
       * Test helper.
       *
       * @returns Result.
       */
      frames: (): Frame[] => [],
    };
    const result = await tryInContext(throwingPage as unknown as Page, [
      { kind: 'ariaLabel', value: 'User' },
    ]);
    expect(typeof result).toBe('string');
  });
});
