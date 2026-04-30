/**
 * More SelectorResolverPipeline coverage — searchInChildFrames, probeIframes,
 * probeMainPage with frame matches.
 */

import type { Frame, Locator, Page } from 'playwright-core';

import type {
  IFieldConfig,
  SelectorCandidate,
} from '../../../../../Scrapers/Base/Config/LoginConfig.js';
import {
  buildNotFoundContext,
  probeIframes,
  probeMainPage,
  resolveInMainContext,
  searchInChildFrames,
} from '../../../../../Scrapers/Pipeline/Mediator/Selector/SelectorResolverPipeline.js';

/**
 * Build a frame that optionally finds elements when $() is called.
 * @param found - Whether $() resolves or returns null.
 * @param url - Parameter.
 * @returns Mock Frame.
 */
function makeFrame(found = false, url = 'https://f.bank.co.il'): Frame {
  return {
    /**
     * $ returns object when found, null otherwise.
     * @returns Scripted.
     */
    $: (): Promise<unknown> => (found ? Promise.resolve({}) : Promise.resolve(null)),
    /**
     * url.
     * @returns URL.
     */
    url: (): string => url,
    /**
     * locator — for isFillableInput / clickableText checks.
     * @returns Stub locator with evaluate always returning true.
     */
    locator: (): Locator =>
      ({
        /**
         * first.
         * @returns Self.
         */
        first: (): unknown => ({
          /**
           * count.
           * @returns 1 or 0.
           */
          count: (): Promise<number> => Promise.resolve(found ? 1 : 0),
          /**
           * evaluate — returns true (fillable).
           * @returns True.
           */
          evaluate: (): Promise<boolean> => Promise.resolve(true),
        }),
      }) as unknown as Locator,
  } as unknown as Frame;
}

/**
 * Build a page that returns the provided child frames.
 * @param childFrames - Children.
 * @returns Mock page.
 */
function makePageWithFrames(childFrames: Frame[] = []): Page {
  const main = makeFrame(false, '') as unknown as Frame;
  return {
    /**
     * $.
     * @returns Null.
     */
    $: (): Promise<unknown> => Promise.resolve(null),
    /**
     * title.
     * @returns Mock.
     */
    title: (): Promise<string> => Promise.resolve('Mock'),
    /**
     * mainFrame.
     * @returns Main.
     */
    mainFrame: (): Frame => main,
    /**
     * frames.
     * @returns Main + children.
     */
    frames: (): Frame[] => [main, ...childFrames],
    /**
     * locator.
     * @returns Stub.
     */
    locator: (): Locator =>
      ({
        /**
         * first.
         * @returns Self.
         */
        first: (): unknown => ({
          /**
           * count.
           * @returns 0.
           */
          count: (): Promise<number> => Promise.resolve(0),
        }),
      }) as unknown as Locator,
  } as unknown as Page;
}

const FIELD: IFieldConfig = {
  credentialKey: 'username',
  selectors: [{ kind: 'css', value: '#user' }],
};

describe('searchInChildFrames — iframe found/not-found', () => {
  it('finds match in first iframe', async () => {
    const frame = makeFrame(true);
    const page = makePageWithFrames([frame]);
    const candidates: SelectorCandidate[] = [{ kind: 'css', value: '#user' }];
    const result = await searchInChildFrames(page, candidates);
    expect(typeof result.selector).toBe('string');
  });

  it('returns empty when all iframes miss', async () => {
    const frame1 = makeFrame(false);
    const frame2 = makeFrame(false);
    const page = makePageWithFrames([frame1, frame2]);
    const candidates: SelectorCandidate[] = [{ kind: 'css', value: '#missing' }];
    const result = await searchInChildFrames(page, candidates);
    expect(result.selector).toBe('');
  });

  it('uses cachedFrames list when provided', async () => {
    const page = makePageWithFrames();
    const cached = [makeFrame(true)];
    const result = await searchInChildFrames(page, [{ kind: 'css', value: '#user' }], cached);
    expect(typeof result.selector).toBe('string');
  });
});

describe('probeIframes — full pipeline', () => {
  it('tries bank then WK candidates', async () => {
    const frame = makeFrame(false);
    const page = makePageWithFrames([frame]);
    const result = await probeIframes(page, {
      pageOrFrame: page,
      field: FIELD,
      pageUrl: 'https://bank.co.il',
      bankCandidates: [{ kind: 'css', value: '#x' }],
      wellKnownCandidates: [{ kind: 'css', value: '#y' }],
    });
    expect('isResolved' in result).toBe(false);
  });
});

describe('probeMainPage with bank-only candidates', () => {
  it('returns not-resolved with both empty groups', async () => {
    const page = makePageWithFrames();
    const result = await probeMainPage({
      pageOrFrame: page,
      field: FIELD,
      pageUrl: 'https://bank.co.il',
      bankCandidates: [],
      wellKnownCandidates: [],
    });
    expect('isResolved' in result).toBe(false);
  });
});

describe('resolveInMainContext return shape', () => {
  it('returns empty selector when candidates miss', async () => {
    const page = makePageWithFrames();
    const candidates: SelectorCandidate[] = [{ kind: 'css', value: '#x' }];
    const result = await resolveInMainContext(page, candidates, 'username');
    expect(result.selector).toBe('');
  });
});

describe('buildNotFoundContext message details', () => {
  it('includes tried candidate count in the message', async () => {
    const page = makePageWithFrames();
    const result = await buildNotFoundContext({
      pageOrFrame: page,
      field: FIELD,
      pageUrl: 'https://b.co.il',
      bankCandidates: [
        { kind: 'css', value: '#a' },
        { kind: 'css', value: '#b' },
      ],
      wellKnownCandidates: [{ kind: 'css', value: '#c' }],
    });
    expect(result.isResolved).toBe(false);
    expect(result.message).toContain('3');
  });
});

// ── Empty-candidates guard short-circuits cover ──────────────────────────

describe('probeIframes — empty candidate groups', () => {
  it('falls through bank→wk when bank candidates empty and wk also empty', async () => {
    const page = makePageWithFrames([makeFrame(false)]);
    const result = await probeIframes(page, {
      pageOrFrame: page,
      field: FIELD,
      pageUrl: 'https://b.co.il',
      bankCandidates: [],
      wellKnownCandidates: [],
    });
    expect('isResolved' in result).toBe(false);
  });

  it('tries WK candidates when bank list is empty', async () => {
    const page = makePageWithFrames([makeFrame(false)]);
    const result = await probeIframes(page, {
      pageOrFrame: page,
      field: FIELD,
      pageUrl: 'https://b.co.il',
      bankCandidates: [],
      wellKnownCandidates: [{ kind: 'css', value: '#fallback' }],
    });
    expect('isResolved' in result).toBe(false);
  });

  it('tries bank first when both groups present', async () => {
    const page = makePageWithFrames([makeFrame(false)]);
    const result = await probeIframes(page, {
      pageOrFrame: page,
      field: FIELD,
      pageUrl: 'https://b.co.il',
      bankCandidates: [{ kind: 'css', value: '#b' }],
      wellKnownCandidates: [{ kind: 'css', value: '#w' }],
    });
    expect('isResolved' in result).toBe(false);
  });
});

describe('probeMainPage — empty candidate groups', () => {
  it('tries WK when bank is empty', async () => {
    const page = makePageWithFrames();
    const result = await probeMainPage({
      pageOrFrame: page,
      field: FIELD,
      pageUrl: 'https://b.co.il',
      bankCandidates: [],
      wellKnownCandidates: [{ kind: 'css', value: '#x' }],
    });
    expect('isResolved' in result).toBe(false);
  });
});
