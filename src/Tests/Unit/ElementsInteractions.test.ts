import { jest } from '@jest/globals';
import { type Frame } from 'playwright';

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
import { createMockLocator, createMockPage } from '../MockPage.js';

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
  it('sets input value via locator evaluate', async () => {
    const loc = createMockLocator();
    const page = createMockPage({ locator: jest.fn().mockReturnValue(loc) });
    await setValue(page, '#password', 'secret');
    expect(page.locator).toHaveBeenCalledWith('#password');
    expect(loc.first).toHaveBeenCalled();
    const anyFunction = expect.any(Function) as unknown;
    expect(loc.evaluate).toHaveBeenCalledWith(anyFunction, 'secret');
  });
});

describe('clickButton', () => {
  it('clicks via locator chain', async () => {
    const loc = createMockLocator();
    const page = createMockPage({ locator: jest.fn().mockReturnValue(loc) });
    await clickButton(page, '#submit');
    expect(page.locator).toHaveBeenCalledWith('#submit');
    expect(loc.first).toHaveBeenCalled();
    expect(loc.click).toHaveBeenCalled();
  });
});

describe('clickLink', () => {
  it('clicks link via locator chain', async () => {
    const loc = createMockLocator();
    const page = createMockPage({ locator: jest.fn().mockReturnValue(loc) });
    await clickLink(page, 'a.nav-link');
    expect(page.locator).toHaveBeenCalledWith('a.nav-link');
    expect(loc.first).toHaveBeenCalled();
    expect(loc.click).toHaveBeenCalled();
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
  it('returns result of locator evaluate on selector', async () => {
    const loc = createMockLocator({ evaluate: jest.fn().mockResolvedValue('evaluated') });
    const page = createMockPage({ locator: jest.fn().mockReturnValue(loc) });
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
    expect(page.locator).toHaveBeenCalledWith('.balance');
  });

  it('returns default when element not found', async () => {
    const loc = createMockLocator({
      evaluate: jest
        .fn()
        .mockRejectedValue(new Error('Error: failed to find element matching selector')),
    });
    const page = createMockPage({ locator: jest.fn().mockReturnValue(loc) });
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
    const loc = createMockLocator({
      evaluate: jest.fn().mockRejectedValue(new Error('network error')),
    });
    const page = createMockPage({ locator: jest.fn().mockReturnValue(loc) });
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
  it('returns result of locator evaluateAll on selector', async () => {
    const loc = createMockLocator({ evaluateAll: jest.fn().mockResolvedValue(['a', 'b']) });
    const page = createMockPage({ locator: jest.fn().mockReturnValue(loc) });
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
    expect(page.locator).toHaveBeenCalledWith('.items');
  });

  it('returns default when no elements found', async () => {
    const loc = createMockLocator({
      evaluateAll: jest
        .fn()
        .mockRejectedValue(new Error('Error: failed to find elements matching selector')),
    });
    const page = createMockPage({ locator: jest.fn().mockReturnValue(loc) });
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
    const loc = createMockLocator({
      evaluateAll: jest.fn().mockRejectedValue(new Error('network error')),
    });
    const page = createMockPage({ locator: jest.fn().mockReturnValue(loc) });
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
