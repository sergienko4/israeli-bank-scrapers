import {
  waitUntilElementFound,
  waitUntilElementDisappear,
  fillInput,
  setValue,
  clickButton,
  clickLink,
  elementPresentOnPage,
  dropdownSelect,
  dropdownElements,
  pageEval,
  pageEvalAll,
  waitUntilIframeFound,
} from './elements-interactions';
import { createMockPage } from '../tests/mock-page';
import { type Frame } from 'playwright';

describe('waitUntilElementFound', () => {
  it('calls waitForSelector with selector', async () => {
    const page = createMockPage();
    await waitUntilElementFound(page, '#login-btn');
    expect(page.waitForSelector).toHaveBeenCalledWith('#login-btn', { state: 'attached', timeout: undefined });
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
    expect(page.waitForSelector).toHaveBeenCalledWith('.spinner', { state: 'hidden', timeout: 3000 });
  });
});

describe('fillInput', () => {
  it('clears input value then types new value', async () => {
    const page = createMockPage();
    await fillInput(page, '#username', 'testuser');
    expect(page.$eval).toHaveBeenCalledWith('#username', expect.any(Function));
    expect(page.type).toHaveBeenCalledWith(
      '#username',
      'testuser',
      expect.objectContaining({ delay: expect.any(Number) as number }),
    );
  });
});

describe('setValue', () => {
  it('sets input value directly via $eval', async () => {
    const page = createMockPage();
    await setValue(page, '#password', 'secret');
    expect(page.$eval).toHaveBeenCalledWith('#password', expect.any(Function), ['secret']);
  });
});

describe('clickButton', () => {
  it('calls $eval with click callback', async () => {
    const page = createMockPage();
    await clickButton(page, '#submit');
    expect(page.$eval).toHaveBeenCalledWith('#submit', expect.any(Function));
  });
});

describe('clickLink', () => {
  it('calls $eval on the link', async () => {
    const page = createMockPage();
    await clickLink(page, 'a.nav-link');
    expect(page.$eval).toHaveBeenCalledWith('a.nav-link', expect.any(Function));
  });
});

describe('elementPresentOnPage', () => {
  it('returns true when element exists', async () => {
    const page = createMockPage();
    page.$.mockResolvedValue({});
    const result = await elementPresentOnPage(page, '.exists');
    expect(result).toBe(true);
  });

  it('returns false when element does not exist', async () => {
    const page = createMockPage();
    page.$.mockResolvedValue(null);
    const result = await elementPresentOnPage(page, '.missing');
    expect(result).toBe(false);
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
      callback: (el: Element) => (el as HTMLElement).textContent ?? '',
    });
    expect(result).toBe('evaluated');
  });

  it('returns default when element not found', async () => {
    const page = createMockPage();
    page.$eval.mockRejectedValue(new Error('Error: failed to find element matching selector'));
    const result = await pageEval(page, {
      selector: '.missing',
      defaultResult: 'default',
      callback: (el: Element) => (el as HTMLElement).textContent ?? '',
    });
    expect(result).toBe('default');
  });

  it('rethrows non-selector errors', async () => {
    const page = createMockPage();
    page.$eval.mockRejectedValue(new Error('network error'));
    await expect(
      pageEval(page, { selector: '.broken', defaultResult: null as Element | null, callback: (el: Element) => el }),
    ).rejects.toThrow('network error');
  });
});

describe('pageEvalAll', () => {
  it('returns result of $$eval on selector', async () => {
    const page = createMockPage();
    page.$$eval.mockResolvedValue(['a', 'b']);
    const result = await pageEvalAll(page, {
      selector: '.items',
      defaultResult: [] as Element[],
      callback: (els: Element[]) => els,
    });
    expect(result).toEqual(['a', 'b']);
  });

  it('returns default when no elements found', async () => {
    const page = createMockPage();
    page.$$eval.mockRejectedValue(new Error('Error: failed to find elements matching selector'));
    const result = await pageEvalAll(page, {
      selector: '.missing',
      defaultResult: [] as Element[],
      callback: (els: Element[]) => els,
    });
    expect(result).toEqual([]);
  });

  it('rethrows non-selector errors', async () => {
    const page = createMockPage();
    page.$$eval.mockRejectedValue(new Error('network error'));
    await expect(
      pageEvalAll(page, { selector: '.broken', defaultResult: [] as Element[], callback: (els: Element[]) => els }),
    ).rejects.toThrow('network error');
  });
});

describe('waitUntilIframeFound', () => {
  it('resolves when matching frame is found', async () => {
    const mockFrame = { url: () => 'https://bank.co.il/iframe' } as unknown as Frame;
    const page = createMockPage();
    page.frames.mockReturnValue([mockFrame]);
    const result = await waitUntilIframeFound(page, (f: Frame) => f.url() === 'https://bank.co.il/iframe', {
      description: 'test',
      timeout: 5000,
    });
    expect(result).toBe(mockFrame);
  });

  it('throws when frame is not found within timeout', async () => {
    const page = createMockPage();
    page.frames.mockReturnValue([]);
    await expect(
      waitUntilIframeFound(page, () => false, { description: 'missing frame', timeout: 100 }),
    ).rejects.toThrow();
  });
});
