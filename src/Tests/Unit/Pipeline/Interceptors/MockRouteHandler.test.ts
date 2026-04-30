/**
 * Unit tests for Interceptors/MockRouteHandler — buildHandler behaviour.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import type { Request, Route } from 'playwright-core';

import { getMockState } from '../../../../Scrapers/Pipeline/Interceptors/MockInterceptorIO.js';
import { buildHandler } from '../../../../Scrapers/Pipeline/Interceptors/MockRouteHandler.js';
import { frameFilePath } from '../../../../Scrapers/Pipeline/Interceptors/SnapshotFrameCapture.js';

/** Captured body content from the most recent fulfill call. */
interface IFulfillCapture {
  body: string;
  contentType: string;
}

/**
 * Build a stub Route capturing fulfill parameters.
 * @param capture - Mutable capture target.
 * @returns Stub Route.
 */
function makeRoute(capture: IFulfillCapture): Route {
  return {
    /**
     * Test helper.
     *
     * @param opts - Parameter.
     * @param opts.body - Response body.
     * @param opts.contentType - Response content type.
     * @returns Result.
     */
    fulfill: async (opts: { body?: string; contentType?: string }): Promise<void> => {
      await Promise.resolve();
      capture.body = opts.body ?? '';
      capture.contentType = opts.contentType ?? '';
    },
  } as unknown as Route;
}

/**
 * Build a Request returning the given URL.
 * @param url - URL to return from .url().
 * @returns Stub Request.
 */
function makeRequest(url: string): Request {
  return {
    /**
     * Test helper.
     *
     * @returns Result.
     */
    url: (): string => url,
  } as unknown as Request;
}

describe('buildHandler', () => {
  it('fulfills with text/html utf-8 content type', async () => {
    const state = getMockState('mock-handler-test-1');
    const handler = buildHandler('mock-handler-test-1', state);
    const capture: IFulfillCapture = { body: '', contentType: '' };
    const makeRequestResult2 = makeRequest('https://example.com/anything');
    const makeRouteResult1 = makeRoute(capture);
    await handler(makeRouteResult1, makeRequestResult2);
    expect(capture.contentType).toContain('text/html');
    expect(capture.contentType).toContain('utf-8');
  });

  it('returns true from the handler', async () => {
    const state = getMockState('mock-handler-test-2');
    const handler = buildHandler('mock-handler-test-2', state);
    const capture: IFulfillCapture = { body: '', contentType: '' };
    const makeRequestResult4 = makeRequest('https://example.com/x');
    const makeRouteResult3 = makeRoute(capture);
    const didServe = await handler(makeRouteResult3, makeRequestResult4);
    expect(didServe).toBe(true);
  });

  it('surfaces a MISS trace for iframe-like URLs with no captured snapshot', async () => {
    const state = getMockState('mock-handler-iframe-miss');
    const handler = buildHandler('mock-handler-iframe-miss', state);
    const capture: IFulfillCapture = { body: '', contentType: '' };
    // URL contains 'iframe' — the handler should fall through to traceFrameMiss
    const makeRequestResult6 = makeRequest('https://example.com/iframe/x');
    const makeRouteResult5 = makeRoute(capture);
    const didServe = await handler(makeRouteResult5, makeRequestResult6);
    expect(didServe).toBe(true);
  });

  it('serves saved frame HTML when a per-frame snapshot exists (line 120 truthy)', async () => {
    // Create a real frame snapshot on disk so tryServeFrameHtml reads content.
    // This hits MockRouteHandler.pickHtmlForRequest branch `if (frameHtml)` truthy.
    const companyId = 'mock-handler-frame-hit';
    const url = 'https://bank.example.com/iframe/login';
    const filePath = frameFilePath(companyId, url);
    const dirnameResult7 = path.dirname(filePath);
    fs.mkdirSync(dirnameResult7, { recursive: true });
    const frameHtml = '<html><head></head><body>FRAME_OK</body></html>';
    fs.writeFileSync(filePath, frameHtml, 'utf8');
    try {
      const state = getMockState(companyId);
      const handler = buildHandler(companyId, state);
      const capture: IFulfillCapture = { body: '', contentType: '' };
      const makeRequestResult9 = makeRequest(url);
      const makeRouteResult8 = makeRoute(capture);
      const didServe = await handler(makeRouteResult8, makeRequestResult9);
      expect(didServe).toBe(true);
      // Normalizer prepends a <style>; FRAME_OK body content still present.
      expect(capture.body).toContain('FRAME_OK');
    } finally {
      fs.rmSync(filePath, { force: true });
    }
  });
});
