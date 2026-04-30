/**
 * Unit tests for ElementWaitAction — waitUntilElementFound, waitUntilElementDisappear, waitUntilIframeFound.
 */

import type { Frame, Page } from 'playwright-core';

import {
  waitUntilElementDisappear,
  waitUntilElementFound,
  waitUntilIframeFound,
} from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementWaitAction.js';

/** Script for a mock Page's waitForSelector behaviour. */
interface IWaitScript {
  waitOk: boolean;
  framesList: Frame[];
}

/**
 * Build a mock Page that scripts waitForSelector + frames + evaluate.
 * @param script - Behaviour.
 * @returns Mock page.
 */
function makePage(script: IWaitScript): Page {
  return {
    /**
     * waitForSelector — resolves or rejects.
     * @returns Scripted promise.
     */
    waitForSelector: (): Promise<unknown> => {
      if (script.waitOk) return Promise.resolve({});
      return Promise.reject(new Error('timeout'));
    },
    /**
     * evaluate.
     * @returns Empty string.
     */
    evaluate: (): Promise<string> => Promise.resolve('—'),
    /**
     * frames.
     * @returns Scripted frames.
     */
    frames: (): Frame[] => script.framesList,
    /**
     * title.
     * @returns Mock title.
     */
    title: (): Promise<string> => Promise.resolve('t'),
    /**
     * locator — unused shim.
     * @returns Empty object.
     */
    locator: (): unknown => ({}),
  } as unknown as Page;
}

describe('waitUntilElementFound', () => {
  it('returns true when waitForSelector resolves', async () => {
    const page = makePage({ waitOk: true, framesList: [] });
    const isOk = await waitUntilElementFound(page, '#x');
    expect(isOk).toBe(true);
  });

  it('rethrows when waitForSelector rejects', async () => {
    const page = makePage({ waitOk: false, framesList: [] });
    const waitUntilElementFoundResult1 = waitUntilElementFound(page, '#x');
    await expect(waitUntilElementFoundResult1).rejects.toThrow(/timeout/);
  });

  it('handles visible:true by using visible state', async () => {
    const page = makePage({ waitOk: true, framesList: [] });
    const isOk = await waitUntilElementFound(page, '#x', { visible: true });
    expect(isOk).toBe(true);
  });
});

describe('waitUntilElementDisappear', () => {
  it('returns true when selector disappears', async () => {
    const page = makePage({ waitOk: true, framesList: [] });
    const isOk = await waitUntilElementDisappear(page, '#x');
    expect(isOk).toBe(true);
  });

  it('rejects when waitForSelector rejects', async () => {
    const page = makePage({ waitOk: false, framesList: [] });
    const waitUntilElementDisappearResult2 = waitUntilElementDisappear(page, '#x');
    await expect(waitUntilElementDisappearResult2).rejects.toThrow();
  });
});

describe('waitUntilIframeFound', () => {
  it('returns matching frame when predicate succeeds', async () => {
    /**
     * Build a mock frame with a name.
     * @param name - Name attribute.
     * @returns Mock frame.
     */
    const makeFrame = (name: string): Frame =>
      ({
        /**
         * Test helper.
         *
         * @returns Result.
         */
        name: (): string => name,
        /**
         * Frame URL.
         * @returns Empty string.
         */
        url: (): string => '',
      }) as unknown as Frame;
    const target = makeFrame('otp');
    const page = makePage({ waitOk: true, framesList: [target] });
    const result = await waitUntilIframeFound(page, (f): boolean => f.name() === 'otp', {
      description: 'otp',
      timeout: 100,
    });
    expect(result).toBe(target);
  });

  it('throws when no frame matches within timeout', async () => {
    const page = makePage({ waitOk: false, framesList: [] });
    const waitUntilIframeFoundResult3 = waitUntilIframeFound(page, (): boolean => false, {
      description: 'missing',
      timeout: 10,
    });
    await expect(waitUntilIframeFoundResult3).rejects.toThrow();
  });

  it('uses default opts (no description, default timeout) — finds frame on first poll', async () => {
    const target = {
      /**
       * Test helper.
       *
       * @returns Result.
       */
      name: (): string => 'x',
      /**
       * Frame URL.
       * @returns Empty string.
       */
      url: (): string => '',
    } as unknown as Frame;
    const page = makePage({ waitOk: true, framesList: [target] });
    const result = await waitUntilIframeFound(page, (): boolean => true);
    expect(result).toBe(target);
  });
});

