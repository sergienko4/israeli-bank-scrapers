import { jest } from '@jest/globals';
import type { Page } from 'playwright-core';

import { PRE_AUTH_SCREENSHOT_PHASES, safeScreenshot } from '../../../Common/SafeScreenshot.js';

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

    it('safeScreenshot_whenCaptureRejectsWithPosixPathInMessage_swallowsAndReturnsFalse', async () => {
      const { page, screenshotMock } = makeMockPage();
      screenshotMock.mockRejectedValueOnce(
        new TypeError('cannot open /tmp/runs/pipeline/leumi/shot.png'),
      );

      const didCapture = await safeScreenshot(page, {
        path: '/tmp/test-fake-shot.png',
        fullPage: false,
      });

      expect(didCapture).toBe(false);
      expect(screenshotMock).toHaveBeenCalledTimes(1);
    });

    it('safeScreenshot_whenCaptureRejectsWithWindowsPathInMessage_swallowsAndReturnsFalse', async () => {
      const { page, screenshotMock } = makeMockPage();
      screenshotMock.mockRejectedValueOnce(
        new Error(String.raw`cannot write C:\Users\eve\screenshot.png`),
      );

      const didCapture = await safeScreenshot(page, {
        path: '/tmp/test-fake-shot.png',
        fullPage: false,
      });

      expect(didCapture).toBe(false);
      expect(screenshotMock).toHaveBeenCalledTimes(1);
    });

    it('safeScreenshot_whenCaptureRejectsWithVeryLongMessage_swallowsAndReturnsFalse', async () => {
      const { page, screenshotMock } = makeMockPage();
      screenshotMock.mockRejectedValueOnce(new Error('x'.repeat(500)));

      const didCapture = await safeScreenshot(page, {
        path: '/tmp/test-fake-shot.png',
        fullPage: false,
      });

      expect(didCapture).toBe(false);
      expect(screenshotMock).toHaveBeenCalledTimes(1);
    });

    it('safeScreenshot_whenCaptureRejectsWithStringValue_swallowsAndReturnsFalse', async () => {
      const { page, screenshotMock } = makeMockPage();
      screenshotMock.mockRejectedValueOnce('failed at /home/runner/work/shot.png');

      const didCapture = await safeScreenshot(page, {
        path: '/tmp/test-fake-shot.png',
        fullPage: false,
      });

      expect(didCapture).toBe(false);
      expect(screenshotMock).toHaveBeenCalledTimes(1);
    });

    it('safeScreenshot_whenCaptureRejectsWithPlainObject_swallowsAndReturnsFalse', async () => {
      const { page, screenshotMock } = makeMockPage();
      screenshotMock.mockRejectedValueOnce({ code: 42 });

      const didCapture = await safeScreenshot(page, {
        path: '/tmp/test-fake-shot.png',
        fullPage: false,
      });

      expect(didCapture).toBe(false);
      expect(screenshotMock).toHaveBeenCalledTimes(1);
    });

    it('safeScreenshot_whenCaptureRejectsWithCircularRefObject_swallowsAndReturnsFalse', async () => {
      const { page, screenshotMock } = makeMockPage();
      interface ICircularRef {
        self?: ICircularRef;
      }
      const circular: ICircularRef = {};
      circular.self = circular;
      screenshotMock.mockRejectedValueOnce(circular);

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

describe('PRE_AUTH_SCREENSHOT_PHASES — workflow alignment pin', () => {
  it('is frozen + matches the .github/workflows/pr.yml allowlist verbatim', () => {
    const isFrozen = Object.isFrozen(PRE_AUTH_SCREENSHOT_PHASES);
    const phases = [...PRE_AUTH_SCREENSHOT_PHASES];
    expect(isFrozen).toBe(true);
    expect(phases).toEqual(['init', 'home']);
  });
});
