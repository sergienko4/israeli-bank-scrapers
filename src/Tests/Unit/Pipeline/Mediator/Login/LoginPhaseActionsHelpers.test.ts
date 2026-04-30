/**
 * Unit tests for the internal LoginPhaseActions helpers that cover
 * the multi-frame discoverErrors scan + the iframe-snapshot collector.
 * The helpers are exported (via `// @internal` comment) solely for
 * focused coverage in this suite.
 */

import type { Frame, Page as BrowserPage } from 'playwright-core';

import ScraperError from '../../../../../Scrapers/Base/ScraperError.js';
import type { IElementMediator } from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import type { IFormErrorScanResult } from '../../../../../Scrapers/Pipeline/Mediator/Form/FormErrorDiscovery.js';
import {
  collectIframeSnapshots,
  detectAsyncLoginErrors,
  discoverErrorsAllFrames,
  hasStayedOnLoginUrl,
  safeScanFrame,
} from '../../../../../Scrapers/Pipeline/Mediator/Login/LoginPhaseActions.js';
import type { IPipelineContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';

/**
 * Build a single Frame-like object that resolves to the supplied HTML
 * (or throws ScraperError('detached') when html === false).
 * @param html - Content string, or false for a detached frame.
 * @returns Frame-like stub.
 */
function makeFrameStub(html: string | false): Frame {
  return {
    /**
     * Read the captured HTML for this frame.
     * @returns Content string.
     */
    content: async (): Promise<string> => {
      await Promise.resolve();
      if (html === false) throw new ScraperError('detached');
      return html;
    },
  } as unknown as Frame;
}

/**
 * Build a page-like object with a configurable frame list. Main frame
 * is the first element of the supplied array.
 * @param frameHtmls - HTML content per frame (index 0 = main).
 * @returns BrowserPage-ish stub suitable for the helper tests.
 */
function makePageStub(frameHtmls: readonly (string | false)[]): BrowserPage {
  const framesArr = frameHtmls.map((html): Frame => makeFrameStub(html));
  const main = framesArr[0];
  return {
    /**
     * Return the frame list this stub was built with.
     * @returns Frames array.
     */
    frames: (): readonly Frame[] => framesArr,
    /**
     * Return the main frame (index 0 of frameHtmls).
     * @returns Main frame.
     */
    mainFrame: (): Frame => main,
    /**
     * Return the captured main-frame HTML.
     * @returns Main-frame HTML.
     */
    content: async (): Promise<string> => {
      await Promise.resolve();
      const html = frameHtmls[0];
      if (html === false) return '';
      return html;
    },
  } as unknown as BrowserPage;
}

/**
 * Build a mediator whose discoverErrors returns a scripted result per
 * frame identity.
 * @param scripts - Map from index-0-based integer → scan result.
 * @param pageStub - The BrowserPage stub used to order frames by identity.
 * @returns IElementMediator stub.
 */
function makeDiscoverMediator(
  scripts: readonly IFormErrorScanResult[],
  pageStub: BrowserPage,
): IElementMediator {
  const frames = [pageStub, ...pageStub.frames()];
  return {
    /**
     * Return the scripted scan for the given frame index.
     * @param target - Page or frame to scan.
     * @returns Scripted scan result.
     */
    discoverErrors: async (target: BrowserPage | Frame): Promise<IFormErrorScanResult> => {
      await Promise.resolve();
      const idx = frames.indexOf(target);
      if (idx === -1 || idx >= scripts.length) {
        return { hasErrors: false, errors: [], summary: '' };
      }
      return scripts[idx];
    },
  } as unknown as IElementMediator;
}

describe('LoginPhaseActions.discoverErrorsAllFrames', () => {
  it('returns first hit when the main frame has errors', async (): Promise<void> => {
    const pageStub = makePageStub(['<html></html>', '<iframe></iframe>']);
    const mediator = makeDiscoverMediator(
      [
        { hasErrors: true, errors: [], summary: 'main-err' },
        { hasErrors: false, errors: [], summary: '' },
      ],
      pageStub,
    );
    const result = await discoverErrorsAllFrames(mediator, pageStub);
    expect(result.hasErrors).toBe(true);
    expect(result.summary).toBe('main-err');
  });

  it('returns first iframe hit when the main frame is clean', async (): Promise<void> => {
    const pageStub = makePageStub(['<html></html>', '<iframe></iframe>', '<iframe></iframe>']);
    const mediator = makeDiscoverMediator(
      [
        { hasErrors: false, errors: [], summary: '' },
        { hasErrors: false, errors: [], summary: '' },
        { hasErrors: true, errors: [], summary: 'iframe-err' },
      ],
      pageStub,
    );
    const result = await discoverErrorsAllFrames(mediator, pageStub);
    expect(result.hasErrors).toBe(true);
    expect(result.summary).toBe('iframe-err');
  });

  it('returns FRAMES_NO_ERRORS when every frame is clean', async (): Promise<void> => {
    const pageStub = makePageStub(['<html></html>', '<iframe></iframe>']);
    const mediator = makeDiscoverMediator(
      [
        { hasErrors: false, errors: [], summary: '' },
        { hasErrors: false, errors: [], summary: '' },
      ],
      pageStub,
    );
    const result = await discoverErrorsAllFrames(mediator, pageStub);
    expect(result.hasErrors).toBe(false);
    expect(result.summary).toBe('');
  });

  it('swallows detached-frame rejections and continues', async (): Promise<void> => {
    const pageStub = makePageStub(['<html></html>', '<iframe></iframe>']);
    const throwing = {
      /**
       * Always throws to simulate a detached frame.
       * @returns Never returns (throws).
       */
      discoverErrors: async (): Promise<IFormErrorScanResult> => {
        await Promise.resolve();
        throw new ScraperError('frame detached');
      },
    } as unknown as IElementMediator;
    const result = await discoverErrorsAllFrames(throwing, pageStub);
    expect(result.hasErrors).toBe(false);
  });
});

describe('LoginPhaseActions.safeScanFrame', () => {
  it('returns FRAMES_NO_ERRORS on thrown discoverErrors', async (): Promise<void> => {
    const pageStub = makePageStub(['<html></html>']);
    const throwing = {
      /**
       * Simulate a navigation-rejection during scan.
       * @returns Never returns (throws).
       */
      discoverErrors: async (): Promise<IFormErrorScanResult> => {
        await Promise.resolve();
        throw new ScraperError('navigation');
      },
    } as unknown as IElementMediator;
    const result = await safeScanFrame(throwing, pageStub);
    expect(result.hasErrors).toBe(false);
    expect(result.summary).toBe('');
  });

  it('passes through a hit scan verbatim', async (): Promise<void> => {
    const pageStub = makePageStub(['<html></html>']);
    const hit = {
      /**
       * Return a canned error-hit scan.
       * @returns Error-hit scan result.
       */
      discoverErrors: async (): Promise<IFormErrorScanResult> => {
        await Promise.resolve();
        return { hasErrors: true, errors: [], summary: 'pass-through-err' };
      },
    } as unknown as IElementMediator;
    const result = await safeScanFrame(hit, pageStub);
    expect(result.hasErrors).toBe(true);
    expect(result.summary).toBe('pass-through-err');
  });
});

describe('LoginPhaseActions.collectIframeSnapshots', () => {
  it('returns all non-empty child iframe HTML snapshots', async (): Promise<void> => {
    const pageStub = makePageStub([
      '<html>main</html>',
      '<iframe-a></iframe-a>',
      '<iframe-b></iframe-b>',
    ]);
    const snaps = await collectIframeSnapshots(pageStub);
    expect(snaps).toHaveLength(2);
    expect(snaps[0].html).toBe('<iframe-a></iframe-a>');
    expect(snaps[1].html).toBe('<iframe-b></iframe-b>');
  });

  it('filters out empty iframe content', async (): Promise<void> => {
    const pageStub = makePageStub(['<html>main</html>', '', '<iframe-b></iframe-b>']);
    const snaps = await collectIframeSnapshots(pageStub);
    expect(snaps).toHaveLength(1);
    expect(snaps[0].html).toBe('<iframe-b></iframe-b>');
  });

  it('filters out detached iframes via catch fallback', async (): Promise<void> => {
    const pageStub = makePageStub(['<html>main</html>', false, '<iframe-b></iframe-b>']);
    const snaps = await collectIframeSnapshots(pageStub);
    expect(snaps).toHaveLength(1);
    expect(snaps[0].html).toBe('<iframe-b></iframe-b>');
  });

  it('returns empty array when page has only a main frame', async (): Promise<void> => {
    const pageStub = makePageStub(['<html>main</html>']);
    const snaps = await collectIframeSnapshots(pageStub);
    expect(snaps).toHaveLength(0);
  });
});

describe('LoginPhaseActions.hasStayedOnLoginUrl', () => {
  /**
   * Build an IElementMediator stub that returns a fixed currentUrl.
   * @param currentUrl - URL string the mediator reports.
   * @returns Mediator stub.
   */
  function makeUrlMediator(currentUrl: string): IElementMediator {
    return {
      /**
       * Return the configured current URL.
       * @returns URL string.
       */
      getCurrentUrl: (): string => currentUrl,
    } as unknown as IElementMediator;
  }

  /**
   * Build an IPipelineContext stub with the given diagnostics.loginUrl.
   * @param loginUrl - Original login URL captured at phase start.
   * @returns Context stub.
   */
  function makeCtxWithLoginUrl(loginUrl: string): IPipelineContext {
    return { diagnostics: { loginUrl } } as unknown as IPipelineContext;
  }

  it('returns true when diagnostics.loginUrl is empty (no baseline)', (): void => {
    const mediator = makeUrlMediator('https://bank.example.com/anywhere');
    const ctx = makeCtxWithLoginUrl('');
    const isStayed = hasStayedOnLoginUrl(mediator, ctx);
    expect(isStayed).toBe(true);
  });

  it('returns true when current URL equals loginUrl verbatim', (): void => {
    const url = 'https://bank.example.com/login';
    const mediator = makeUrlMediator(url);
    const ctx = makeCtxWithLoginUrl(url);
    const isStayed = hasStayedOnLoginUrl(mediator, ctx);
    expect(isStayed).toBe(true);
  });

  it('returns true when current URL is loginUrl + "#" (SPA hash stay)', (): void => {
    const url = 'https://bank.example.com/login';
    const mediator = makeUrlMediator(`${url}#`);
    const ctx = makeCtxWithLoginUrl(url);
    const isStayed = hasStayedOnLoginUrl(mediator, ctx);
    expect(isStayed).toBe(true);
  });

  it('returns true when pathnames match (query-string divergence)', (): void => {
    const mediator = makeUrlMediator('https://bank.example.com/login?err=1');
    const ctx = makeCtxWithLoginUrl('https://bank.example.com/login');
    const isStayed = hasStayedOnLoginUrl(mediator, ctx);
    expect(isStayed).toBe(true);
  });

  it('returns false when current URL is a different path (redirect happened)', (): void => {
    const mediator = makeUrlMediator('https://bank.example.com/dashboard');
    const ctx = makeCtxWithLoginUrl('https://bank.example.com/login');
    const isStayed = hasStayedOnLoginUrl(mediator, ctx);
    expect(isStayed).toBe(false);
  });
});

describe('LoginPhaseActions.detectAsyncLoginErrors', () => {
  it('returns false when URL moved off loginUrl (redirect succeeded)', async (): Promise<void> => {
    const mediator = {
      /**
       * Return dashboard URL.
       * @returns URL string.
       */
      getCurrentUrl: (): string => 'https://bank.example.com/dashboard',
    } as unknown as IElementMediator;
    const ctx = {
      diagnostics: { loginUrl: 'https://bank.example.com/login' },
      browser: { has: false },
    } as unknown as IPipelineContext;
    const result = await detectAsyncLoginErrors(mediator, ctx);
    expect(result).toBe(false);
  });

  it('returns false when browser slot is absent (mock-only context)', async (): Promise<void> => {
    const mediator = {
      /**
       * Return same URL (no redirect).
       * @returns URL string.
       */
      getCurrentUrl: (): string => 'https://bank.example.com/login',
    } as unknown as IElementMediator;
    const ctx = {
      diagnostics: { loginUrl: 'https://bank.example.com/login' },
      browser: { has: false },
    } as unknown as IPipelineContext;
    const result = await detectAsyncLoginErrors(mediator, ctx);
    expect(result).toBe(false);
  });
});
