/**
 * Unit tests for FrameRegistry — contextId computation + frame resolution.
 */

import type { Frame, Page } from 'playwright-core';

import {
  buildFrameRegistry,
  computeContextId,
  MAIN_CONTEXT_ID,
  resolveFrame,
} from '../../../../../Scrapers/Pipeline/Mediator/Elements/FrameRegistry.js';

/**
 * Build a minimal mock Frame.
 * @param url - Frame URL.
 * @param name - Frame name attribute.
 * @returns Mock frame.
 */
function makeFrame(url: string, name = ''): Frame {
  return {
    /**
     * Frame URL.
     * @returns URL string.
     */
    url: (): string => url,
    /**
     * Frame name.
     * @returns Name string.
     */
    name: (): string => name,
  } as unknown as Frame;
}

/**
 * Build a minimal mock Page that returns a list of frames.
 * @param frames - Child frames (excluding main).
 * @param mainFrame - Explicit main frame.
 * @returns Mock page.
 */
function makePage(frames: Frame[], mainFrame: Frame = makeFrame('about:main')): Page {
  const all = [mainFrame, ...frames];
  return {
    /**
     * Return all frames including main.
     * @returns Frame array.
     */
    frames: (): Frame[] => all,
    /**
     * Return main frame.
     * @returns Main frame.
     */
    mainFrame: (): Frame => mainFrame,
  } as unknown as Page;
}

describe('computeContextId', () => {
  it('returns MAIN when context equals the page', () => {
    const page = makePage([]);
    const computeContextIdResult1 = computeContextId(page, page);
    expect(computeContextIdResult1).toBe(MAIN_CONTEXT_ID);
  });

  it('returns MAIN when context is the main frame', () => {
    const mainFrame = makeFrame('https://bank.co.il/');
    const page = makePage([], mainFrame);
    const computeContextIdResult2 = computeContextId(mainFrame, page);
    expect(computeContextIdResult2).toBe(MAIN_CONTEXT_ID);
  });

  it('builds iframe:<stable-url> for frames with a real URL', () => {
    const childFrame = makeFrame('https://iframe.co.il/page?session=abc');
    const page = makePage([childFrame]);
    const id = computeContextId(childFrame, page);
    const didStartWithResult3 = id.startsWith('iframe:https://iframe.co.il');
    expect(didStartWithResult3).toBe(true);
    expect(id).not.toContain('session=');
  });

  it('builds iframe:<name> for about:blank frames', () => {
    const childFrame = makeFrame('about:blank', 'otp-frame');
    const page = makePage([childFrame]);
    const computeContextIdResult4 = computeContextId(childFrame, page);
    expect(computeContextIdResult4).toBe('iframe:otp-frame');
  });

  it('falls back to raw URL when URL parsing fails', () => {
    const childFrame = makeFrame('http://valid.co.il/path?q=1');
    const page = makePage([childFrame]);
    const id = computeContextId(childFrame, page);
    expect(id).toContain('valid.co.il');
    expect(id).not.toContain('q=1');
  });
});

describe('buildFrameRegistry + resolveFrame', () => {
  it('maps main and all child frames to their contextIds', () => {
    const child = makeFrame('https://child.co.il/');
    const page = makePage([child]);
    const registry = buildFrameRegistry(page);
    const getResult5 = registry.get(MAIN_CONTEXT_ID);
    expect(getResult5).toBe(page);
    const resolveFrameResult6 = resolveFrame(registry, 'iframe:https://child.co.il/');
    expect(resolveFrameResult6).toBe(child);
  });

  it('resolveFrame throws ScraperError for unknown contextId', () => {
    const page = makePage([]);
    const registry = buildFrameRegistry(page);
    expect(() => resolveFrame(registry, 'iframe:does-not-exist')).toThrow();
  });

  it('main page always resolvable after build', () => {
    const page = makePage([]);
    const registry = buildFrameRegistry(page);
    const resolveFrameResult7 = resolveFrame(registry, MAIN_CONTEXT_ID);
    expect(resolveFrameResult7).toBe(page);
  });
});
