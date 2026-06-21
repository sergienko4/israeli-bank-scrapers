import { jest } from '@jest/globals';
import type { Page } from 'playwright-core';

import { safeScreenshot } from '../../../Common/SafeScreenshot.js';

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

describe('safeScreenshot — capture writes the supplied path verbatim', () => {
  afterEach(() => jest.clearAllMocks());

  it('writes the PNG to the exact path supplied and returns true', async () => {
    const { page, screenshotMock } = makeMockPage();
    const path = '/tmp/runs/pipeline/hapoalim/screenshots/hapoalim-dashboard-pre-done.png';

    const didCapture = await safeScreenshot(page, { path, fullPage: true });

    expect(didCapture).toBe(true);
    expect(screenshotMock).toHaveBeenCalledTimes(1);
    expect(screenshotMock).toHaveBeenCalledWith({ path, fullPage: true });
  });

  it('captures post-auth phases verbatim — the forensic gate lives upstream, not here', async () => {
    const { page, screenshotMock } = makeMockPage();
    const path = '/tmp/runs/pipeline/isracard/screenshots/isracard-auth-discovery-post-fail.png';

    const didCapture = await safeScreenshot(page, { path, fullPage: true });

    expect(didCapture).toBe(true);
    expect(screenshotMock).toHaveBeenCalledWith({ path, fullPage: true });
  });

  it('never diverts to a private/ directory (forensic gate is upstream)', async () => {
    const { page, screenshotMock } = makeMockPage();
    const path = '/tmp/runs/pipeline/hapoalim/screenshots/hapoalim-scrape-post-done.png';

    await safeScreenshot(page, { path, fullPage: true });

    const [firstCall] = screenshotMock.mock.calls[0] as [{ path: string }];
    expect(firstCall.path).toBe(path);
    expect(firstCall.path).not.toContain('/private/');
  });

  it('defaults fullPage to false when omitted', async () => {
    const { page, screenshotMock } = makeMockPage();

    await safeScreenshot(page, { path: '/tmp/shot.png' });

    expect(screenshotMock).toHaveBeenCalledWith({ path: '/tmp/shot.png', fullPage: false });
  });
});

type RejectionValue = Error | string | object;

interface ICircularRef {
  self?: ICircularRef;
}

/**
 * Builds a self-referential object so the describeError JSON path hits the
 * non-serialisable fallback branch.
 * @returns An object whose `self` points back to itself.
 */
function makeCircularRef(): ICircularRef {
  const circular: ICircularRef = {};
  circular.self = circular;
  return circular;
}

const REJECTION_CASES: readonly { label: string; value: RejectionValue }[] = [
  { label: 'a plain Error', value: new Error('disk full') },
  {
    label: 'a TypeError carrying a POSIX path',
    value: new TypeError('cannot open /tmp/runs/pipeline/leumi/shot.png'),
  },
  {
    label: 'an Error carrying a Windows path',
    value: new Error(String.raw`cannot write C:\Users\eve\screenshot.png`),
  },
  { label: 'an over-long message', value: new Error('x'.repeat(500)) },
  { label: 'a string with a path', value: 'failed at /home/runner/work/shot.png' },
  { label: 'a plain object', value: { code: 42 } },
  { label: 'a circular-ref object', value: makeCircularRef() },
];

describe('safeScreenshot — swallows capture errors (diagnostic-only, PII-safe)', () => {
  afterEach(() => jest.clearAllMocks());

  it.each(REJECTION_CASES)('returns false when capture rejects with $label', async ({ value }) => {
    const { page, screenshotMock } = makeMockPage();
    screenshotMock.mockRejectedValueOnce(value);

    const didCapture = await safeScreenshot(page, {
      path: '/tmp/test-fake-shot.png',
      fullPage: false,
    });

    expect(didCapture).toBe(false);
    expect(screenshotMock).toHaveBeenCalledTimes(1);
  });
});
