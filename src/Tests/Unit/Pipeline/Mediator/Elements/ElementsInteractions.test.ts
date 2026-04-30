/**
 * Unit tests for ElementsInteractions — capture, click, presence helpers.
 */

import type { Locator, Page } from 'playwright-core';

import {
  captureElementHtml,
  capturePageText,
  clickButton,
  clickLink,
  elementPresentOnPage,
} from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementsInteractions.js';

/**
 * Build a mock Page whose locator is a stub with click/count.
 * @param count - Element count from locator.
 * @param clickThrows - Whether click rejects.
 * @returns Mock Page.
 */
function makePage(count = 1, clickThrows = false): Page {
  const loc = {
    /**
     * first.
     * @returns Self.
     */
    first(): Locator {
      return this as unknown as Locator;
    },
    /**
     * count.
     * @returns Scripted count.
     */
    count(): Promise<number> {
      return Promise.resolve(count);
    },
    /**
     * click.
     * @returns Scripted.
     */
    click(): Promise<boolean> {
      if (clickThrows) return Promise.reject(new Error('click fail'));
      return Promise.resolve(true);
    },
  };
  return {
    /**
     * locator.
     * @returns Stub locator.
     */
    locator: (): Locator => loc as unknown as Locator,
    /**
     * evaluate.
     * @returns Scripted.
     */
    evaluate: (): Promise<string> => Promise.resolve('body text'),
  } as unknown as Page;
}

describe('capturePageText', () => {
  it('returns evaluated body text', async () => {
    const makePageResult1 = makePage();
    const text = await capturePageText(makePageResult1);
    expect(typeof text).toBe('string');
  });

  it('returns fallback when evaluate rejects', async () => {
    const page = {
      /**
       * evaluate rejects.
       * @returns Rejected.
       */
      evaluate: (): Promise<never> => Promise.reject(new Error('no ctx')),
    } as unknown as Page;
    const text = await capturePageText(page);
    expect(text).toBe('(context unavailable)');
  });
});

describe('captureElementHtml', () => {
  it('returns outer HTML via evaluate', async () => {
    const makePageResult2 = makePage();
    const html = await captureElementHtml(makePageResult2, '#u');
    expect(typeof html).toBe('string');
  });

  it('returns fallback on evaluate rejection', async () => {
    const page = {
      /**
       * evaluate rejects.
       * @returns Rejected.
       */
      evaluate: (): Promise<never> => Promise.reject(new Error('fail')),
    } as unknown as Page;
    const html = await captureElementHtml(page, '#u');
    expect(html).toBe('(context unavailable)');
  });
});

describe('clickButton', () => {
  it('clicks and returns true', async () => {
    const makePageResult3 = makePage(1);
    const isOk = await clickButton(makePageResult3, '#btn');
    expect(isOk).toBe(true);
  });
});

describe('clickLink', () => {
  it('clicks anchor and returns true', async () => {
    const makePageResult4 = makePage(1);
    const isOk = await clickLink(makePageResult4, 'a');
    expect(isOk).toBe(true);
  });
});

describe('elementPresentOnPage', () => {
  it('returns true when count > 0', async () => {
    const makePageResult5 = makePage(2);
    const isPresent = await elementPresentOnPage(makePageResult5, '#x');
    expect(isPresent).toBe(true);
  });
  it('returns false when count is 0', async () => {
    const makePageResult6 = makePage(0);
    const isPresent = await elementPresentOnPage(makePageResult6, '#x');
    expect(isPresent).toBe(false);
  });
});
