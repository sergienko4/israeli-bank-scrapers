/**
 * Additional branch coverage tests for Navigation.ts.
 * Targets: getCurrentUrl isClientSide branch, safeGetUrl error catch,
 * waitForRedirect timeout path, waitForUrl timeout path,
 * pollForRedirect ignoreList branch.
 */
import { jest } from '@jest/globals';

jest.unstable_mockModule('../../Common/Debug.js', () => ({
  /**
   * Creates a mock debug logger.
   * @returns mock debug logger.
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

const NAV = await import('../../Common/Navigation.js');

describe('getCurrentUrl', () => {
  it('returns url() directly when isClientSide is false', () => {
    const page = {
      url: jest.fn().mockReturnValue('https://bank.co.il/home'),
    };
    const result = NAV.getCurrentUrl(page as never, false);
    expect(result).toBe('https://bank.co.il/home');
  });

  it('calls evaluate for client-side URL when isClientSide is true', async () => {
    const page = {
      evaluate: jest.fn().mockResolvedValue('https://bank.co.il/spa'),
    };
    const result = await NAV.getCurrentUrl(page as never, true);
    expect(result).toBe('https://bank.co.il/spa');
    expect(page.evaluate).toHaveBeenCalled();
  });
});

describe('waitForNavigation', () => {
  it('calls waitForURL with provided options', async () => {
    const page = {
      waitForURL: jest.fn().mockResolvedValue(undefined),
    };
    const didNavigate = await NAV.waitForNavigation(page as never, {
      waitUntil: 'domcontentloaded',
    });
    expect(didNavigate).toBe(true);
    expect(page.waitForURL).toHaveBeenCalledWith('**', { waitUntil: 'domcontentloaded' });
  });
});

describe('waitForNavigationAndDomLoad', () => {
  it('waits with domcontentloaded', async () => {
    const page = {
      waitForURL: jest.fn().mockResolvedValue(undefined),
    };
    const didLoad = await NAV.waitForNavigationAndDomLoad(page as never);
    expect(didLoad).toBe(true);
  });
});

describe('waitForRedirect', () => {
  it('resolves when URL changes', async () => {
    let callCount = 0;
    const page = {
      /**
       * Returns URL that changes after first call.
       * @returns changing URL string.
       */
      url: jest.fn().mockImplementation((): string => {
        callCount += 1;
        return callCount > 1 ? 'https://bank.co.il/dashboard' : 'https://bank.co.il/login';
      }),
    };
    const didRedirect = await NAV.waitForRedirect(page as never, { timeout: 5000 });
    expect(didRedirect).toBe(true);
  });

  it('throws on timeout when URL never changes', async () => {
    const page = {
      url: jest.fn().mockReturnValue('https://bank.co.il/login'),
    };
    const promise = NAV.waitForRedirect(page as never, { timeout: 500 });
    await expect(promise).rejects.toThrow();
  });
});

describe('waitForUrl', () => {
  it('resolves when URL matches string target', async () => {
    let callCount = 0;
    const page = {
      /**
       * Returns URL that matches after first call.
       * @returns changing URL string.
       */
      url: jest.fn().mockImplementation((): string => {
        callCount += 1;
        return callCount > 1 ? 'https://bank.co.il/target' : 'https://bank.co.il/loading';
      }),
    };
    const didMatch = await NAV.waitForUrl(page as never, 'https://bank.co.il/target', {
      timeout: 5000,
    });
    expect(didMatch).toBe(true);
  });

  it('resolves when URL matches regex target', async () => {
    let callCount = 0;
    const page = {
      /**
       * Returns URL matching regex after first call.
       * @returns changing URL string.
       */
      url: jest.fn().mockImplementation((): string => {
        callCount += 1;
        return callCount > 1 ? 'https://bank.co.il/dashboard/123' : 'https://bank.co.il/loading';
      }),
    };
    const didMatchRegex = await NAV.waitForUrl(page as never, /dashboard\/\d+/, { timeout: 5000 });
    expect(didMatchRegex).toBe(true);
  });

  it('throws on timeout when URL never matches', async () => {
    const page = {
      url: jest.fn().mockReturnValue('https://bank.co.il/stuck'),
    };
    const promise = NAV.waitForUrl(page as never, 'https://bank.co.il/target', { timeout: 500 });
    await expect(promise).rejects.toThrow();
  });
});
