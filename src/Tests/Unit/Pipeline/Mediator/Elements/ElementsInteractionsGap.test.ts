/**
 * Unit tests for ElementsInteractions branch/fn gaps.
 */

import type { Frame, Page } from 'playwright-core';

import {
  captureElementHtml,
  capturePageText,
  clickButton,
  clickLink,
  elementPresentOnPage,
} from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementsInteractions.js';

/**
 * Build a page stub whose evaluate returns a fixed value.
 * @param val - Value to resolve.
 * @returns Stub page.
 */
function makePageEval(val: unknown): Page {
  return {
    /**
     * evaluate returns val.
     * @returns Resolved val.
     */
    evaluate: (): Promise<unknown> => Promise.resolve(val),
    /**
     * locator returns a stub with count + click.
     * @returns Locator stub.
     */
    locator: (): {
      first: () => { click: () => Promise<boolean> };
      count: () => Promise<number>;
    } => ({
      /**
       * first returns click stub.
       * @returns Click stub.
       */
      first: (): { click: () => Promise<boolean> } => ({
        /**
         * click stub.
         * @returns Resolved.
         */
        click: (): Promise<boolean> => Promise.resolve(true),
      }),
      /**
       * count returns 1.
       * @returns 1.
       */
      count: (): Promise<number> => Promise.resolve(1),
    }),
  } as unknown as Page;
}

/**
 * Build a rejecting page stub.
 * @returns Stub page that rejects.
 */
function makePageReject(): Page {
  return {
    /**
     * evaluate rejects.
     * @returns Rejected promise.
     */
    evaluate: (): Promise<never> => Promise.reject(new Error('ctx-unavailable')),
  } as unknown as Page;
}

describe('capturePageText', () => {
  it('resolves to truncated text', async () => {
    const p = makePageEval('hello world');
    const result = await capturePageText(p);
    expect(result).toBe('hello world');
  });

  it('resolves to fallback on evaluate rejection', async () => {
    const p = makePageReject();
    const result = await capturePageText(p);
    expect(result).toContain('context unavailable');
  });
});

describe('captureElementHtml', () => {
  it('returns truncated HTML for matched element', async () => {
    const p = makePageEval('<div>x</div>');
    const result = await captureElementHtml(p as unknown as Frame, 'div');
    expect(result).toBe('<div>x</div>');
  });

  it('returns fallback on evaluate rejection', async () => {
    const p = makePageReject();
    const result = await captureElementHtml(p as unknown as Frame, 'div');
    expect(result).toContain('context unavailable');
  });
});

describe('clickButton', () => {
  it('returns true after click', async () => {
    const p = makePageEval(null);
    const isOk = await clickButton(p as unknown as Frame, 'button');
    expect(isOk).toBe(true);
  }, 5000);
});

describe('clickLink', () => {
  it('returns true after click', async () => {
    const p = makePageEval(null);
    const isOk = await clickLink(p, 'a');
    expect(isOk).toBe(true);
  });
});

describe('elementPresentOnPage', () => {
  it('returns true when count > 0', async () => {
    const p = makePageEval(null);
    const isOk = await elementPresentOnPage(p as unknown as Frame, 'div');
    expect(isOk).toBe(true);
  });

  it('returns false when count is 0', async () => {
    const page = {
      /**
       * locator returns 0 count.
       * @returns 0 count stub.
       */
      locator: (): { count: () => Promise<number> } => ({
        /**
         * 0 count.
         * @returns 0.
         */
        count: (): Promise<number> => Promise.resolve(0),
      }),
    } as unknown as Page;
    const isOk = await elementPresentOnPage(page as unknown as Frame, 'div');
    expect(isOk).toBe(false);
  });
});
