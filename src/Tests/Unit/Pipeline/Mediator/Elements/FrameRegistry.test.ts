/**
 * Unit tests for FrameRegistry — contextId computation + frame resolution.
 */

import type { Frame, Page } from 'playwright-core';

import {
  buildFrameRegistry,
  computeContextId,
  isSameContext,
  MAIN_CONTEXT_ID,
  resolveFrame,
} from '../../../../../Scrapers/Pipeline/Mediator/Elements/FrameRegistry.js';
import { makeMockFrame as makeFrame, makeMockPage as makePage } from './FrameMocks.js';

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
    const didContainResult3 = id.includes('iframe:https://iframe.co.il');
    expect(didContainResult3).toBe(true);
    expect(id).not.toContain('session=');
  });

  it('builds iframe:<name> for about:blank frames', () => {
    const childFrame = makeFrame('about:blank', 'otp-frame');
    const page = makePage([childFrame]);
    const computeContextIdResult4 = computeContextId(childFrame, page);
    const didEndWithResult4 = computeContextIdResult4.endsWith('iframe:otp-frame');
    expect(didEndWithResult4).toBe(true);
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

  it('keeps the content base in the id of a non-colliding frame', () => {
    const frameA = makeFrame('https://bank.co.il/otp');
    const frameB = makeFrame('https://bank.co.il/menu');
    const page = makePage([frameA, frameB]);
    const idA = computeContextId(frameA, page);
    const didEndWithResultA = idA.endsWith('iframe:https://bank.co.il/otp');
    expect(didEndWithResultA).toBe(true);
  });

  it('keeps the content base in the id of a lone frame', () => {
    const frameA = makeFrame('https://bank.co.il/otp?session=A');
    const page = makePage([frameA]);
    const idA = computeContextId(frameA, page);
    const didEndWithResultB = idA.endsWith('iframe:https://bank.co.il/otp');
    expect(didEndWithResultB).toBe(true);
  });

  it('narrows a frame id to identity when a sibling makes its base ambiguous', () => {
    const frameA = makeFrame('https://bank.co.il/otp?session=A');
    const lonePage = makePage([frameA]);
    const idBefore = computeContextId(frameA, lonePage);
    const frameB = makeFrame('https://bank.co.il/otp?session=B');
    const crowdedPage = makePage([frameA, frameB]);
    const idAfter = computeContextId(frameA, crowdedPage);
    const didKeepBase = idAfter.includes('iframe:');
    expect(didKeepBase).toBe(false);
    const registry = buildFrameRegistry(crowdedPage);
    const stillFrameA = resolveFrame(registry, idBefore);
    expect(stillFrameA).toBe(frameA);
  });

  it('refuses a dead ambiguous id rather than fall back to its sibling', () => {
    const frameA = makeFrame('https://bank.co.il/otp?session=A');
    const frameB = makeFrame('https://bank.co.il/otp?session=B');
    const prePage = makePage([frameA, frameB]);
    const preId = computeContextId(frameA, prePage);
    const survivorPage = makePage([frameB]);
    const registry = buildFrameRegistry(survivorPage);
    expect(() => resolveFrame(registry, preId)).toThrow();
  });

  it('refuses to guess when colliding siblings share a base id', () => {
    const frameA = makeFrame('https://bank.co.il/otp?session=A');
    const frameB = makeFrame('https://bank.co.il/otp?session=B');
    const page = makePage([frameA, frameB]);
    const registry = buildFrameRegistry(page);
    const bareBase = 'iframe:https://bank.co.il/otp';
    expect(() => resolveFrame(registry, bareBase)).toThrow();
  });

  it('throws rather than pick a sibling when both re-attached', () => {
    const frameA = makeFrame('https://bank.co.il/otp?session=A');
    const frameB = makeFrame('https://bank.co.il/otp?session=B');
    const prePage = makePage([frameA, frameB]);
    const preId = computeContextId(frameA, prePage);
    const frameA2 = makeFrame('https://bank.co.il/otp?session=A2');
    const frameB2 = makeFrame('https://bank.co.il/otp?session=B2');
    const actionPage = makePage([frameA2, frameB2]);
    const registry = buildFrameRegistry(actionPage);
    expect(() => resolveFrame(registry, preId)).toThrow();
  });

  it('falls back to the content base when the frame re-attached', () => {
    const frameA = makeFrame('https://bank.co.il/otp?session=A');
    const prePage = makePage([frameA]);
    const preId = computeContextId(frameA, prePage);
    const frameA2 = makeFrame('https://bank.co.il/otp?session=A2');
    const actionPage = makePage([frameA2]);
    const registry = buildFrameRegistry(actionPage);
    const actionFrame = resolveFrame(registry, preId);
    expect(actionFrame).toBe(frameA2);
  });

  it('treats a frame name containing the token separator as content', () => {
    const frameA = makeFrame('about:blank', 'flow|otp');
    const frameB = makeFrame('about:blank', 'menu');
    const page = makePage([frameA, frameB]);
    const idA = computeContextId(frameA, page);
    const didKeepNameWhole = idA.endsWith('|iframe:flow|otp');
    expect(didKeepNameWhole).toBe(true);
    const registry = buildFrameRegistry(page);
    const byExactId = resolveFrame(registry, idA);
    expect(byExactId).toBe(frameA);
    const byBareName = resolveFrame(registry, 'iframe:flow|otp');
    expect(byBareName).toBe(frameA);
  });

  it('refuses to read a dead frame name as a token prefix', () => {
    // A frame named `login|iframe:otp` has the exact shape of a tokenised
    // id. Once it dies, mis-reading its name as `<token>|<base>` would
    // strip the prefix and hand back whichever frame owns `iframe:otp`.
    const decoy = makeFrame('about:blank', 'otp');
    const page = makePage([decoy]);
    const decoyId = computeContextId(decoy, page);
    const didUseNameAsBase = decoyId.endsWith('iframe:otp');
    expect(didUseNameAsBase).toBe(true);
    const registry = buildFrameRegistry(page);
    expect(() => resolveFrame(registry, 'iframe:login|iframe:otp')).toThrow();
  });

  it('refuses an id whose token is not followed by a real base', () => {
    // A corrupted id must not resolve on its identity half alone: the
    // token names a live frame, but the id as a whole names nothing.
    const frame = makeFrame('https://bank.co.il/otp');
    const page = makePage([frame]);
    const realId = computeContextId(frame, page);
    const cut = realId.indexOf('|');
    const token = realId.slice(0, cut);
    const registry = buildFrameRegistry(page);
    expect(() => resolveFrame(registry, `${token}|garbage`)).toThrow();
  });

  it('does not let one frame id clobber a similarly named frame', () => {
    const frameC = makeFrame('about:blank', 'flow#0');
    const frameA = makeFrame('about:blank', 'flow');
    const frameB = makeFrame('about:blank', 'flow');
    const page = makePage([frameC, frameA, frameB]);
    const idC = computeContextId(frameC, page);
    const registry = buildFrameRegistry(page);
    const clobberResult = resolveFrame(registry, idC);
    expect(clobberResult).toBe(frameC);
  });

  it('resolves the right frame after the frame order changed', () => {
    const frameA = makeFrame('https://bank.co.il/otp?session=A');
    const frameB = makeFrame('https://bank.co.il/otp?session=B');
    const prePage = makePage([frameA, frameB]);
    const preId = computeContextId(frameA, prePage);
    const actionPage = makePage([frameB, frameA]);
    const registry = buildFrameRegistry(actionPage);
    const reorderResult = resolveFrame(registry, preId);
    expect(reorderResult).toBe(frameA);
  });

  it('resolves the same live frame after it navigated', () => {
    const otp = makeFrame('https://bank.co.il/otp');
    const menu = makeFrame('https://bank.co.il/menu');
    const prePage = makePage([otp, menu]);
    const preId = computeContextId(otp, prePage);
    const navigated = otp as unknown as { url: () => string };
    /**
     * The frame's URL after it navigated.
     * @returns The new URL string.
     */
    navigated.url = (): string => 'https://bank.co.il/otp/step-2';
    const actionPage = makePage([otp, menu]);
    const registry = buildFrameRegistry(actionPage);
    const navigateResult = resolveFrame(registry, preId);
    expect(navigateResult).toBe(otp);
  });
});

