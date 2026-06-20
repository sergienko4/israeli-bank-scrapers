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

    it('safeScreenshot_whenCiTrueAndPostAuthPhase_divertsToPrivateDir', async () => {
      const { page, screenshotMock } = makeMockPage();

      const didCapture = await safeScreenshot(page, {
        path: '/tmp/runs/pipeline/hapoalim/screenshots/hapoalim-dashboard-pre-done-20260531.png',
        fullPage: true,
      });

      expect(didCapture).toBe(true);
      expect(screenshotMock).toHaveBeenCalledTimes(1);
      expect(screenshotMock).toHaveBeenCalledWith({
        path: '/tmp/runs/pipeline/hapoalim/private/hapoalim-dashboard-pre-done-20260531.png',
        fullPage: true,
      });
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

    it('safeScreenshot_whenCiTrueAndLoginPhase_divertsToPrivateDir', async () => {
      const { page, screenshotMock } = makeMockPage();

      const didCapture = await safeScreenshot(page, {
        path: '/tmp/runs/pipeline/hapoalim/screenshots/hapoalim-login-action-done-20260531.png',
        fullPage: true,
      });

      expect(didCapture).toBe(true);
      expect(screenshotMock).toHaveBeenCalledTimes(1);
      expect(screenshotMock).toHaveBeenCalledWith({
        path: '/tmp/runs/pipeline/hapoalim/private/hapoalim-login-action-done-20260531.png',
        fullPage: true,
      });
    });

    it('safeScreenshot_whenCiTrueAndAuthDiscoveryPhase_divertsToPrivateDir', async () => {
      const { page, screenshotMock } = makeMockPage();

      const didCapture = await safeScreenshot(page, {
        path: '/tmp/runs/pipeline/isracard/screenshots/isracard-auth-discovery-post-fail-20260531.png',
        fullPage: true,
      });

      expect(didCapture).toBe(true);
      expect(screenshotMock).toHaveBeenCalledTimes(1);
      expect(screenshotMock).toHaveBeenCalledWith({
        path: '/tmp/runs/pipeline/isracard/private/isracard-auth-discovery-post-fail-20260531.png',
        fullPage: true,
      });
    });
  });

  describe('when CI explicitly disabled (CI=false)', () => {
    beforeEach(() => {
      process.env.CI = 'false';
    });

    it('safeScreenshot_whenCiFalse_invokesPageScreenshot', async () => {
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

  describe('explicit opt-out — CI=false captures every phase', () => {
    it('safeScreenshot_whenCiFalseStringAndPostAuthPhase_capturesToPublicDir', async () => {
      process.env.CI = 'false';
      const { page, screenshotMock } = makeMockPage();
      const path = '/tmp/runs/pipeline/hapoalim/screenshots/hapoalim-scrape-pre-done.png';

      const didCapture = await safeScreenshot(page, { path, fullPage: true });

      expect(didCapture).toBe(true);
      expect(screenshotMock).toHaveBeenCalledTimes(1);
      expect(screenshotMock).toHaveBeenCalledWith({ path, fullPage: true });
    });

    it('safeScreenshot_whenCiFalseUppercaseTrimmed_captures', async () => {
      process.env.CI = '  FALSE  ';
      const { page, screenshotMock } = makeMockPage();

      const didCapture = await safeScreenshot(page, {
        path: '/tmp/runs/pipeline/hapoalim/screenshots/hapoalim-dashboard-pre-done.png',
        fullPage: true,
      });

      expect(didCapture).toBe(true);
      expect(screenshotMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('fail-closed default — non-CI=false diverts post-auth to private', () => {
    const postAuthPath = '/tmp/runs/pipeline/hapoalim/screenshots/hapoalim-scrape-pre-done.png';
    const privatePath = '/tmp/runs/pipeline/hapoalim/private/hapoalim-scrape-pre-done.png';

    it('safeScreenshot_whenCiUnset_divertsPostAuthToPrivate', async () => {
      delete process.env.CI;
      const { page, screenshotMock } = makeMockPage();

      const didCapture = await safeScreenshot(page, { path: postAuthPath, fullPage: true });

      expect(didCapture).toBe(true);
      expect(screenshotMock).toHaveBeenCalledTimes(1);
      expect(screenshotMock).toHaveBeenCalledWith({ path: privatePath, fullPage: true });
    });

    it('safeScreenshot_whenCiEmptyString_divertsPostAuthToPrivate', async () => {
      process.env.CI = '';
      const { page, screenshotMock } = makeMockPage();

      const didCapture = await safeScreenshot(page, { path: postAuthPath, fullPage: true });

      expect(didCapture).toBe(true);
      expect(screenshotMock).toHaveBeenCalledTimes(1);
      expect(screenshotMock).toHaveBeenCalledWith({ path: privatePath, fullPage: true });
    });

    it('safeScreenshot_whenCiZero_divertsPostAuthToPrivate', async () => {
      process.env.CI = '0';
      const { page, screenshotMock } = makeMockPage();

      const didCapture = await safeScreenshot(page, { path: postAuthPath, fullPage: true });

      expect(didCapture).toBe(true);
      expect(screenshotMock).toHaveBeenCalledTimes(1);
      expect(screenshotMock).toHaveBeenCalledWith({ path: privatePath, fullPage: true });
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
