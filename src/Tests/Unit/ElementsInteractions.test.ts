import { jest } from '@jest/globals';
import { type Frame } from 'playwright-core';

import {
  clickButton,
  clickLink,
  dropdownElements,
  dropdownSelect,
  elementPresentOnPage,
  fillInput,
  pageEval,
  pageEvalAll,
  setValue,
  waitUntilElementDisappear,
  waitUntilElementFound,
  waitUntilIframeFound,
} from '../../Common/ElementsInteractions.js';
import { createMockPage } from '../MockPage.js';

describe('waitUntilElementFound', () => {
  it('calls waitForSelector with selector', async () => {
    const page = createMockPage();
    await waitUntilElementFound(page, '#login-btn');
    expect(page.waitForSelector).toHaveBeenCalledWith('#login-btn', {
      state: 'attached',
      timeout: undefined,
    });
  });

  it('passes onlyVisible and timeout options', async () => {
    const page = createMockPage();
    await waitUntilElementFound(page, '.form', { visible: true, timeout: 5000 });
    expect(page.waitForSelector).toHaveBeenCalledWith('.form', { state: 'visible', timeout: 5000 });
  });
});

describe('waitUntilElementDisappear', () => {
  it('waits for element to be hidden', async () => {
    const page = createMockPage();
    await waitUntilElementDisappear(page, '.spinner', 3000);
    expect(page.waitForSelector).toHaveBeenCalledWith('.spinner', {
      state: 'hidden',
      timeout: 3000,
    });
  });
});

describe('fillInput', () => {
  it('fills input via Playwright fill()', async () => {
    const fill = jest.fn().mockResolvedValue(undefined);
    const first = jest.fn().mockReturnValue({ fill });
    const page = createMockPage({
      locator: jest.fn().mockReturnValue({ first }),
    });
    await fillInput(page, '#username', 'testuser');
    expect(page.locator).toHaveBeenCalledWith('#username');
    expect(fill).toHaveBeenCalledWith('testuser');
  });
});

describe('setValue', () => {
  it('sets input value directly via $eval', async () => {
    const page = createMockPage();
    await setValue(page, '#password', 'secret');
    const anyFn = expect.any(Function) as (...args: never[]) => never;
    expect(page.$eval).toHaveBeenCalledWith('#password', anyFn, ['secret']);
  });
});

describe('clickButton', () => {
  it('calls $eval with click callback', async () => {
    const page = createMockPage();
    await clickButton(page, '#submit');
    const anyFn = expect.any(Function) as (...args: never[]) => never;
    expect(page.$eval).toHaveBeenCalledWith('#submit', anyFn);
  });
});

describe('clickLink', () => {
  it('calls $eval on the link', async () => {
    const page = createMockPage();
    await clickLink(page, 'a.nav-link');
    const anyFn = expect.any(Function) as (...args: never[]) => never;
    expect(page.$eval).toHaveBeenCalledWith('a.nav-link', anyFn);
  });
});

describe('elementPresentOnPage', () => {
  it('returns true when element exists', async () => {
    const page = createMockPage();
    page.$.mockResolvedValue({});
    const isPresent = await elementPresentOnPage(page, '.exists');
    expect(isPresent).toBe(true);
  });

  it('returns false when element does not exist', async () => {
    const page = createMockPage();
    page.$.mockResolvedValue(null);
    const isPresent = await elementPresentOnPage(page, '.missing');
    expect(isPresent).toBe(false);
  });
});

describe('dropdownSelect', () => {
  it('calls page.selectOption with value', async () => {
    const page = createMockPage();
    await dropdownSelect(page, '#account-type', 'savings');
    expect(page.selectOption).toHaveBeenCalledWith('#account-type', 'savings');
  });
});

describe('dropdownElements', () => {
  it('returns option names and values', async () => {
    const page = createMockPage();
    page.evaluate.mockResolvedValue([
      { name: 'Savings', value: 'savings' },
      { name: 'Checking', value: 'checking' },
    ]);
    const result = await dropdownElements(page, '#account-type');
    expect(result).toEqual([
      { name: 'Savings', value: 'savings' },
      { name: 'Checking', value: 'checking' },
    ]);
  });
});

