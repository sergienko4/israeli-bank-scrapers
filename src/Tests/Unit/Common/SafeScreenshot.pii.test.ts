/**
 * PII-safety regression tests for safeScreenshot path scrubbing.
 *
 * Uses jest.unstable_mockModule to intercept the pino child logger so
 * scrubPaths() output is observable without real I/O or file transport.
 * Kept separate from SafeScreenshot.test.ts because that file uses static
 * imports which conflict with jest.unstable_mockModule.
 */

import { jest } from '@jest/globals';
import type { Page } from 'playwright-core';

const DEBUG_SPY = jest.fn();
const MOCK_LOGGER = { debug: DEBUG_SPY };
const GET_DEBUG = jest.fn();
GET_DEBUG.mockReturnValue(MOCK_LOGGER);

jest.unstable_mockModule('../../../Scrapers/Pipeline/Types/Debug.js', () => ({
  getDebug: GET_DEBUG,
}));

const SCREENSHOT_MOD =
  await import('../../../Scrapers/Pipeline/Mediator/Browser/SafeScreenshot.js');

/**
 * Minimal mock Page whose screenshot() rejects with the supplied error.
 * @param error - Error to throw on screenshot().
 * @returns Partial Page implementing only screenshot().
 */
function makeThrowingPage(error: Error): Page {
  return { screenshot: jest.fn().mockRejectedValue(error) } as unknown as Page;
}

/**
 * Invoke safeScreenshot with a throwing page and return the `reason` field
 * passed to LOG.debug — the path-scrubbed error description.
 * @param error - Error the mock Page will throw.
 * @returns Scrubbed reason string from the first LOG.debug call.
 */
async function captureReason(error: Error): Promise<string> {
  const page = makeThrowingPage(error);
  await SCREENSHOT_MOD.safeScreenshot(page, { path: '/screenshots/dummy.png' });
  const args = DEBUG_SPY.mock.calls[0] as [{ reason: string }, string];
  return args[0].reason;
}

describe('safeScreenshot — scrubPaths PII safety', () => {
  afterEach(() => jest.clearAllMocks());

  it('scrubs a Windows path whose username contains multiple space-separated words', async () => {
    // Regression: PATH_SEGMENT = [\w.+-]+ stops at spaces in "Jane Doe Smith".
    // C:\Users\Jane is replaced and Smith\shot.png is replaced, but "Doe"
    // — stranded between two spaces with no following separator — leaks.
    const reason = await captureReason(
      new Error(String.raw`cannot write C:\Users\Jane Doe Smith\shot.png`),
    );

    expect(reason).toContain('<path>');
    expect(reason).not.toContain('Doe');
  });

  it('scrubs a relative path with space-separated directory names', async () => {
    const reason = await captureReason(new Error('failed at Jane Doe/sub dir/file.png'));

    expect(reason).toContain('<path>');
    expect(reason).not.toContain('Jane');
    expect(reason).not.toContain('Doe');
  });

  it('leaves path-free prose unchanged (no path separators)', async () => {
    // Prose without / or \ must pass through scrubPaths without substitution.
    const prose = 'the quick brown fox jumped';
    const reason = await captureReason(new Error(prose));

    expect(reason).toContain(prose);
  });
});
