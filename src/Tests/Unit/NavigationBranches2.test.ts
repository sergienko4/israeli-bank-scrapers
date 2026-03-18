/**
 * Additional branch coverage tests for Navigation.ts.
 * Targets: getCurrentUrl isClientSide branch,
 * waitForRedirect timeout path, waitForUrl timeout path,
 * pollForRedirect ignoreList branch, safeGetUrl error catch.
 */
import { jest } from '@jest/globals';

import ScraperError from '../../Scrapers/Base/ScraperError.js';
import { createDebugMock } from '../MockModuleFactories.js';

jest.unstable_mockModule('../../Common/Debug.js', createDebugMock);

const NAV = await import('../../Common/Navigation.js');

/** Default timeout for redirect/url polling tests (ms). */
const POLL_TIMEOUT_MS = 5000;
/** Short timeout to trigger timeout errors quickly (ms). */
const SHORT_TIMEOUT_MS = 500;
/** Bank login URL used across tests. */
const LOGIN_URL = 'https://bank.co.il/login';
/** Bank dashboard URL used across tests. */
const DASHBOARD_URL = 'https://bank.co.il/dashboard';
/** Bank SPA URL used for client-side tests. */
const SPA_URL = 'https://bank.co.il/spa';
/** Intermediate processing URL for ignoreList tests. */
const PROCESSING_URL = 'https://bank.co.il/processing';

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
 * Create a mock page whose url() changes from initial to target.
 * @param initial - URL returned on the first call.
 * @param target - URL returned on subsequent calls.
 * @returns Mock page object with changing url().
 */
function makeChangingUrlPage(initial: string, target: string): Record<string, jest.Mock> {
  let callCount = 0;
  return makeMockPage({
    url: jest.fn().mockImplementation((): string => {
      callCount += 1;
      return callCount > 1 ? target : initial;
    }),
  });
}

/**
 * Create a mock page that cycles through provided URLs.
 * @param urls - Sequence of URLs; last URL repeats indefinitely.
 * @returns Mock page object.
 */
function makeMultiUrlPage(urls: readonly string[]): Record<string, jest.Mock> {
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
    const page = makeMockPage({
      url: jest.fn().mockReturnValue('https://bank.co.il/home'),
    });
    const result = NAV.getCurrentUrl(page as never, false);
    expect(result).toBe('https://bank.co.il/home');
  });

  it('calls evaluate for client-side URL', async () => {
    const page = makeMockPage({
      evaluate: jest.fn().mockResolvedValue(SPA_URL),
    });
    const result = await NAV.getCurrentUrl(page as never, true);
    expect(result).toBe(SPA_URL);
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
    expect(page.waitForURL).toHaveBeenCalledWith('**', {
      waitUntil: 'domcontentloaded',
    });
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
    const page = makeChangingUrlPage(LOGIN_URL, DASHBOARD_URL);
    const didRedirect = await NAV.waitForRedirect(page as never);
    expect(didRedirect).toBe(true);
  });

  it('resolves with explicit isClientSide and timeout', async () => {
    const page = makeChangingUrlPage(LOGIN_URL, DASHBOARD_URL);
    const didRedirect = await NAV.waitForRedirect(page as never, {
      timeout: POLL_TIMEOUT_MS,
      isClientSide: false,
    });
    expect(didRedirect).toBe(true);
  });

  it('throws on timeout when URL never changes', async () => {
    const page = makeMockPage({
      url: jest.fn().mockReturnValue(LOGIN_URL),
    });
    const promise = NAV.waitForRedirect(page as never, {
      timeout: SHORT_TIMEOUT_MS,
    });
    await expect(promise).rejects.toThrow();
  });

  it('skips ignored URL and resolves on final redirect', async () => {
    const page = makeMultiUrlPage([LOGIN_URL, LOGIN_URL, PROCESSING_URL, DASHBOARD_URL]);
    const didRedirect = await NAV.waitForRedirect(page as never, {
      ignoreList: [PROCESSING_URL],
      timeout: POLL_TIMEOUT_MS,
    });
    expect(didRedirect).toBe(true);
  });
});

describe('waitForUrl', () => {
  it('resolves when URL matches string target', async () => {
    const target = 'https://bank.co.il/target';
    const page = makeChangingUrlPage('https://bank.co.il/loading', target);
    const didMatch = await NAV.waitForUrl(page as never, target);
    expect(didMatch).toBe(true);
  });

  it('resolves when URL matches regex target', async () => {
    const page = makeChangingUrlPage(
      'https://bank.co.il/loading',
      'https://bank.co.il/dashboard/123',
    );
    const didMatchRegex = await NAV.waitForUrl(page as never, /dashboard\/\d+/, {
      timeout: POLL_TIMEOUT_MS,
    });
    expect(didMatchRegex).toBe(true);
  });

  it('throws on timeout when URL never matches', async () => {
    const page = makeMockPage({
      url: jest.fn().mockReturnValue('https://bank.co.il/stuck'),
    });
    const promise = NAV.waitForUrl(page as never, 'https://bank.co.il/target', {
      timeout: SHORT_TIMEOUT_MS,
    });
    await expect(promise).rejects.toThrow();
  });
});

describe('safeGetUrl — error catch path', () => {
  it('returns ? when getCurrentUrl throws', async () => {
    const page = makeMockPage({
      url: jest.fn().mockImplementation(() => {
        throw new ScraperError('detached');
      }),
      evaluate: jest.fn().mockRejectedValue(new Error('detached')),
    });
    const promise = NAV.waitForRedirect(page as never, {
      timeout: SHORT_TIMEOUT_MS,
    });
    await expect(promise).rejects.toThrow();
  });
});