/** Child-frame URL sets spanning unique, shared and mixed base ids. */
const FRAME_POPULATIONS: readonly (readonly string[])[] = [
  [],
  ['https://bank.co.il/otp'],
  ['https://bank.co.il/otp', 'https://bank.co.il/menu'],
  ['https://bank.co.il/otp?s=A', 'https://bank.co.il/otp?s=B'],
  ['https://bank.co.il/otp?s=A', 'https://bank.co.il/otp?s=B', 'https://bank.co.il/menu'],
  ['https://bank.co.il/otp?s=A', 'https://bank.co.il/otp?s=B', 'https://bank.co.il/otp?s=C'],
  ['about:blank', 'about:blank'],
];

/**
 * Build a page whose child frames carry the given URLs.
 * @param urls - One URL per child frame.
 * @returns The child frames and the page holding them.
 */
function makePopulation(urls: readonly string[]): { frames: Frame[]; page: Page } {
  const frames = urls.map((url): Frame => makeFrame(url));
  const page = makePage(frames);
  return { frames, page };
}

/**
 * Whether a population's registry carries a key that names no frame.
 * @param urls - One URL per child frame.
 * @returns True when the built registry holds an empty key.
 */
function hasEmptyRegistryKey(urls: readonly string[]): boolean {
  const built = makePopulation(urls);
  const registry = buildFrameRegistry(built.page);
  return registry.has('');
}

/**
 * Mint an id for every frame in a population and resolve it back.
 * @param urls - One URL per child frame.
 * @returns One label per frame whose own id did not resolve to itself.
 */
