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

describe('FrameRegistry — sibling frames that share a base contextId', () => {
  it('gives two same-URL siblings distinct contextIds', () => {
    const frameA = makeFrame('https://bank.co.il/otp?session=A');
    const frameB = makeFrame('https://bank.co.il/otp?session=B');
    const page = makePage([frameA, frameB]);
    const idA = computeContextId(frameA, page);
    const idB = computeContextId(frameB, page);
    expect(idA).not.toBe(idB);
  });

  it('keeps every colliding sibling reachable in the registry', () => {
    const frameA = makeFrame('https://bank.co.il/otp?session=A');
    const frameB = makeFrame('https://bank.co.il/otp?session=B');
    const frameC = makeFrame('https://bank.co.il/otp?session=C');
    const page = makePage([frameA, frameB, frameC]);
    const registry = buildFrameRegistry(page);
    const ids = [frameA, frameB, frameC].map((f): string => computeContextId(f, page));
    const resolved = ids.map((id): Page | Frame => resolveFrame(registry, id));
    expect(resolved).toStrictEqual([frameA, frameB, frameC]);
  });

  it('resolves a PRE contextId to the SAME frame at ACTION time', () => {
    const frameA = makeFrame('https://bank.co.il/otp?session=A');
    const frameB = makeFrame('https://bank.co.il/otp?session=B');
    const page = makePage([frameA, frameB]);
    const preId = computeContextId(frameA, page);
    const registry = buildFrameRegistry(page);
    const actionFrame = resolveFrame(registry, preId);
    expect(actionFrame).toBe(frameA);
  });

  it('separates two unnamed about:blank siblings', () => {
    const frameA = makeFrame('about:blank');
    const frameB = makeFrame('about:blank');
    const page = makePage([frameA, frameB]);
    const registry = buildFrameRegistry(page);
    const idA = computeContextId(frameA, page);
    const resolveFrameResult8 = resolveFrame(registry, idA);
    expect(resolveFrameResult8).toBe(frameA);
  });

  it('leaves non-colliding frames on their bare contextId', () => {
    const frameA = makeFrame('https://bank.co.il/otp');
    const frameB = makeFrame('https://bank.co.il/menu');
    const page = makePage([frameA, frameB]);
    const idA = computeContextId(frameA, page);
    expect(idA).toBe('iframe:https://bank.co.il/otp');
  });

  it('leaves a lone frame on its bare contextId', () => {
    const frameA = makeFrame('https://bank.co.il/otp?session=A');
    const page = makePage([frameA]);
    const idA = computeContextId(frameA, page);
    expect(idA).toBe('iframe:https://bank.co.il/otp');
  });

  it('still resolves the bare base id when siblings collide', () => {
    const frameA = makeFrame('https://bank.co.il/otp?session=A');
    const frameB = makeFrame('https://bank.co.il/otp?session=B');
    const page = makePage([frameA, frameB]);
    const registry = buildFrameRegistry(page);
    const resolveFrameResult9 = resolveFrame(registry, 'iframe:https://bank.co.il/otp');
    expect(resolveFrameResult9).toBe(frameB);
  });

  it('falls back to the base id when the colliding sibling detached', () => {
    const frameA = makeFrame('https://bank.co.il/otp?session=A');
    const frameB = makeFrame('https://bank.co.il/otp?session=B');
    const prePage = makePage([frameA, frameB]);
    const preId = computeContextId(frameB, prePage);
    const actionPage = makePage([frameB]);
    const registry = buildFrameRegistry(actionPage);
    const actionFrame = resolveFrame(registry, preId);
    expect(actionFrame).toBe(frameB);
  });
});
