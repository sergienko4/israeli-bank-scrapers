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
    await fillInput(page, '#username', 'fixt-u-7c2f3e9a');
    expect(page.locator).toHaveBeenCalledWith('#username');
    expect(fill).toHaveBeenCalledWith('fixt-u-7c2f3e9a');
  });
});

describe('setValue', () => {
  it('sets input value via locator evaluate', async () => {
    const evaluate = jest.fn().mockResolvedValue(undefined);
    const first = jest.fn().mockReturnValue({ evaluate });
    const page = createMockPage({
      locator: jest.fn().mockReturnValue({ first }),
    });
    await setValue(page, '#password', 'secret');
    expect(page.locator).toHaveBeenCalledWith('#password');
    const anyFunction = expect.any(Function) as unknown;
    expect(evaluate).toHaveBeenCalledWith(anyFunction, 'secret');
  });
});

describe('clickButton', () => {
  it('clicks via locator', async () => {
    const click = jest.fn().mockResolvedValue(undefined);
    const first = jest.fn().mockReturnValue({ click });
    const page = createMockPage({
      locator: jest.fn().mockReturnValue({ first }),
    });
    await clickButton(page, '#submit');
    expect(page.locator).toHaveBeenCalledWith('#submit');
    expect(click).toHaveBeenCalled();
  });
});

describe('clickLink', () => {
  it('clicks link via locator', async () => {
    const click = jest.fn().mockResolvedValue(undefined);
    const first = jest.fn().mockReturnValue({ click });
    const page = createMockPage({
      locator: jest.fn().mockReturnValue({ first }),
    });
    await clickLink(page, 'a.nav-link');
    expect(page.locator).toHaveBeenCalledWith('a.nav-link');
    expect(click).toHaveBeenCalled();
  });
});

describe('elementPresentOnPage', () => {
  it('returns true when element exists', async () => {
    const count = jest.fn().mockResolvedValue(1);
    const page = createMockPage({
      locator: jest.fn().mockReturnValue({ count }),
    });
    const isPresent = await elementPresentOnPage(page, '.exists');
    expect(isPresent).toBe(true);
  });

  it('returns false when element does not exist', async () => {
    const count = jest.fn().mockResolvedValue(0);
    const page = createMockPage({
      locator: jest.fn().mockReturnValue({ count }),
    });
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
  it('returns result of locator evaluate on selector', async () => {
    const evaluate = jest.fn().mockResolvedValue('evaluated');
    const first = jest.fn().mockReturnValue({ evaluate });
    const count = jest.fn().mockResolvedValue(1);
    const page = createMockPage({
      locator: jest.fn().mockReturnValue({ first, count }),
    });
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
    const evaluate = jest.fn().mockRejectedValue(new Error('locator resolved to no elements'));
    const first = jest.fn().mockReturnValue({ evaluate });
    const count = jest.fn().mockResolvedValue(0);
    const page = createMockPage({
      locator: jest.fn().mockReturnValue({ first, count }),
    });
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
});

describe('pageEvalAll', () => {
  it('returns result of locator evaluateAll on selector', async () => {
    const evaluateAll = jest.fn().mockResolvedValue(['a', 'b']);
    const count = jest.fn().mockResolvedValue(2);
    const page = createMockPage({
      locator: jest.fn().mockReturnValue({ evaluateAll, count }),
    });
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
    const evaluateAll = jest.fn().mockRejectedValue(new Error('no elements'));
    const count = jest.fn().mockResolvedValue(0);
    const page = createMockPage({
      locator: jest.fn().mockReturnValue({ evaluateAll, count }),
    });
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
