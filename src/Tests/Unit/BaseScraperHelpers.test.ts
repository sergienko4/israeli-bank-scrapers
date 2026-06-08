import { jest } from '@jest/globals';
import type { Page } from 'playwright-core';

import ScraperError from '../../Scrapers/Base/ScraperError.js';

const MOCK_GET_CURRENT_URL = jest.fn().mockResolvedValue('https://example.com');

jest.unstable_mockModule(
  '../../Common/Debug.js',
  /**
   * Mock Debug module.
   * @returns mocked debug exports
   */
  () => ({
    getDebug:
      /**
       * Debug factory.
       * @returns mock logger
       */
      (): Record<string, jest.Mock> => ({
        trace: jest.fn(),
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      }),
  }),
);

jest.unstable_mockModule('../../Common/Waiting.js', () => ({
  sleep: jest.fn().mockResolvedValue(undefined),
  humanDelay: jest.fn().mockResolvedValue(undefined),
  waitUntil: jest.fn().mockResolvedValue(undefined),
  raceTimeout: jest.fn().mockResolvedValue(undefined),
  /**
   * Executes async actions sequentially, collecting results.
   * @param actions - Array of async factory functions.
   * @returns Array of resolved values.
   */
  runSerial: jest.fn().mockImplementation(<T>(actions: (() => Promise<T>)[]): Promise<T[]> => {
    const seed = Promise.resolve([] as T[]);
    return actions.reduce(
      (p: Promise<T[]>, act: () => Promise<T>) => p.then(async (r: T[]) => [...r, await act()]),
      seed,
    );
  }),
  TimeoutError: Error,
  SECOND: 1000,
}));

jest.unstable_mockModule('../../Common/Navigation.js', () => ({
  waitForNavigation: jest.fn().mockResolvedValue(undefined),
  waitForNavigationAndDomLoad: jest.fn().mockResolvedValue(undefined),
  getCurrentUrl: MOCK_GET_CURRENT_URL,
  waitForRedirect: jest.fn().mockResolvedValue(undefined),
  waitForUrl: jest.fn().mockResolvedValue(undefined),
}));

const {
  safeCleanup: SAFE_CLEANUP,
  alreadyAtResultUrl: ALREADY_AT_RESULT_URL,
  detectGenericInvalidPassword: DETECT_INVALID_PW,
  buildLoginResult: BUILD_LOGIN_RESULT,
  resolveAndBuildLoginResult: RESOLVE_AND_BUILD,
  formatDiagUrl: FORMAT_DIAG_URL,
  getKeyByValue: GET_KEY_BY_VALUE,
  LOGIN_RESULTS,
} = await import('../../Scrapers/Base/BaseScraperHelpers.js');

const { ScraperErrorTypes: ERROR_TYPES } = await import('../../Scrapers/Base/Errors.js');
const { ScraperProgressTypes: PROGRESS_TYPES } = await import('../../Definitions.js');

/**
 * Creates a mock Page with configurable URL and locator.
 * @param url - The URL the mock page reports.
 * @returns A mock Page instance.
 */
function makeMockPage(url = 'https://example.com'): Page {
  return {
    url: jest.fn().mockReturnValue(url),
    title: jest.fn().mockResolvedValue('Test'),
    locator: jest.fn().mockReturnValue({ count: jest.fn().mockResolvedValue(0) }),
  } as Partial<Page> as Page;
}

describe('safeCleanup', () => {
  beforeEach(() => jest.clearAllMocks());

  it('calls the cleanup function and returns true on success', async () => {
    const cleanup = jest.fn().mockResolvedValue(true);
    const didSucceed = await SAFE_CLEANUP(cleanup);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(didSucceed).toBe(true);
  });

  it('returns true even when cleanup throws', async () => {
    const cleanup = jest.fn().mockRejectedValue(new ScraperError('browser crashed'));
    const didSucceed = await SAFE_CLEANUP(cleanup);
    expect(didSucceed).toBe(true);
  });
});

describe('alreadyAtResultUrl', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns true when current URL matches a known result', async () => {
    const page = makeMockPage('https://bank.co.il/dashboard');
    const possibleResults = { [LOGIN_RESULTS.Success]: ['https://bank.co.il/dashboard'] };
    const isAtResult = await ALREADY_AT_RESULT_URL(possibleResults, page);
    expect(isAtResult).toBe(true);
  });

  it('returns false when current URL matches no result', async () => {
    const page = makeMockPage('https://bank.co.il/login');
    const possibleResults = { [LOGIN_RESULTS.Success]: ['https://bank.co.il/dashboard'] };
    const isAtResult = await ALREADY_AT_RESULT_URL(possibleResults, page);
    expect(isAtResult).toBe(false);
  });

  it('returns false when page.url() throws', async () => {
    const page = {
      url: jest.fn().mockImplementation(() => {
        throw new ScraperError('detached');
      }),
      title: jest.fn().mockResolvedValue(''),
      locator: jest.fn().mockReturnValue({ count: jest.fn().mockResolvedValue(0) }),
    } as Partial<Page> as Page;
    const possibleResults = { [LOGIN_RESULTS.Success]: ['https://bank.co.il/dashboard'] };
    const isAtResult = await ALREADY_AT_RESULT_URL(possibleResults, page);
    expect(isAtResult).toBe(false);
  });
});

