import { jest } from '@jest/globals';
import type { Page } from 'playwright-core';

import {
  describeError,
  isPreAuthScreenshot,
  PRE_AUTH_SCREENSHOT_PHASES,
  safeScreenshot,
  scrubPaths,
} from '../../../Common/SafeScreenshot.js';

const ORIGINAL_CI = process.env.CI;

/**
 * Creates a mock Playwright Page exposing only `screenshot` as a jest mock.
 * @returns An object exposing the screenshot mock and the Page-typed view.
 */
function makeMockPage(): { page: Page; screenshotMock: jest.Mock } {
  const emptyBuffer = Buffer.alloc(0);
  const screenshotMock = jest.fn().mockResolvedValue(emptyBuffer);
  const page = { screenshot: screenshotMock } as unknown as Page;
  return { page, screenshotMock };
}

describe('safeScreenshot — CI gating contract', () => {
  afterEach(() => {
    if (ORIGINAL_CI === undefined) delete process.env.CI;
    else process.env.CI = ORIGINAL_CI;
    jest.clearAllMocks();
  });

  describe('when CI=true', () => {
    beforeEach(() => {
      process.env.CI = 'true';
    });

    it('safeScreenshot_whenCiTrueAndPostAuthPhase_skipsPageScreenshotCall', async () => {
      const { page, screenshotMock } = makeMockPage();

      const didCapture = await safeScreenshot(page, {
        path: '/tmp/runs/pipeline/hapoalim/screenshots/hapoalim-dashboard-pre-done-20260531.png',
        fullPage: true,
      });

      expect(didCapture).toBe(false);
      expect(screenshotMock).toHaveBeenCalledTimes(0);
    });

    it('safeScreenshot_whenCiTrueAndInitPhase_capturesScreenshot', async () => {
      const { page, screenshotMock } = makeMockPage();

      const didCapture = await safeScreenshot(page, {
        path: '/tmp/runs/pipeline/hapoalim/screenshots/hapoalim-init-pre-done-20260531.png',
        fullPage: true,
      });

      expect(didCapture).toBe(true);
      expect(screenshotMock).toHaveBeenCalledTimes(1);
    });

    it('safeScreenshot_whenCiTrueAndHomePhaseFail_capturesScreenshot', async () => {
      const { page, screenshotMock } = makeMockPage();

      const didCapture = await safeScreenshot(page, {
        path: '/tmp/runs/pipeline/hapoalim/screenshots/hapoalim-home-pre-fail-20260531.png',
        fullPage: false,
      });

      expect(didCapture).toBe(true);
      expect(screenshotMock).toHaveBeenCalledTimes(1);
    });

    it('safeScreenshot_whenCiTrueAndLoginPhase_skipsPageScreenshotCall', async () => {
      const { page, screenshotMock } = makeMockPage();

      const didCapture = await safeScreenshot(page, {
        path: '/tmp/runs/pipeline/hapoalim/screenshots/hapoalim-login-action-done-20260531.png',
        fullPage: true,
      });

      expect(didCapture).toBe(false);
      expect(screenshotMock).toHaveBeenCalledTimes(0);
    });

    it('safeScreenshot_whenCiTrueAndAuthDiscoveryPhase_skipsPageScreenshotCall', async () => {
      const { page, screenshotMock } = makeMockPage();

      const didCapture = await safeScreenshot(page, {
        path: '/tmp/runs/pipeline/isracard/screenshots/isracard-auth-discovery-post-fail-20260531.png',
        fullPage: true,
      });

      expect(didCapture).toBe(false);
      expect(screenshotMock).toHaveBeenCalledTimes(0);
    });
  });

  describe('when CI is unset', () => {
    beforeEach(() => {
      delete process.env.CI;
    });

    it('safeScreenshot_whenCiUnset_invokesPageScreenshot', async () => {
      const { page, screenshotMock } = makeMockPage();

      const didCapture = await safeScreenshot(page, {
        path: '/tmp/test-fake-shot.png',
        fullPage: true,
      });

      expect(didCapture).toBe(true);
      expect(screenshotMock).toHaveBeenCalledTimes(1);
      expect(screenshotMock).toHaveBeenCalledWith({
        path: '/tmp/test-fake-shot.png',
        fullPage: true,
      });
    });

    it('safeScreenshot_whenCaptureRejects_returnsFalse', async () => {
      const { page, screenshotMock } = makeMockPage();
      screenshotMock.mockRejectedValueOnce(new Error('disk full'));

      const didCapture = await safeScreenshot(page, {
        path: '/tmp/test-fake-shot.png',
        fullPage: false,
      });

      expect(didCapture).toBe(false);
      expect(screenshotMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('CI truthy-semantics foot-gun', () => {
    it('safeScreenshot_whenCiLiteralFalseStringAndPostAuthPhase_stillSuppresses', async () => {
      process.env.CI = 'false';
      const { page, screenshotMock } = makeMockPage();

      const didCapture = await safeScreenshot(page, {
        path: '/tmp/runs/pipeline/hapoalim/screenshots/hapoalim-scrape-pre-done.png',
        fullPage: true,
      });

      expect(didCapture).toBe(false);
      expect(screenshotMock).toHaveBeenCalledTimes(0);
    });
  });
});

describe('isPreAuthScreenshot — phase-allowlist helper', () => {
  it('accepts init phase basenames', () => {
    const isInitPreDone = isPreAuthScreenshot('hapoalim-init-pre-done-20260531.png');
    const isInitFinalFail = isPreAuthScreenshot('beinleumi-init-final-fail-20260531.png');
    expect(isInitPreDone).toBe(true);
    expect(isInitFinalFail).toBe(true);
  });

  it('accepts home phase basenames', () => {
    const isHomePreFail = isPreAuthScreenshot('hapoalim-home-pre-fail-20260531.png');
    const isHomePostDone = isPreAuthScreenshot('isracard-home-post-done-20260531.png');
    expect(isHomePreFail).toBe(true);
    expect(isHomePostDone).toBe(true);
  });

  it('rejects post-auth phase basenames', () => {
    const postAuth = [
      'hapoalim-login-action-done-20260531.png',
      'hapoalim-otp-pre-fail-20260531.png',
      'isracard-auth-discovery-post-fail-20260531.png',
      'discount-account-resolve-pre-done-20260531.png',
      'max-dashboard-pre-done-20260531.png',
      'visacal-scrape-final-done-20260531.png',
      'amex-terminate-pre-done-20260531.png',
      'paybox-prelogin-pre-done-20260531.png',
    ];
    for (const file of postAuth) {
      const isAllowed = isPreAuthScreenshot(file);
      expect(isAllowed).toBe(false);
    }
  });

  it('rejects malformed or empty basenames', () => {
    const isEmptyAllowed = isPreAuthScreenshot('');
    const isInitWithoutBank = isPreAuthScreenshot('init-pre-done.png');
    const isUnderscoreSeparated = isPreAuthScreenshot('hapoalim_home_pre_done.png');
    const isHomeWithoutBank = isPreAuthScreenshot('home-pre-done.png');
    expect(isEmptyAllowed).toBe(false);
    expect(isInitWithoutBank).toBe(false);
    expect(isUnderscoreSeparated).toBe(false);
    expect(isHomeWithoutBank).toBe(false);
  });
});

describe('PRE_AUTH_SCREENSHOT_PHASES — workflow alignment pin', () => {
  it('is frozen + matches the .github/workflows/pr.yml allowlist verbatim', () => {
    const isFrozen = Object.isFrozen(PRE_AUTH_SCREENSHOT_PHASES);
    const phases = [...PRE_AUTH_SCREENSHOT_PHASES];
    expect(isFrozen).toBe(true);
    expect(phases).toEqual(['init', 'home']);
  });
});

describe('scrubPaths', () => {
  it('replaces POSIX absolute paths with <path>', () => {
    const scrubbed = scrubPaths('EACCES open /tmp/runs/pipeline/leumi/shot.png');
    expect(scrubbed).toBe('EACCES open <path>');
  });

  it('replaces Windows absolute paths with <path>', () => {
    const input = String.raw`cannot write C:\Users\eve\screenshot.png`;
    const scrubbed = scrubPaths(input);
    expect(scrubbed).toBe('cannot write <path>');
  });

  it('truncates long inputs at the cap', () => {
    const long = 'x'.repeat(500);
    const scrubbed = scrubPaths(long);
    expect(scrubbed.length).toBeLessThanOrEqual(160);
  });
});

describe('describeError', () => {
  it('preserves Error name and scrubs paths from message', () => {
    const err = new TypeError('cannot open /tmp/runs/pipeline/leumi/shot.png');
    const description = describeError(err);
    expect(description).toBe('TypeError: cannot open <path>');
  });

  it('returns sanitized string for non-Error string throws', () => {
    const description = describeError('failed at /home/runner/work/shot.png');
    expect(description).toBe('failed at <path>');
  });

  it('falls back to JSON.stringify for unknown shapes', () => {
    const description = describeError({ code: 42 });
    expect(description).toBe('{"code":42}');
  });
});
