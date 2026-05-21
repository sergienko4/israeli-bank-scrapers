import { jest } from '@jest/globals';
import type { Page } from 'playwright-core';

import { describeError, safeScreenshot, scrubPaths } from '../../../Common/SafeScreenshot.js';

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