describe('detectGenericInvalidPassword', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns true when aria-invalid input is present', async () => {
    const page = makeMockPage();
    (page.locator as jest.Mock).mockReturnValue({ count: jest.fn().mockResolvedValue(2) });
    const isInvalid = await DETECT_INVALID_PW(page);
    expect(isInvalid).toBe(true);
  });

  it('returns false when no aria-invalid inputs exist', async () => {
    const page = makeMockPage();
    const isInvalid = await DETECT_INVALID_PW(page);
    expect(isInvalid).toBe(false);
  });

  it('returns false when locator throws', async () => {
    const page = makeMockPage();
    (page.locator as jest.Mock).mockImplementation(() => {
      throw new ScraperError('page closed');
    });
    const isInvalid = await DETECT_INVALID_PW(page);
    expect(isInvalid).toBe(false);
  });
});

describe('formatDiagUrl (CodeQL #28-class diagnostic URL sanitization)', () => {
  it('returns "?" for undefined input', () => {
    const out = FORMAT_DIAG_URL(undefined);
    expect(out).toBe('?');
  });
  it('returns "?" for empty string', () => {
    const out = FORMAT_DIAG_URL('');
    expect(out).toBe('?');
  });
  it('returns "?" verbatim when caller already passed the sentinel', () => {
    const out = FORMAT_DIAG_URL('?');
    expect(out).toBe('?');
  });
  it('strips PII query keys but keeps host and path', () => {
    const out = FORMAT_DIAG_URL(
      'https://x.example/api/login?accountId=99-999-991234&token=eyJsecret&v=1',
    );
    expect(out).toContain('x.example');
    expect(out).toContain('/api/login');
    expect(out).toContain('accountId=***1234');
    expect(out).not.toContain('99-999-991234');
    expect(out).not.toContain('eyJsecret');
    expect(out).toContain('v=1');
  });
  it('passes through non-URL strings unchanged (redactUrl no-op fallback)', () => {
    const out = FORMAT_DIAG_URL('not-a-url');
    expect(out).toBe('not-a-url');
  });
});

describe('getKeyByValue no-match path (CodeQL leak fix at line 161)', () => {
  it('returns UnknownError when no condition matches (exercises sanitized log line)', async () => {
    const page = makeMockPage('https://x.example/login?token=secret');
    const possibleResults = { [LOGIN_RESULTS.Success]: ['https://x.example/dashboard'] };
    const out = await GET_KEY_BY_VALUE(
      possibleResults,
      'https://x.example/?accountId=99-999-991234',
      page,
    );
    expect(out).toBe(LOGIN_RESULTS.UnknownError);
  });
});

describe('buildLoginResult', () => {
  /**
   * Creates a login result context for testing.
   * @param page - The mock page.
   * @returns A login result context with emitProgress spy.
   */
  function makeResultCtx(page: Page): {
    page: Page;
    diagState: { lastAction: string; finalUrl?: string; pageTitle?: string };
    emitProgress: jest.Mock;
  } {
    return { page, diagState: { lastAction: '' }, emitProgress: jest.fn().mockReturnValue(true) };
  }

  it('returns success result for Success login result', () => {
    const page = makeMockPage();
    const ctx = makeResultCtx(page);
    const out = BUILD_LOGIN_RESULT(ctx, LOGIN_RESULTS.Success);
    expect(out.success).toBe(true);
    expect(ctx.emitProgress).toHaveBeenCalledWith(PROGRESS_TYPES.LoginSuccess);
  });

  it('returns ChangePassword result', () => {
    const page = makeMockPage();
    const ctx = makeResultCtx(page);
    const out = BUILD_LOGIN_RESULT(ctx, LOGIN_RESULTS.ChangePassword);
    expect(out.success).toBe(false);
    expect(out.errorType).toBe(ERROR_TYPES.ChangePassword);
  });

  it('returns InvalidPassword error type for InvalidPassword result', () => {
    const page = makeMockPage();
    const ctx = makeResultCtx(page);
    const out = BUILD_LOGIN_RESULT(ctx, LOGIN_RESULTS.InvalidPassword);
    expect(out.errorType).toBe(ERROR_TYPES.InvalidPassword);
    expect(ctx.emitProgress).toHaveBeenCalledWith(PROGRESS_TYPES.LoginFailed);
  });

  it('returns Generic error type for UnknownError result', () => {
    const page = makeMockPage();
    const ctx = makeResultCtx(page);
    const out = BUILD_LOGIN_RESULT(ctx, LOGIN_RESULTS.UnknownError);
    expect(out.errorType).toBe(ERROR_TYPES.Generic);
  });

  it('exercises the finalUrl redaction path with a PII-bearing URL', () => {
    // CodeQL #29: finalUrl could carry session tokens in query params.
    // Setting it here forces the LOG.debug call to route through
    // formatDiagUrl → redactUrl, exercising the redaction branch.
    const page = makeMockPage();
    const ctx = makeResultCtx(page);
    ctx.diagState.finalUrl = 'https://x.example/dashboard?accountId=99-999-991234&token=abc';
    const out = BUILD_LOGIN_RESULT(ctx, LOGIN_RESULTS.Success);
    expect(out.success).toBe(true);
    expect(ctx.diagState.lastAction).toContain('login result: SUCCESS');
  });
});

describe('resolveAndBuildLoginResult', () => {
  it('upgrades UnknownError to InvalidPassword when aria-invalid detected', async () => {
    MOCK_GET_CURRENT_URL.mockResolvedValue('https://bank.co.il/login');
    const page = makeMockPage('https://bank.co.il/login');
    (page.locator as jest.Mock).mockReturnValue({ count: jest.fn().mockResolvedValue(1) });
    const ctx = {
      page,
      diagState: { lastAction: '' },
      emitProgress: jest.fn().mockReturnValue(true),
    };
    const possibleResults = { [LOGIN_RESULTS.Success]: ['https://bank.co.il/dashboard'] };
    const out = await RESOLVE_AND_BUILD(ctx, possibleResults);
    expect(out.errorType).toBe(ERROR_TYPES.InvalidPassword);
  });
});