function roundTripFailures(urls: readonly string[]): string[] {
  const built = makePopulation(urls);
  const registry = buildFrameRegistry(built.page);
  const label = urls.join(',');
  const failures: string[] = [];
  for (const [index, frame] of built.frames.entries()) {
    const id = computeContextId(frame, built.page);
    const resolved = resolveFrame(registry, id);
    const isSelf = resolved === frame;
    if (!isSelf) failures.push(`[${label}] frame #${String(index)} minted ${id}`);
  }
  return failures;
}

describe('FrameRegistry — invariants that hold for every frame population', () => {
  it('never registers a frame under a key that names no frame', () => {
    const emptyKeyed = FRAME_POPULATIONS.filter(hasEmptyRegistryKey);
    expect(emptyKeyed).toStrictEqual([]);
  });

  it('resolves every minted id back to the frame it was minted from', () => {
    const failures = FRAME_POPULATIONS.flatMap(roundTripFailures);
    expect(failures).toStrictEqual([]);
  });

  it('refuses an empty contextId instead of guessing a frame', () => {
    const frameA = makeFrame('https://bank.co.il/otp?session=A');
    const frameB = makeFrame('https://bank.co.il/otp?session=B');
    const page = makePage([frameA, frameB]);
    const registry = buildFrameRegistry(page);
    expect(() => resolveFrame(registry, '')).toThrow();
  });
});

describe('isSameContext', () => {
  it('sees one logical frame through a re-attachment', () => {
    const frameA = makeFrame('https://bank.co.il/login');
    const prePage = makePage([frameA]);
    const firstId = computeContextId(frameA, prePage);
    const frameA2 = makeFrame('https://bank.co.il/login');
    const laterPage = makePage([frameA2]);
    const secondId = computeContextId(frameA2, laterPage);
    expect(firstId).not.toBe(secondId);
    const isReattachSame = isSameContext(laterPage, firstId, secondId);
    expect(isReattachSame).toBe(true);
  });

  it('keeps two frames with different content apart', () => {
    const otp = makeFrame('https://bank.co.il/otp');
    const menu = makeFrame('https://bank.co.il/menu');
    const page = makePage([otp, menu]);
    const otpId = computeContextId(otp, page);
    const menuId = computeContextId(menu, page);
    const isDifferentSame = isSameContext(page, otpId, menuId);
    expect(isDifferentSame).toBe(false);
  });

  it('sees one frame across a sibling appearing mid-phase', () => {
    const frameA = makeFrame('https://bank.co.il/login');
    const lonePage = makePage([frameA]);
    const earlyId = computeContextId(frameA, lonePage);
    const frameB = makeFrame('https://bank.co.il/login');
    const crowdedPage = makePage([frameA, frameB]);
    const lateId = computeContextId(frameA, crowdedPage);
    expect(earlyId).not.toBe(lateId);
    const isStillSame = isSameContext(crowdedPage, earlyId, lateId);
    expect(isStillSame).toBe(true);
  });

  it('keeps two live frames sharing one base apart', () => {
    const first = makeFrame('https://bank.co.il/login');
    const second = makeFrame('https://bank.co.il/login');
    const page = makePage([first, second]);
    const firstId = computeContextId(first, page);
    const secondId = computeContextId(second, page);
    const isSiblingSame = isSameContext(page, firstId, secondId);
    expect(isSiblingSame).toBe(false);
  });

  it('refuses to match an id that no longer resolves', () => {
    const gone = makeFrame('https://bank.co.il/otp');
    const prePage = makePage([gone]);
    const goneId = computeContextId(gone, prePage);
    const menu = makeFrame('https://bank.co.il/menu');
    const laterPage = makePage([menu]);
    const menuId = computeContextId(menu, laterPage);
    const isGoneSame = isSameContext(laterPage, goneId, menuId);
    expect(isGoneSame).toBe(false);
  });

  it('never mistakes the page itself for a frame inside it', () => {
    const inner = makeFrame('https://bank.co.il/otp');
    const page = makePage([inner]);
    const innerId = computeContextId(inner, page);
    const isMixedSame = isSameContext(page, MAIN_CONTEXT_ID, innerId);
    expect(isMixedSame).toBe(false);
  });

  it('matches an id against itself even after its frame is gone', () => {
    const gone = makeFrame('https://bank.co.il/otp');
    const prePage = makePage([gone]);
    const goneId = computeContextId(gone, prePage);
    const emptyPage = makePage([]);
    const isSelfSame = isSameContext(emptyPage, goneId, goneId);
    expect(isSelfSame).toBe(true);
  });

  it('refuses to match an id that names no frame at all', () => {
    const frameA = makeFrame('https://bank.co.il/otp?session=A');
    const frameB = makeFrame('https://bank.co.il/otp?session=B');
    const page = makePage([frameA, frameB]);
    const idB = computeContextId(frameB, page);
    const isEmptySame = isSameContext(page, '', idB);
    expect(isEmptySame).toBe(false);
  });
});
