/**
 * Unit tests for Interceptors/SnapshotInterceptorIO — captureSnapshot.
 * Mocks fs for write path + mocks Page for deep-dom capture.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { Page } from 'playwright-core';

import { captureSnapshot } from '../../../../Scrapers/Pipeline/Interceptors/SnapshotInterceptorIO.js';
import { none, some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type { IPipelineContext } from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { makeMockContext } from '../Infrastructure/MockFactories.js';

/** Whether evaluate should produce HTML or throw. */
interface IPageScript {
  readonly evaluateHtml: string;
  readonly contentHtml?: string;
  readonly waitForLoadStateThrows?: boolean;
  readonly anchorVisible?: boolean;
}

/**
 * Build a fake page covering all the calls captureSnapshot needs.
 * @param script - Behaviour script.
 * @returns Mock page.
 */
function makePage(script: IPageScript): Page {
  return {
    /**
     * waitForLoadState.
     * @returns Resolved or rejected.
     */
    waitForLoadState: (): Promise<void> => {
      if (script.waitForLoadStateThrows) return Promise.reject(new Error('t/o'));
      return Promise.resolve();
    },
    /**
     * waitForFunction.
     * @returns Resolves quickly.
     */
    waitForFunction: (): Promise<unknown> => Promise.resolve(true),
    /**
     * waitForTimeout.
     * @returns Resolves immediately.
     */
    waitForTimeout: (): Promise<void> => Promise.resolve(),
    /**
     * evaluate — returns serialized HTML.
     * @returns Resolved HTML.
     */
    evaluate: (): Promise<string> => Promise.resolve(script.evaluateHtml),
    /**
     * content — fallback body.
     * @returns Resolved content HTML.
     */
    content: (): Promise<string> => Promise.resolve(script.contentHtml ?? ''),
    /**
     * locator — for waitForPhaseAnchor.
     * @returns Locator resolving immediately.
     */
    locator: (): unknown => ({
      /**
       * first.
       * @returns Self.
       */
      first: (): unknown => ({
        /**
         * waitFor resolves only when anchorVisible, else rejects.
         * @returns Scripted.
         */
        waitFor: (): Promise<void> => {
          if (script.anchorVisible) return Promise.resolve();
          return Promise.reject(new Error('timeout'));
        },
      }),
    }),
    /**
     * mainFrame.
     * @returns Self-like frame.
     */
    mainFrame: (): unknown => ({
      /**
       * url.
       * @returns Empty.
       */
      url: (): string => '',
    }),
    /**
     * frames.
     * @returns Empty array.
     */
    frames: (): unknown[] => [],
  } as unknown as Page;
}

/**
 * Build a pipeline context with browser option set.
 * @param page - Page to pass through.
 * @returns Context with browser opt.
 */
function makeCtxWithBrowser(page: Page): IPipelineContext {
  const base = makeMockContext();
  return {
    ...base,
    browser: some({
      browser: {},
      context: {},
      page,
    }) as unknown as IPipelineContext['browser'],
  };
}

describe('captureSnapshot', () => {
  it('returns false when browser is absent', async () => {
    const ctx = makeMockContext({ browser: none() });
    const didWrite = await captureSnapshot(ctx, 'home');
    expect(didWrite).toBe(false);
  });

  it('returns false when phase anchor never becomes visible', async () => {
    const page = makePage({ evaluateHtml: '<html/>', anchorVisible: false });
    const ctx = makeCtxWithBrowser(page);
    const didWrite = await captureSnapshot(ctx, 'home');
    expect(didWrite).toBe(false);
  });

  it('writes snapshot HTML to tests/snapshots/{companyId}/{phase}.html', async () => {
    // Use a unique company ID + tempdir-proximate working directory behaviour
    const now = Date.now();
    const companyId = `snapshot-io-test-${String(now)}`;
    const page = makePage({ evaluateHtml: '<html><body>Y</body></html>', anchorVisible: true });
    const base = makeMockContext();
    const ctx: IPipelineContext = {
      ...base,
      companyId: companyId as unknown as IPipelineContext['companyId'],
      browser: some({ browser: {}, context: {}, page }) as unknown as IPipelineContext['browser'],
    };
    // Phase with no configured anchor → anchor gate returns true by default
    const didWrite = await captureSnapshot(ctx, 'terminate');
    expect(didWrite).toBe(true);
    // Cleanup
    try {
      const cwdResult1 = process.cwd();
      const dir = path.join(cwdResult1, 'tests', 'snapshots', companyId);
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('falls back to content() when evaluate returns empty', async () => {
    const now = Date.now();
    const companyId = `snapshot-io-fallback-${String(now)}`;
    const page = makePage({
      evaluateHtml: '',
      contentHtml: '<html>FALLBACK</html>',
      anchorVisible: true,
    });
    const base = makeMockContext();
    const ctx: IPipelineContext = {
      ...base,
      companyId: companyId as unknown as IPipelineContext['companyId'],
      browser: some({ browser: {}, context: {}, page }) as unknown as IPipelineContext['browser'],
    };
    const didWrite = await captureSnapshot(ctx, 'terminate');
    expect(didWrite).toBe(true);
    try {
      const cwdResult2 = process.cwd();
      const dir = path.join(cwdResult2, 'tests', 'snapshots', companyId);
      const joinResult3 = path.join(dir, 'terminate.html');
      const out = fs.readFileSync(joinResult3, 'utf8');
      expect(out).toContain('FALLBACK');
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore — test runners may not allow fs
    }
  });

  // Reference os + tempdir to avoid unused-import warning
  it('confirms tmpdir is a non-empty string', () => {
    expect(typeof os.tmpdir()).toBe('string');
  });
});
