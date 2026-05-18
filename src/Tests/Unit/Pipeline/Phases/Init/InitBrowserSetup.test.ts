/**
 * Unit tests for Phases/Init/InitBrowserSetup — safe close helper,
 * createContextAndPage union-narrowing, and buildBrowserState cleanup
 * ordering for both ephemeral and persistent launch paths.
 */

import { jest } from '@jest/globals';
import type { Browser, BrowserContext, Page } from 'playwright-core';

import {
  buildBrowserState,
  closeBrowserSafe,
  createContextAndPage,
} from '../../../../../Scrapers/Pipeline/Phases/Init/InitBrowserSetup.js';

/**
 * Build a fake ephemeral Browser whose `newContext` returns a context
 * whose `newPage` behaves per the callback.
 * @param newPage - Behaviour for `context.newPage()`.
 * @returns Fake Browser + handles for assertion.
 */
function buildFakeEphemeralBrowser(newPage: () => Promise<Page>): {
  browser: Browser;
  contextClose: jest.Mock;
} {
  const contextClose = jest.fn().mockResolvedValue(undefined);
  const fakeContext = { newPage, close: contextClose } as unknown as BrowserContext;
  /**
   * Resolve the fake context.
   * @returns Fake browser context.
   */
  function newContext(): Promise<BrowserContext> {
    return Promise.resolve(fakeContext);
  }
  const browser = { newContext } as unknown as Browser;
  return { browser, contextClose };
}

/**
 * Build a fake persistent BrowserContext with the given page list and
 * an optional `newPage` factory. Lacks `newContext` so the production
 * `'newContext' in result` narrow falls to the persistent branch.
 * @param existingPages - Initial pages owned by the context.
 * @param newPage - Behaviour for `context.newPage()`.
 * @returns Fake context + close handle.
 */
function buildFakePersistentContext(
  existingPages: readonly Page[],
  newPage: () => Promise<Page>,
): { context: BrowserContext; close: jest.Mock } {
  const close = jest.fn().mockResolvedValue(undefined);
  /**
   * Return the prebuilt list of existing pages.
   * @returns Page array (frozen).
   */
  function pages(): readonly Page[] {
    return existingPages;
  }
  const ctx = { pages, newPage, close } as unknown as BrowserContext;
  return { context: ctx, close };
}

describe('createContextAndPage — ephemeral path', () => {
  it('returns context + page on the happy path', async () => {
    const fakePage = { close: jest.fn() } as unknown as Page;
    const { browser } = buildFakeEphemeralBrowser(() => Promise.resolve(fakePage));
    const result = await createContextAndPage(browser);
    expect(result.page).toBe(fakePage);
  });

  it('closes the freshly-created context and rethrows when newPage fails', async () => {
    const newPageErr = new Error('newPage exploded');
    const { browser, contextClose } = buildFakeEphemeralBrowser(() => Promise.reject(newPageErr));
    let didThrow: unknown = null;
    try {
      await createContextAndPage(browser);
    } catch (error_) {
      didThrow = error_;
    }
    expect(didThrow).toBe(newPageErr);
    expect(contextClose).toHaveBeenCalled();
  });
});

describe('createContextAndPage — persistent path', () => {
  it('reuses the first existing page when the context already has one', async () => {
    const existingPage = { close: jest.fn() } as unknown as Page;
    const newPage = jest.fn(() => Promise.resolve({ close: jest.fn() } as unknown as Page));
    const { context } = buildFakePersistentContext([existingPage], newPage);
    const result = await createContextAndPage(context);
    expect(result.context).toBe(context);
    expect(result.page).toBe(existingPage);
    expect(newPage).not.toHaveBeenCalled();
  });

  it('opens a new page when the persistent context has none', async () => {
    const fresh = { close: jest.fn() } as unknown as Page;
    const newPage = jest.fn(() => Promise.resolve(fresh));
    const { context } = buildFakePersistentContext([], newPage);
    const result = await createContextAndPage(context);
    expect(result.page).toBe(fresh);
    expect(newPage).toHaveBeenCalledTimes(1);
  });
});

describe('buildBrowserState cleanup ordering', () => {
  it('produces a single composite cleanup when launchResult === context', async () => {
    const close = jest.fn().mockResolvedValue(undefined);
    /**
     * Empty page list for the persistent-context fake.
     * @returns Frozen empty array.
     */
    function pages(): readonly Page[] {
      return [];
    }
    const sharedCtx = { pages, close } as unknown as BrowserContext;
    const fakePage = { close: jest.fn() } as unknown as Page;
    const state = buildBrowserState({
      page: fakePage,
      context: sharedCtx,
      launchResult: sharedCtx,
      bank: 'amex',
    });
    expect(state.cleanups).toHaveLength(1);
    const didFinish = await state.cleanups[0]();
    expect(didFinish.success).toBe(true);
    expect(close).toHaveBeenCalled();
  });
});

describe('closeBrowserSafe', () => {
  it('returns false when browser handle is false', async () => {
    const didClose = await closeBrowserSafe(false);
    expect(didClose).toBe(false);
  });

  it('returns true when close resolves', async () => {
    const browser = {
      /**
       * Test helper.
       *
       * @returns Result.
       */
      close: (): Promise<void> => Promise.resolve(),
    } as unknown as Browser;
    const didClose = await closeBrowserSafe(browser);
    expect(didClose).toBe(true);
  });

  it('returns false when close rejects', async () => {
    const browser = {
      /**
       * Test helper.
       *
       * @returns Result.
       */
      close: (): Promise<void> => Promise.reject(new Error('already closed')),
    } as unknown as Browser;
    const didClose = await closeBrowserSafe(browser);
    expect(didClose).toBe(false);
  });
});
