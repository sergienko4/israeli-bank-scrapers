/**
 * Additional branch coverage tests for Navigation.ts.
 * Targets: getCurrentUrl isClientSide branch,
 * waitForRedirect timeout path, waitForUrl timeout path,
 * pollForRedirect ignoreList branch.
 */
import { jest } from '@jest/globals';

import { createDebugMock } from '../MockModuleFactories.js';

jest.unstable_mockModule('../../Common/Debug.js', createDebugMock);

const NAV = await import('../../Common/Navigation.js');

/**
 * Create a mock page with optional method overrides.
 * @param overrides - Partial mock methods to merge.
 * @returns Mock page object.
 */
function makeMockPage(overrides: Record<string, jest.Mock> = {}): Record<string, jest.Mock> {
  return {
    url: jest.fn().mockReturnValue('about:blank'),
    evaluate: jest.fn().mockResolvedValue(''),
    waitForURL: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

/**
 * Create a mock page whose url() returns initial on first call, then target.
 * @param initial - URL returned on the first call.
 * @param target - URL returned on subsequent calls.
 * @returns Mock page object with changing url().
 */
function createChangingUrlPage(initial: string, target: string): Record<string, jest.Mock> {
  let callCount = 0;
  return makeMockPage({
    url: jest.fn().mockImplementation((): string => {
      callCount += 1;
      return callCount > 1 ? target : initial;
    }),
  });
}

/**
 * Create a mock page that cycles through provided URLs on each url() call.
 * @param urls - Sequence of URLs to return; last URL repeats indefinitely.
 * @returns Mock page object.
 */
function createMultiUrlPage(urls: readonly string[]): Record<string, jest.Mock> {
  let idx = 0;
  return makeMockPage({
    url: jest.fn().mockImplementation((): string => {
      const current = urls[Math.min(idx, urls.length - 1)];
      idx += 1;
      return current;
    }),
  });
}

describe('getCurrentUrl', () => {
  it('returns url() directly when isClientSide is false', () => {
    const page = makeMockPage({ url: jest.fn().mockReturnValue('https://bank.co.il/home') });
    const result = NAV.getCurrentUrl(page as never, false);
    expect(result).toBe('https://bank.co.il/home');
  });

  it('calls evaluate for client-side URL when isClientSide is true', async () => {
    const page = makeMockPage({
      evaluate: jest.fn().mockResolvedValue('https://bank.co.il/spa'),
    });
    const result = await NAV.getCurrentUrl(page as never, true);
    expect(result).toBe('https://bank.co.il/spa');
    expect(page.evaluate).toHaveBeenCalled();
  });
});

describe('waitForNavigation', () => {
  it('calls waitForURL with provided options', async () => {
    const page = makeMockPage();
    const didNavigate = await NAV.waitForNavigation(page as never, {
      waitUntil: 'domcontentloaded',
    });
    expect(didNavigate).toBe(true);
    expect(page.waitForURL).toHaveBeenCalledWith('**', { waitUntil: 'domcontentloaded' });
  });
});

describe('waitForNavigationAndDomLoad', () => {
  it('waits with domcontentloaded', async () => {
    const page = makeMockPage();
    const didLoad = await NAV.waitForNavigationAndDomLoad(page as never);
    expect(didLoad).toBe(true);
  });
});

describe('waitForRedirect', () => {
  it('resolves when URL changes with default opts', async () => {
    const page = createChangingUrlPage('https://bank.co.il/login', 'https://bank.co.il/dashboard');
    const didRedirect = await NAV.waitForRedirect(page as never);
    expect(didRedirect).toBe(true);
  });

  it('resolves with explicit isClientSide and timeout options', async () => {
    const page = createChangingUrlPage('https://bank.co.il/login', 'https://bank.co.il/dashboard');
    const didRedirect = await NAV.waitForRedirect(page as never, {
      timeout: 5000,
      isClientSide: false,
    });
    expect(didRedirect).toBe(true);
  });

  it('throws on timeout when URL never changes', async () => {
    const page = makeMockPage({ url: jest.fn().mockReturnValue('https://bank.co.il/login') });
    const promise = NAV.waitForRedirect(page as never, { timeout: 500 });
    await expect(promise).rejects.toThrow();
  });

  it('skips ignored intermediate URL and resolves on final redirect', async () => {
    const page = createMultiUrlPage([
      'https://bank.co.il/login', // call 1: captured as initial
      'https://bank.co.il/processing', // call 2: in ignoreList → keep waiting
      'https://bank.co.il/dashboard', // call 3+: not in ignoreList → done
    ]);
    const didRedirect = await NAV.waitForRedirect(page as never, {
      ignoreList: ['https://bank.co.il/processing'],
      timeout: 5000,
    });
    expect(didRedirect).toBe(true);
  });
});

describe('waitForUrl', () => {
  it('resolves when URL matches string target with default opts', async () => {
    const page = createChangingUrlPage('https://bank.co.il/loading', 'https://bank.co.il/target');
    const didMatch = await NAV.waitForUrl(page as never, 'https://bank.co.il/target');
    expect(didMatch).toBe(true);
  });

  it('resolves when URL matches regex target', async () => {
    const page = createChangingUrlPage(
      'https://bank.co.il/loading',
      'https://bank.co.il/dashboard/123',
    );
    const didMatchRegex = await NAV.waitForUrl(page as never, /dashboard\/\d+/, { timeout: 5000 });
    expect(didMatchRegex).toBe(true);
  });

  it('throws on timeout when URL never matches', async () => {
    const page = makeMockPage({ url: jest.fn().mockReturnValue('https://bank.co.il/stuck') });
    const promise = NAV.waitForUrl(page as never, 'https://bank.co.il/target', { timeout: 500 });
    await expect(promise).rejects.toThrow();
  });
});
