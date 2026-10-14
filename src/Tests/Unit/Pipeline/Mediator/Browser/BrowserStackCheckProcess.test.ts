/**
 * Unit tests for the process-wide browser-stack check the launcher calls.
 *
 * <p>`checkBrowserStack` must use the production readers and read only on
 * its first call in a process. Only camoufox-js's cache reader is replaced,
 * with a build no manifest pins, so the first call warns for Camoufox
 * whatever is cached on the machine; playwright-core is read for real.
 */

import { jest } from '@jest/globals';

const LOG = {
  trace: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

/** A Camoufox build no manifest pins. */
const OTHER_CAMOUFOX = '1.0.0-beta.1';
/** camoufox-js's cache reader, replaced to report {@link OTHER_CAMOUFOX}. */
const INSTALLED_VER_STR = jest.fn((): string => OTHER_CAMOUFOX);
/** Any log message text. */
const ANY_MESSAGE: unknown = expect.any(String);

jest.unstable_mockModule('../../../../../Scrapers/Pipeline/Logging/Debug.js', async () => ({
  ...(await import('../../../../../Scrapers/Pipeline/Logging/BankContext.js')),
  /**
   * Supply the shared logger to the module under test.
   * @returns Shared logger mock.
   */
  getDebug: (): typeof LOG => LOG,
  /**
   * Preserve the legacy logger factory surface.
   * @returns Shared logger mock.
   */
  getDebugByName: (): typeof LOG => LOG,
}));
jest.unstable_mockModule('@hieutran094/camoufox-js/dist/pkgman.js', () => ({
  installedVerStr: INSTALLED_VER_STR,
}));

const { checkBrowserStack: CHECK_BROWSER_STACK } =
  await import('../../../../../Scrapers/Pipeline/Mediator/Browser/BrowserStackCheck.js');

describe('checkBrowserStack (process-wide)', () => {
  it('[BSCP-1] reads the production readers and warns on the first call only', async () => {
    const first = await CHECK_BROWSER_STACK();
    const second = await CHECK_BROWSER_STACK();
    expect(first).toBeGreaterThan(0);
    expect(second).toBe(0);
    expect(INSTALLED_VER_STR).toHaveBeenCalledTimes(1);
    const camoufoxWarning: unknown = expect.objectContaining({
      component: 'camoufox',
      installed: OTHER_CAMOUFOX,
    });
    expect(LOG.warn).toHaveBeenCalledWith(camoufoxWarning, ANY_MESSAGE);
    expect(LOG.warn).toHaveBeenCalledTimes(first);
  });
});
