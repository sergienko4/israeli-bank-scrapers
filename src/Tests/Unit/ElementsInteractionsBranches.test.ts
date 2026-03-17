import { jest } from '@jest/globals';
import type { Page } from 'playwright-core';

jest.unstable_mockModule('../../Common/Debug.js', () => ({
  /**
   * Creates a mock debug logger.
   * @returns A mock debug logger object.
   */
  getDebug: (): Record<string, jest.Mock> => ({
    trace: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
  /**
   * Passthrough mock for bank context.
   * @param _b - Bank name (unused).
   * @param fn - Function to execute.
   * @returns fn result.
   */
  runWithBankContext: <T>(_b: string, fn: () => T): T => fn(),
}));

jest.unstable_mockModule('../../Common/Waiting.js', () => ({
  sleep: jest.fn().mockResolvedValue(undefined),
  humanDelay: jest.fn().mockResolvedValue(undefined),
  waitUntil: jest.fn().mockResolvedValue(undefined),
  raceTimeout: jest.fn().mockResolvedValue(undefined),
  runSerial: jest.fn().mockResolvedValue([]),
  TimeoutError: class TimeoutError extends Error {},
  SECOND: 1000,
}));

const ELEMENTS_MOD = await import('../../Common/ElementsInteractions.js');

/**
 * Creates a mock page for error branch tests.
 * @param overrides - Optional mock method overrides.
 * @returns A mock page.
 */
function makePage(overrides: Record<string, jest.Mock> = {}): Page {
  const defaultLocator = {
    first: jest.fn().mockReturnValue({
      fill: jest.fn().mockResolvedValue(undefined),
      click: jest.fn().mockResolvedValue(undefined),
      evaluate: jest.fn().mockResolvedValue(undefined),
      count: jest.fn().mockResolvedValue(0),
    }),
    count: jest.fn().mockResolvedValue(0),
    evaluateAll: jest.fn().mockResolvedValue([]),
  };
  return {
    waitForSelector: jest.fn().mockResolvedValue(undefined),
    waitForFunction: jest.fn().mockResolvedValue(undefined),
    evaluate: jest.fn().mockResolvedValue(undefined),
    locator: jest.fn().mockReturnValue(defaultLocator),
    selectOption: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as Page;
}

// ── waitUntilElementFound — timeout catch branch ─────────────────────────────

describe('waitUntilElementFound — timeout path', () => {
  it('rethrows when waitForSelector times out and captures page text', async () => {
    const page = makePage({
      waitForSelector: jest.fn().mockRejectedValue(new Error('Timeout')),
      evaluate: jest.fn().mockResolvedValue('page body text'),
    });

    const waitPromise = ELEMENTS_MOD.waitUntilElementFound(page, '#missing', { timeout: 100 });
    await expect(waitPromise).rejects.toThrow('Timeout');
  });
});

// ── capturePageText — error fallback ─────────────────────────────────────────

describe('capturePageText — error fallback', () => {
  it('returns fallback text when evaluate throws', async () => {
    const page = makePage({
      evaluate: jest.fn().mockRejectedValue(new Error('context destroyed')),
    });

    const text = await ELEMENTS_MOD.capturePageText(page);
    expect(text).toBe('(context unavailable)');
  });
});

// ── pageEval — error catch branch ────────────────────────────────────────────

describe('pageEval — error catch branch', () => {
  it('returns defaultResult when waitForFunction throws', async () => {
    const page = makePage({
      waitForFunction: jest.fn().mockRejectedValue(new Error('Execution context was destroyed')),
    });

    const result = await ELEMENTS_MOD.pageEval(page, {
      selector: '.balance',
      defaultResult: 'fallback',
      /**
       * Extracts text content.
       * @param el - the matched element
       * @returns the text content
       */
      callback: (el: Element): string => el.textContent,
    });
    expect(result).toBe('fallback');
  });

  it('returns defaultResult when locator evaluate throws', async () => {
    const evalMock = jest.fn().mockRejectedValue(new Error('detached'));
    const page = makePage({
      waitForFunction: jest.fn().mockResolvedValue(undefined),
      locator: jest.fn().mockReturnValue({
        first: jest.fn().mockReturnValue({ evaluate: evalMock }),
        count: jest.fn().mockResolvedValue(1),
      }),
    });

    const result = await ELEMENTS_MOD.pageEval(page, {
      selector: '.data',
      defaultResult: 'default',
      /**
       * Identity callback.
       * @param el - the matched element
       * @returns the text content
       */
      callback: (el: Element): string => el.textContent,
    });
    expect(result).toBe('default');
  });
});

// ── pageEvalAll — error catch branch ─────────────────────────────────────────

describe('pageEvalAll — error catch branch', () => {
  it('returns defaultResult when waitForFunction throws', async () => {
    const page = makePage({
      waitForFunction: jest.fn().mockRejectedValue(new Error('destroyed')),
    });

    const result = await ELEMENTS_MOD.pageEvalAll(page, {
      selector: '.items',
      defaultResult: [] as string[],
      /**
       * Returns text array.
       * @param els - the matched elements
       * @returns mapped text array
       */
      callback: (els: Element[]): string[] => els.map(e => e.textContent),
    });
    expect(result).toEqual([]);
  });

  it('returns defaultResult when evaluateAll throws', async () => {
    const page = makePage({
      waitForFunction: jest.fn().mockResolvedValue(undefined),
      locator: jest.fn().mockReturnValue({
        count: jest.fn().mockResolvedValue(3),
        evaluateAll: jest.fn().mockRejectedValue(new Error('detached')),
      }),
    });

    const result = await ELEMENTS_MOD.pageEvalAll(page, {
      selector: '.rows',
      defaultResult: [] as string[],
      /**
       * Returns text array.
       * @param els - the matched elements
       * @returns mapped text array
       */
      callback: (els: Element[]): string[] => els.map(e => e.textContent),
    });
    expect(result).toEqual([]);
  });
});
