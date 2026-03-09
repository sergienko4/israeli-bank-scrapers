import { jest } from '@jest/globals';

import type { INavigationRetryParams } from '../../Scrapers/Base/NavigationRetry.js';
import { handleNavigationFailure } from '../../Scrapers/Base/NavigationRetry.js';
import ScraperError from '../../Scrapers/Base/ScraperError.js';
import { createMockPage, type IMockPage } from '../MockPage.js';

/** Default test URL used across navigation retry tests. */
const TEST_URL = 'https://bank.co.il/login';

/** Mock logger with debug/info/warn/error stubs. */
const MOCK_LOG = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  trace: jest.fn(),
} as unknown as INavigationRetryParams['log'];

/** Container holding both the typed mock page and the untyped params. */
interface ITestHarness {
  page: IMockPage;
  params: INavigationRetryParams;
}

/**
 * Build a test harness with mock page and INavigationRetryParams.
 * @param overrides - partial overrides for the default params
 * @param pageOverrides - partial overrides for the mock page
 * @returns harness with page mock and params
 */
function buildHarness(
  overrides: Partial<INavigationRetryParams> = {},
  pageOverrides: Partial<IMockPage> = {},
): ITestHarness {
  const page = createMockPage(pageOverrides);
  const params: INavigationRetryParams = {
    page,
    url: TEST_URL,
    navOpts: {},
    status: 500,
    retries: 0,
    log: MOCK_LOG,
    navigateTo: jest.fn().mockResolvedValue(true),
    ...overrides,
  };
  params.page = page;
  return { page, params };
}

