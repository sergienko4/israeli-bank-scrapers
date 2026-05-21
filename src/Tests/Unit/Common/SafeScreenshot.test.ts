import { jest } from '@jest/globals';
import type { Page } from 'playwright-core';

import { safeScreenshot } from '../../../Common/SafeScreenshot.js';

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

    it('safeScreenshot_whenCiTrue_skipsPageScreenshotCall', async () => {
      const { page, screenshotMock } = makeMockPage();

      const didCapture = await safeScreenshot(page, {
        path: '/tmp/test-fake-shot.png',
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
    it('safeScreenshot_whenCiLiteralFalseString_stillSuppresses', async () => {
      process.env.CI = 'false';
      const { page, screenshotMock } = makeMockPage();

      const didCapture = await safeScreenshot(page, {
        path: '/tmp/test-fake-shot.png',
        fullPage: true,
      });

      expect(didCapture).toBe(false);
      expect(screenshotMock).toHaveBeenCalledTimes(0);
    });
  });
});
