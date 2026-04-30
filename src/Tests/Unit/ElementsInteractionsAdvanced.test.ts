import { jest } from '@jest/globals';
import { type Frame } from 'playwright-core';

jest.unstable_mockModule(
  '../../Common/Waiting.js',
  /**
   * Mock Waiting module to avoid real delays in tests.
   * @returns Mocked humanDelay and waitUntil.
   */
  () => ({
    humanDelay: jest.fn().mockResolvedValue(true),
    /**
     * Mock waitUntil that invokes the async test once so closures are populated.
     * @param asyncTest - The polling predicate to invoke once.
     * @returns The result of invoking the async test.
     */
    waitUntil: jest.fn(async (asyncTest: () => Promise<boolean>): Promise<boolean> => {
      return asyncTest();
    }),
  }),
);

jest.unstable_mockModule(
  '../../Common/Debug.js',
  /**
   * Mock Debug module to suppress log output during tests.
   * @returns Mocked getDebug returning a stub logger.
   */
  () => ({
    getDebug: jest.fn().mockReturnValue({
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      trace: jest.fn(),
    }),
  }),
);

const {
  waitUntilElementFound: WAIT_UNTIL_ELEMENT_FOUND,
  waitUntilIframeFound: WAIT_UNTIL_IFRAME_FOUND,
  clickButton: CLICK_BUTTON,
  clickLink: CLICK_LINK,
  pageEval: PAGE_EVAL,
  pageEvalAll: PAGE_EVAL_ALL,
  dropdownSelect: DROPDOWN_SELECT,
  dropdownElements: DROPDOWN_ELEMENTS,
  capturePageText: CAPTURE_PAGE_TEXT,
} = await import('../../Common/ElementsInteractions.js');

import { createMockPage } from '../MockPage.js';

describe('waitUntilElementFound — timeout path', () => {
  it('rethrows when waitForSelector rejects', async () => {
    const page = createMockPage({
      waitForSelector: jest.fn().mockRejectedValue(new Error('Timeout 5000ms')),
      evaluate: jest.fn().mockResolvedValue('page body text'),
    });
    const findPromise = WAIT_UNTIL_ELEMENT_FOUND(page, '#gone', { timeout: 5000 });
    await expect(findPromise).rejects.toThrow('Timeout 5000ms');
  });

  it('returns true on successful element find', async () => {
    const page = createMockPage();
    const isFound = await WAIT_UNTIL_ELEMENT_FOUND(page, '#found');
    expect(isFound).toBe(true);
  });
});

describe('waitUntilIframeFound — edge cases', () => {
  it('throws ScraperError with description when no frame matches', async () => {
    const page = createMockPage();
    page.frames.mockReturnValue([]);
    const iframePromise = WAIT_UNTIL_IFRAME_FOUND(page, () => false, {
      description: 'login iframe',
      timeout: 50,
    });
    await expect(iframePromise).rejects.toThrow('failed to find iframe: login iframe');
  });

  it('returns matched frame when predicate succeeds', async () => {
    /**
     * Stub that returns the expected iframe URL.
     * @returns the iframe URL string.
     */
    const urlFn = (): string => 'https://bank.co.il/iframe';
    const mockFrame = { url: urlFn } as unknown as Frame;
    const page = createMockPage();
    page.frames.mockReturnValue([mockFrame]);
    /**
     * Predicate to match the expected iframe URL.
     * @param frame - the frame to check
     * @returns true when the frame URL matches
     */
    const isMatch = (frame: Frame): boolean => frame.url() === 'https://bank.co.il/iframe';
    const result = await WAIT_UNTIL_IFRAME_FOUND(page, isMatch);
    expect(result).toBe(mockFrame);
  });
});

describe('clickButton — return value', () => {
  it('resolves to true after clicking', async () => {
    const page = createMockPage();
    const isClicked = await CLICK_BUTTON(page, '#submit');
    expect(isClicked).toBe(true);
  });
});

describe('clickLink — return value', () => {
  it('resolves to true after clicking link', async () => {
    const page = createMockPage();
    const isClicked = await CLICK_LINK(page, 'a.next');
    expect(isClicked).toBe(true);
  });
});

describe('pageEval — readyState wait', () => {
  it('waits for document readyState before evaluating', async () => {
    const page = createMockPage();
    page.$eval.mockResolvedValue(42);
    await PAGE_EVAL(page, {
      selector: '.num',
      defaultResult: 0,
      /**
       * Identity callback for testing.
       * @param el - the element
       * @returns the element cast to number
       */
      callback: (el: Element): number => el as unknown as number,
    });
    expect(page.waitForFunction).toHaveBeenCalled();
  });
});

describe('pageEvalAll — readyState wait', () => {
  it('waits for document readyState before evaluating all', async () => {
    const page = createMockPage();
    page.$$eval.mockResolvedValue([1, 2, 3]);
    await PAGE_EVAL_ALL(page, {
      selector: '.items',
      defaultResult: [] as number[],
      /**
       * Identity callback for testing.
       * @param els - the elements
       * @returns the elements cast to numbers
       */
      callback: (els: Element[]): number[] => els as unknown as number[],
    });
    expect(page.waitForFunction).toHaveBeenCalled();
  });
});

describe('dropdownSelect — return value', () => {
  it('resolves to true after selecting option', async () => {
    const page = createMockPage();
    const isSelected = await DROPDOWN_SELECT(page, '#sel', 'opt1');
    expect(isSelected).toBe(true);
  });
});

describe('dropdownElements — empty dropdown', () => {
  it('returns empty array when no options exist', async () => {
    const page = createMockPage();
    page.evaluate.mockResolvedValue([]);
    const options = await DROPDOWN_ELEMENTS(page, '#empty-select');
    expect(options).toEqual([]);
  });
});

describe('capturePageText', () => {
  it('returns truncated page body text', async () => {
    const page = createMockPage();
    page.evaluate.mockResolvedValue('Hello world from bank portal');
    const text = await CAPTURE_PAGE_TEXT(page);
    expect(text).toBe('Hello world from bank portal');
  });

  it('returns fallback string when evaluate fails', async () => {
    const page = createMockPage();
    page.evaluate.mockRejectedValue(new Error('context destroyed'));
    const text = await CAPTURE_PAGE_TEXT(page);
    expect(text).toBe('(context unavailable)');
  });
});