describe('handleNavigationFailure', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('non-403 path', () => {
    it('delegates to navigateTo when retries remain', async () => {
      const navigateTo = jest.fn().mockResolvedValue(true);
      const { params } = buildHarness({ status: 500, retries: 2, navigateTo });
      const isSuccess = await handleNavigationFailure(params);
      expect(isSuccess).toBe(true);
      expect(navigateTo).toHaveBeenCalledWith(TEST_URL, {}, 1);
    });

    it('decrements retries on each delegation', async () => {
      const navigateTo = jest.fn().mockResolvedValue(true);
      const { params } = buildHarness({ status: 502, retries: 3, navigateTo });
      await handleNavigationFailure(params);
      expect(navigateTo).toHaveBeenCalledWith(TEST_URL, {}, 2);
    });

    it('throws ScraperError when no retries remain', async () => {
      const { params } = buildHarness({ status: 500, retries: 0 });
      const failurePromise = handleNavigationFailure(params);
      await expect(failurePromise).rejects.toThrow(ScraperError);
    });

    it('includes status code in the error message', async () => {
      const { params } = buildHarness({ status: 500, retries: 0 });
      const failurePromise = handleNavigationFailure(params);
      await expect(failurePromise).rejects.toThrow(/status code: 500/);
    });

    it('includes URL in the error message', async () => {
      const { params } = buildHarness({ status: 404, retries: 0, url: 'https://x.co.il/dash' });
      const failurePromise = handleNavigationFailure(params);
      await expect(failurePromise).rejects.toThrow(/x\.co\.il\/dash/);
    });

    it('passes navOpts through to navigateTo', async () => {
      const navigateTo = jest.fn().mockResolvedValue(true);
      const navOpts = { waitUntil: 'domcontentloaded' as const };
      const { params } = buildHarness({ status: 503, retries: 1, navigateTo, navOpts });
      await handleNavigationFailure(params);
      expect(navigateTo).toHaveBeenCalledWith(TEST_URL, navOpts, 0);
    });
  });

  describe('403 WAF retry path', () => {
    /**
     * Build a harness for a 403 scenario where goto returns the given status.
     * @param retryStatus - the HTTP status that retried goto should return
     * @returns test harness with page and params for 403 testing
     */
    function build403Harness(retryStatus: number): ITestHarness {
      return buildHarness(
        { status: 403 },
        {
          goto: jest.fn().mockResolvedValue({
            /**
             * Whether the response is OK.
             * @returns true when retryStatus is 2xx
             */
            ok: (): boolean => retryStatus >= 200 && retryStatus < 300,
            /**
             * The HTTP status code of the response.
             * @returns the configured retry status
             */
            status: (): number => retryStatus,
          }),
          waitForTimeout: jest.fn().mockResolvedValue(undefined),
        },
      );
    }

    it('returns true when retry yields HTTP 200', async () => {
      const { page, params } = build403Harness(200);
      const isSuccess = await handleNavigationFailure(params);
      expect(isSuccess).toBe(true);
      expect(page.waitForTimeout).toHaveBeenCalledWith(15_000);
      expect(page.goto).toHaveBeenCalledWith(TEST_URL, {});
    });

    it('returns true when retry yields a redirect (3xx)', async () => {
      const { params } = build403Harness(302);
      const isSuccess = await handleNavigationFailure(params);
      expect(isSuccess).toBe(true);
    });

    it('throws after MAX_403_RETRIES when server keeps returning 403', async () => {
      const { params } = build403Harness(403);
      const failurePromise = handleNavigationFailure(params);
      await expect(failurePromise).rejects.toThrow(ScraperError);
    });

    it('error message mentions 403 and retry count', async () => {
      const { params } = build403Harness(403);
      const failurePromise = handleNavigationFailure(params);
      await expect(failurePromise).rejects.toThrow(/403 after 2 retries/);
    });

    it('retries up to MAX_403_RETRIES times before throwing', async () => {
      const { page, params } = build403Harness(403);
      try {
        await handleNavigationFailure(params);
      } catch {
        /* expected */
      }
      expect(page.waitForTimeout).toHaveBeenCalledTimes(2);
      expect(page.goto).toHaveBeenCalledTimes(2);
    });

    it('succeeds on second retry when first retry still returns 403', async () => {
      let callCount = 0;
      const { page, params } = buildHarness(
        { status: 403 },
        {
          goto: jest.fn().mockImplementation(() => {
            callCount += 1;
            const status = callCount === 1 ? 403 : 200;
            return Promise.resolve({
              /**
               * Whether the response is OK.
               * @returns true when status is 200
               */
              ok: (): boolean => status === 200,
              /**
               * The HTTP status code of the response.
               * @returns the current call status
               */
              status: (): number => status,
            });
          }),
          waitForTimeout: jest.fn().mockResolvedValue(undefined),
        },
      );
      const isSuccess = await handleNavigationFailure(params);
      expect(isSuccess).toBe(true);
      expect(page.waitForTimeout).toHaveBeenCalledTimes(2);
    });

    it('handles null response from page.goto gracefully', async () => {
      const { params } = buildHarness(
        { status: 403 },
        {
          goto: jest.fn().mockResolvedValue(null),
          waitForTimeout: jest.fn().mockResolvedValue(undefined),
        },
      );
      const failurePromise = handleNavigationFailure(params);
      await expect(failurePromise).rejects.toThrow(/403 after 2 retries/);
    });
  });

  describe('false-positive guards', () => {
    it('does NOT retry on 401 — only 403 triggers WAF path', async () => {
      const { params } = buildHarness({ status: 401, retries: 0 });
      const failurePromise = handleNavigationFailure(params);
      await expect(failurePromise).rejects.toThrow(/status code: 401/);
    });

    it('does NOT use navigateTo callback for 403 — uses page.goto directly', async () => {
      const navigateTo = jest.fn();
      const { page, params } = buildHarness(
        { status: 403, navigateTo },
        {
          goto: jest.fn().mockResolvedValue({
            /**
             * Whether the response is OK.
             * @returns true
             */
            ok: (): boolean => true,
            /**
             * The HTTP status code of the response.
             * @returns 200
             */
            status: (): number => 200,
          }),
          waitForTimeout: jest.fn().mockResolvedValue(undefined),
        },
      );
      await handleNavigationFailure(params);
      expect(navigateTo).not.toHaveBeenCalled();
      expect(page.goto).toHaveBeenCalled();
    });

    it('does NOT enter 403 path for status 200', async () => {
      const { params } = buildHarness({ status: 200, retries: 0 });
      const failurePromise = handleNavigationFailure(params);
      await expect(failurePromise).rejects.toThrow(/status code: 200/);
    });

    it('status is converted to string in error message', async () => {
      const { params } = buildHarness({ status: 502, retries: 0 });
      const failurePromise = handleNavigationFailure(params);
      await expect(failurePromise).rejects.toThrow('502');
    });
  });
});
