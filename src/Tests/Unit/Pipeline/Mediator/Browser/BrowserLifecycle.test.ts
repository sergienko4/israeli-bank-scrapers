/**
 * Unit tests for Mediator/Browser/BrowserLifecycle — safe close helper and
 * context/page creation.
 */

import type { Browser, BrowserContext } from 'playwright-core';

import {
  closeBrowserSafe,
  createContextAndPage,
} from '../../../../../Scrapers/Pipeline/Mediator/Browser/BrowserLifecycle.js';

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

// Page creation is the one step between `newContext` and the caller receiving
// a handle. If it rejects, nothing downstream holds the context, so only this
// frame can close it — an untested path here leaks a Camoufox context per
// failure. `rejects.toBe` (identity, not `toThrow`) pins that the original
// error reaches the caller unwrapped, since callers classify on it.
describe('createContextAndPage', () => {
  /**
   * Build a context whose page creation fails, recording closure.
   *
   * @param failure - The rejection `newPage` should produce.
   * @param closes - Receives one entry each time the context is closed.
   * @returns A context stub.
   */
  function makeFailingContext(failure: Error, closes: string[]): BrowserContext {
    return {
      /**
       * Test helper.
       *
       * @returns Result.
       */
      close: (): Promise<void> => {
        closes.push('closed');
        return Promise.resolve();
      },
      /**
       * Test helper.
       *
       * @returns Result.
       */
      newPage: (): Promise<never> => Promise.reject(failure),
    } as unknown as BrowserContext;
  }

  /**
   * Build a browser handing back a fixed context.
   *
   * @param context - The context to return.
   * @returns A browser stub.
   */
  function makeBrowser(context: BrowserContext): Browser {
    return {
      /**
       * Test helper.
       *
       * @returns Result.
       */
      newContext: (): Promise<BrowserContext> => Promise.resolve(context),
    } as unknown as Browser;
  }

  it('closes the context and rethrows unchanged when newPage rejects', async () => {
    const failure = new Error('newPage failed');
    const closes: string[] = [];
    const context = makeFailingContext(failure, closes);
    const browser = makeBrowser(context);

    const attempt = createContextAndPage(browser, 'no-such-company');

    await expect(attempt).rejects.toBe(failure);
    expect(closes).toHaveLength(1);
  });

  it('still rethrows when the rescue close itself rejects', async () => {
    const failure = new Error('newPage failed');
    const context = {
      /**
       * Test helper.
       *
       * @returns Result.
       */
      close: (): Promise<void> => Promise.reject(new Error('close failed')),
      /**
       * Test helper.
       *
       * @returns Result.
       */
      newPage: (): Promise<never> => Promise.reject(failure),
    } as unknown as BrowserContext;
    const browser = makeBrowser(context);

    const attempt = createContextAndPage(browser, 'no-such-company');

    await expect(attempt).rejects.toBe(failure);
  });
});
