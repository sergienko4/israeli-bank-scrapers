/**
 * Unit tests for Interceptors/SnapshotFrameCapture — URL-to-filename helpers.
 */

import type { Page } from 'playwright-core';

import {
  captureChildFrames,
  frameFilenameForUrl,
  frameFilePath,
} from '../../../../Scrapers/Pipeline/Interceptors/SnapshotFrameCapture.js';

describe('frameFilenameForUrl', () => {
  it('returns 12-char hash + .html extension', () => {
    const name = frameFilenameForUrl('https://example.com/foo');
    expect(name).toMatch(/^[a-f0-9]{12}\.html$/);
  });

  it('produces deterministic output for the same URL', () => {
    const a = frameFilenameForUrl('https://a.example/bar');
    const b = frameFilenameForUrl('https://a.example/bar');
    expect(a).toBe(b);
  });

  it('produces different hash for different URLs', () => {
    const a = frameFilenameForUrl('https://a.example/1');
    const b = frameFilenameForUrl('https://a.example/2');
    expect(a).not.toBe(b);
  });
});

describe('frameFilePath', () => {
  it('contains the company id', () => {
    const p = frameFilePath('my-bank', 'https://x/y');
    expect(p).toContain('my-bank');
  });

  it('ends with the derived filename', () => {
    const url = 'https://x/y';
    const p = frameFilePath('b', url);
    const filename = frameFilenameForUrl(url);
    const hasFilenameSuffix = p.endsWith(filename);
    expect(hasFilenameSuffix).toBe(true);
  });
});

describe('captureChildFrames', () => {
  it('returns 0 when page has only main frame', async () => {
    const main = {
      /**
       * Test helper.
       *
       * @returns Result.
       */
      url: (): string => 'about:blank',
    };
    const page = {
      /**
       * Test helper.
       *
       * @returns Result.
       */
      mainFrame: (): typeof main => main,
      /**
       * Test helper.
       *
       * @returns Result.
       */
      frames: (): readonly (typeof main)[] => [main],
    } as unknown as Page;
    const count = await captureChildFrames(page, 'noop-company');
    expect(count).toBe(0);
  });

  it('skips child frames with about:blank URL', async () => {
    interface IFakeFrame {
      readonly url: () => string;
      readonly waitForLoadState: () => Promise<never>;
      readonly waitForTimeout: () => Promise<never>;
      readonly content: () => Promise<string>;
    }
    const main: IFakeFrame = {
      /**
       * main url.
       * @returns about:blank.
       */
      url: (): string => 'about:blank',
      /**
       * Wait stub (rejects).
       * @returns Rejected promise.
       */
      waitForLoadState: (): Promise<never> => Promise.reject(new Error('idle')),
      /**
       * Timeout stub.
       * @returns Rejected promise.
       */
      waitForTimeout: (): Promise<never> => Promise.reject(new Error('timeout')),
      /**
       * Content stub.
       * @returns Empty string.
       */
      content: (): Promise<string> => Promise.resolve(''),
    };
    const child: IFakeFrame = {
      /**
       * child url — about:blank, skipped.
       * @returns about:blank.
       */
      url: (): string => 'about:blank',
      /**
       * Wait stub (rejects).
       * @returns Rejected promise.
       */
      waitForLoadState: (): Promise<never> => Promise.reject(new Error('idle')),
      /**
       * Timeout stub.
       * @returns Rejected promise.
       */
      waitForTimeout: (): Promise<never> => Promise.reject(new Error('timeout')),
      /**
       * Content stub.
       * @returns Empty.
       */
      content: (): Promise<string> => Promise.resolve(''),
    };
    const page = {
      /**
       * Test helper.
       *
       * @returns Result.
       */
      mainFrame: (): IFakeFrame => main,
      /**
       * Test helper.
       *
       * @returns Result.
       */
      frames: (): readonly IFakeFrame[] => [main, child],
    } as unknown as Page;
    const count = await captureChildFrames(page, 'skip-blank-company');
    expect(count).toBe(0);
  });
});