describe('pageEval', () => {
  it('returns result of $eval on selector', async () => {
    const page = createMockPage();
    page.$eval.mockResolvedValue('evaluated');
    const result = await pageEval(page, {
      selector: '.balance',
      defaultResult: '',
      /**
       * Extracts text content from element.
       * @param el - the matched element
       * @returns the text content
       */
      callback: (el: Element): string => (el as HTMLElement).textContent || '',
    });
    expect(result).toBe('evaluated');
  });

  it('returns default when element not found', async () => {
    const page = createMockPage();
    page.$eval.mockRejectedValue(new Error('Error: failed to find element matching selector'));
    const result = await pageEval(page, {
      selector: '.missing',
      defaultResult: 'default',
      /**
       * Extracts text content from element.
       * @param el - the matched element
       * @returns the text content
       */
      callback: (el: Element): string => (el as HTMLElement).textContent || '',
    });
    expect(result).toBe('default');
  });

  it('rethrows non-selector errors', async () => {
    const page = createMockPage();
    page.$eval.mockRejectedValue(new Error('network error'));
    const evalPromise = pageEval(page, {
      selector: '.broken',
      defaultResult: null as Element | null,
      /**
       * Returns the element itself.
       * @param el - the matched element
       * @returns the element
       */
      callback: (el: Element): Element => el,
    });
    await expect(evalPromise).rejects.toThrow('network error');
  });
});

describe('pageEvalAll', () => {
  it('returns result of $$eval on selector', async () => {
    const page = createMockPage();
    page.$$eval.mockResolvedValue(['a', 'b']);
    const result = await pageEvalAll(page, {
      selector: '.items',
      defaultResult: [] as Element[],
      /**
       * Returns the elements array.
       * @param els - the matched elements
       * @returns the elements
       */
      callback: (els: Element[]): Element[] => els,
    });
    expect(result).toEqual(['a', 'b']);
  });

  it('returns default when no elements found', async () => {
    const page = createMockPage();
    page.$$eval.mockRejectedValue(new Error('Error: failed to find elements matching selector'));
    const result = await pageEvalAll(page, {
      selector: '.missing',
      defaultResult: [] as Element[],
      /**
       * Returns the elements array.
       * @param els - the matched elements
       * @returns the elements
       */
      callback: (els: Element[]): Element[] => els,
    });
    expect(result).toEqual([]);
  });

  it('rethrows non-selector errors', async () => {
    const page = createMockPage();
    page.$$eval.mockRejectedValue(new Error('network error'));
    const evalAllPromise = pageEvalAll(page, {
      selector: '.broken',
      defaultResult: [] as Element[],
      /**
       * Returns the elements array.
       * @param els - the matched elements
       * @returns the elements
       */
      callback: (els: Element[]): Element[] => els,
    });
    await expect(evalAllPromise).rejects.toThrow('network error');
  });
});

describe('waitUntilIframeFound', () => {
  it('resolves when matching frame is found', async () => {
    /**
     * Returns the mock iframe URL.
     * @returns the iframe URL string
     */
    const urlFn = (): string => 'https://bank.co.il/iframe';
    const mockFrame = { url: urlFn } as unknown as Frame;
    const page = createMockPage();
    page.frames.mockReturnValue([mockFrame]);
    /**
     * Checks whether the frame matches the expected iframe URL.
     * @param frame - the frame to check
     * @returns true when the frame URL matches
     */
    const isIframeMatch = (frame: Frame): boolean => frame.url() === 'https://bank.co.il/iframe';
    const result = await waitUntilIframeFound(page, isIframeMatch, {
      description: 'test',
      timeout: 5000,
    });
    expect(result).toBe(mockFrame);
  });

  it('throws when frame is not found within timeout', async () => {
    const page = createMockPage();
    page.frames.mockReturnValue([]);
    const iframePromise = waitUntilIframeFound(page, () => false, {
      description: 'missing frame',
      timeout: 100,
    });
    await expect(iframePromise).rejects.toThrow();
  });
});
