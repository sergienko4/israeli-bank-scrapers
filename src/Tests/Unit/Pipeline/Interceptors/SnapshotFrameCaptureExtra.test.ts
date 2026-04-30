/**
 * Extra coverage for SnapshotFrameCapture — writes files for child frames.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import type { Frame, Page } from 'playwright-core';

import { captureChildFrames } from '../../../../Scrapers/Pipeline/Interceptors/SnapshotFrameCapture.js';

/**
 * Build a Frame mock with scripted URL and content.
 * @param url - Frame URL.
 * @param content - HTML content to return.
 * @param contentThrows - Whether content() rejects.
 * @returns Mock frame.
 */
function makeFrame(url: string, content = '<html>F</html>', contentThrows = false): Frame {
  return {
    /**
     * url.
     * @returns URL.
     */
    url: (): string => url,
    /**
     * content — scripted.
     * @returns Resolved / rejected.
     */
    content: (): Promise<string> => {
      if (contentThrows) return Promise.reject(new Error('content fail'));
      return Promise.resolve(content);
    },
    /**
     * waitForLoadState.
     * @returns Resolved.
     */
    waitForLoadState: (): Promise<void> => Promise.resolve(),
    /**
     * waitForTimeout.
     * @returns Resolved.
     */
    waitForTimeout: (): Promise<void> => Promise.resolve(),
  } as unknown as Frame;
}

/**
 * Build a Page returning mainFrame + given children.
 * @param children - Child frames.
 * @returns Mock page.
 */
function makePage(children: Frame[]): Page {
  const main = makeFrame('');
  return {
    /**
     * mainFrame.
     * @returns Main.
     */
    mainFrame: (): Frame => main,
    /**
     * frames.
     * @returns Main + children.
     */
    frames: (): Frame[] => [main, ...children],
  } as unknown as Page;
}

describe('captureChildFrames — write paths', () => {
  it('skips about:blank frames', async () => {
    const frame = makeFrame('about:blank');
    const page = makePage([frame]);
    const count = await captureChildFrames(page, 'skip-blank');
    expect(count).toBe(0);
  });

  it('writes file for a child frame with URL + content', async () => {
    const now = Date.now();
    const companyId = `capture-test-${String(now)}`;
    const frame = makeFrame('https://child.bank.co.il/form');
    const page = makePage([frame]);
    const count = await captureChildFrames(page, companyId);
    expect(count).toBe(1);
    // Cleanup
    try {
      const cwd = process.cwd();
      const dir = path.join(cwd, 'tests', 'snapshots', companyId);
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('handles frame content() rejection gracefully', async () => {
    const now = Date.now();
    const companyId = `capture-fail-${String(now)}`;
    const frame = makeFrame('https://fail.bank.co.il/x', '', true);
    const page = makePage([frame]);
    const count = await captureChildFrames(page, companyId);
    expect(count).toBe(0);
  });

  it('returns 0 when page has no children', async () => {
    const page = makePage([]);
    const count = await captureChildFrames(page, 'no-children');
    expect(count).toBe(0);
  });
});