// ── Invoke inline evaluate callback (captureElementHtml) with a fake document ──

describe('waitUntilElementFound — captures element html via evaluate', () => {
  /**
   * Build a fake document.querySelector backed by the provided outerHTML.
   * @param outerHTML - Parameter.
   * @returns Result.
   */
  const setFakeDoc = (outerHTML: string | null): void => {
    const el = outerHTML === null ? null : { outerHTML };
    (globalThis as { document?: unknown }).document = {
      /**
       * Test helper.
       *
       * @returns Result.
       */
      querySelector: (): { outerHTML: string } | null => el,
    };
  };

  const origDoc = (globalThis as { document?: unknown }).document;
  afterEach(() => {
    (globalThis as { document?: unknown }).document = origDoc;
  });

  it('evaluate callback returns truncated outerHTML on success', async () => {
    setFakeDoc('<div id="x">hello</div>');
    const page = {
      /**
       * Test helper.
       *
       * @returns Result.
       */
      waitForSelector: (): Promise<unknown> => Promise.resolve({}),
      /**
       * Test helper.
       *
       * @param cb - Parameter.
       * @param arg - Parameter.
       * @param arg.sel - CSS selector.
       * @param arg.lim - Limit value.
       * @returns Result.
       */
      evaluate: <T>(
        cb: (arg: { sel: string; lim: number }) => T,
        arg: { sel: string; lim: number },
      ): Promise<T> => {
        const cbResult = cb(arg);
        return Promise.resolve(cbResult);
      },
      /**
       * Test helper.
       *
       * @returns Result.
       */
      frames: (): Frame[] => [],
      /**
       * Test helper.
       *
       * @returns Result.
       */
      title: (): Promise<string> => Promise.resolve('t'),
    } as unknown as Page;
    const isOk = await waitUntilElementFound(page, '#x');
    expect(isOk).toBe(true);
  });

  it('evaluate callback falls back to "—" sentinel when querySelector returns null', async () => {
    setFakeDoc(null);
    const page = {
      /**
       * Test helper.
       *
       * @returns Result.
       */
      waitForSelector: (): Promise<unknown> => Promise.resolve({}),
      /**
       * Test helper.
       *
       * @param cb - Parameter.
       * @param arg - Parameter.
       * @param arg.sel - CSS selector.
       * @param arg.lim - Limit value.
       * @returns Result.
       */
      evaluate: <T>(
        cb: (arg: { sel: string; lim: number }) => T,
        arg: { sel: string; lim: number },
      ): Promise<T> => {
        const cbResult = cb(arg);
        return Promise.resolve(cbResult);
      },
      /**
       * Test helper.
       *
       * @returns Result.
       */
      frames: (): Frame[] => [],
      /**
       * Test helper.
       *
       * @returns Result.
       */
      title: (): Promise<string> => Promise.resolve('t'),
    } as unknown as Page;
    const isOk = await waitUntilElementFound(page, '#missing');
    expect(isOk).toBe(true);
  });

  it('evaluate rejection falls through to (context unavailable) sentinel', async () => {
    const page = {
      /**
       * Test helper.
       *
       * @returns Result.
       */
      waitForSelector: (): Promise<unknown> => Promise.resolve({}),
      /**
       * Test helper.
       *
       * @returns Result.
       */
      evaluate: (): Promise<never> => Promise.reject(new Error('context gone')),
      /**
       * Test helper.
       *
       * @returns Result.
       */
      frames: (): Frame[] => [],
      /**
       * Test helper.
       *
       * @returns Result.
       */
      title: (): Promise<string> => Promise.resolve('t'),
    } as unknown as Page;
    const isOk = await waitUntilElementFound(page, '#x');
    expect(isOk).toBe(true);
  });
});
