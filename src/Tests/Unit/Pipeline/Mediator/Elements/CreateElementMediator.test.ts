/**
 * Unit tests for createElementMediator — factory functions for element interaction.
 * Exercises: navigateTo, getCurrentUrl, waitForNetworkIdle, countByText,
 * getAttributeValue, checkAttribute, collectAllHrefs, waitForURL, getCookies.
 */

import type { BrowserContext, Locator, Page } from 'playwright-core';

import createElementMediator, {
  extractActionMediator,
} from '../../../../../Scrapers/Pipeline/Mediator/Elements/CreateElementMediator.js';
import type { IRaceResult } from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';

/** Mock cookie entry returned by context.cookies(). */
interface IMockCookie {
  readonly name: string;
  readonly value: string;
  readonly domain: string;
  readonly path: string;
}

/** Script for mocking Playwright Page behaviour. */
interface IPageScript {
  readonly url: string;
  readonly waitLoadStateThrows?: boolean;
  readonly waitUrlThrows?: boolean;
  readonly countByText?: number;
  readonly anchorHrefs?: readonly string[];
  readonly cookies?: readonly IMockCookie[];
}

/**
 * Build a mock Locator that cooperates with the mediator builders.
 * @param count - Scripted count.
 * @param attrValue - getAttribute return value.
 * @returns Mock locator.
 */
function makeLocator(count = 0, attrValue: string | false = false): Locator {
  const self: unknown = {
    /**
     * First.
     * @returns Self.
     */
    first: (): Locator => self as Locator,
    /**
     * Count.
     * @returns Scripted count.
     */
    count: (): Promise<number> => Promise.resolve(count),
    /**
     * getAttribute.
     * @returns Scripted attr.
     */
    getAttribute: (): Promise<string | false> => Promise.resolve(attrValue),
    /**
     * evaluateAll — empty.
     * @returns Empty array.
     */
    evaluateAll: (): Promise<unknown[]> => Promise.resolve([]),
  };
  return self as Locator;
}

/**
 * Build a mock Page with scripted behaviour.
 * @param script - Page behaviour script.
 * @returns Mock page.
 */
function makePage(script: IPageScript): Page {
  const anchors = script.anchorHrefs ?? [];
  return {
    /**
     * goto.
     * @returns Resolves.
     */
    goto: (): Promise<false> => Promise.resolve(false),
    /**
     * url.
     * @returns Scripted URL.
     */
    url: (): string => script.url,
    /**
     * on — no-op.
     * @returns Self.
     */
    on: (): Page => ({}) as Page,
    /**
     * waitForResponse.
     * @returns Never-resolving.
     */
    waitForResponse: (): Promise<false> => Promise.race([]),
    /**
     * frames — empty.
     * @returns Array.
     */
    frames: (): Page[] => [],
    /**
     * mainFrame — self.
     * @returns Self.
     */
    mainFrame: (): Page => makePage(script),
    /**
     * waitForLoadState.
     * @returns Scripted.
     */
    waitForLoadState: (): Promise<boolean> => {
      if (script.waitLoadStateThrows) return Promise.reject(new Error('timeout'));
      return Promise.resolve(true);
    },
    /**
     * waitForURL.
     * @returns Scripted.
     */
    waitForURL: (): Promise<boolean> => {
      if (script.waitUrlThrows) return Promise.reject(new Error('t/o'));
      return Promise.resolve(true);
    },
    /**
     * getByText — returns locator with scripted count.
     * @returns Mock locator.
     */
    getByText: (): Locator => makeLocator(script.countByText ?? 0),
    /**
     * locator — returns anchor locator for a[href].
     * @param sel - Selector.
     * @returns Mock locator.
     */
    locator: (sel: string): Locator => {
      if (sel.includes('a[href]')) {
        const self: unknown = {
          /**
           * evaluateAll.
           * @returns Anchor hrefs.
           */
          evaluateAll: (): Promise<readonly string[]> => Promise.resolve(anchors),
        };
        return self as Locator;
      }
      return makeLocator();
    },
    /**
     * context.
     * @returns Mock BrowserContext.
     */
    context: (): BrowserContext =>
      ({
        /**
         * cookies.
         * @returns Scripted cookies.
         */
        cookies: (): Promise<readonly IMockCookie[]> => Promise.resolve(script.cookies ?? []),
        /**
         * addCookies.
         * @returns Resolves.
         */
        addCookies: (): Promise<boolean> => Promise.resolve(true),
      }) as unknown as BrowserContext,
    /**
     * evaluate — used by collectStorage.
     * @returns Empty storage object.
     */
    evaluate: (): Promise<Record<string, string>> => Promise.resolve({}),
  } as unknown as Page;
}

describe('createElementMediator — structure', () => {
  it('returns an object with all expected methods', () => {
    const page = makePage({ url: 'https://b.co.il' });
    const m = createElementMediator(page);
    expect(typeof m.resolveField).toBe('function');
    expect(typeof m.resolveClickable).toBe('function');
    expect(typeof m.resolveVisible).toBe('function');
    expect(typeof m.resolveAllVisible).toBe('function');
    expect(typeof m.resolveVisibleInContext).toBe('function');
    expect(typeof m.resolveAndClick).toBe('function');
    expect(typeof m.navigateTo).toBe('function');
    expect(typeof m.waitForURL).toBe('function');
    expect(typeof m.countByText).toBe('function');
    expect(typeof m.getCookies).toBe('function');
    expect(typeof m.checkAttribute).toBe('function');
    expect(typeof m.getAttributeValue).toBe('function');
    expect(typeof m.collectAllHrefs).toBe('function');
  });
});

// Early-exit branches for `mediator.resolveAllVisible` are covered in
// CreateElementMediatorResolveAllExits.test.ts (split out to keep this
// file under the 300-line lint gate).

describe('mediator.navigateTo', () => {
  it('returns succeed on successful goto', async () => {
    const page = makePage({ url: 'https://b.co.il' });
    const m = createElementMediator(page);
    const result = await m.navigateTo('https://b.co.il/login');
    expect(result.success).toBe(true);
  });

  it('returns fail when goto throws', async () => {
    const page = {
      ...makePage({ url: 'https://b.co.il' }),
      /**
       * goto rejects.
       * @returns Rejected.
       */
      goto: (): Promise<false> => Promise.reject(new Error('net fail')),
    } as unknown as Page;
    const m = createElementMediator(page);
    const result = await m.navigateTo('x');
    expect(result.success).toBe(false);
  });
});

describe('mediator.getCurrentUrl', () => {
  it('returns the page URL synchronously', () => {
    const page = makePage({ url: 'https://b.co.il/x' });
    const m = createElementMediator(page);
    const getCurrentUrlResult1 = m.getCurrentUrl();
    expect(getCurrentUrlResult1).toBe('https://b.co.il/x');
  });
});

describe('mediator.waitForNetworkIdle', () => {
  it('succeeds even when waitForLoadState throws (timeout non-fatal)', async () => {
    const page = makePage({ url: 'x', waitLoadStateThrows: true });
    const m = createElementMediator(page);
    const result = await m.waitForNetworkIdle(100);
    expect(result.success).toBe(true);
  });

  it('succeeds with default timeout', async () => {
    const page = makePage({ url: 'x' });
    const m = createElementMediator(page);
    const result = await m.waitForNetworkIdle();
    expect(result.success).toBe(true);
  });
});

describe('mediator.waitForURL', () => {
  it('succeeds with true when URL matches', async () => {
    const page = makePage({ url: 'x' });
    const m = createElementMediator(page);
    const result = await m.waitForURL('**/login**');
    expect(result.success).toBe(true);
    if (result.success) expect(result.value).toBe(true);
  });

  it('succeeds with false when waitForURL throws (non-fatal)', async () => {
    const page = makePage({ url: 'x', waitUrlThrows: true });
    const m = createElementMediator(page);
    const result = await m.waitForURL('**/foo**', 10);
    expect(result.success).toBe(true);
    if (result.success) expect(result.value).toBe(false);
  });
});

describe('mediator.countByText', () => {
  it('returns scripted count', async () => {
    const page = makePage({ url: 'x', countByText: 3 });
    const m = createElementMediator(page);
    expect(await m.countByText('Login')).toBe(3);
  });
});

describe('mediator.getCookies + addCookies', () => {
  it('returns cookie snapshots from context', async () => {
    const cookies = [{ name: 'c', value: 'v', domain: 'bank.co.il', path: '/' }];
    const page = makePage({ url: 'x', cookies });
    const m = createElementMediator(page);
    const result = await m.getCookies();
    expect(result.length).toBe(1);
    expect(result[0].name).toBe('c');
    await m.addCookies([{ name: 'n', value: 'v', domain: 'd', path: '/' }]);
  });
});

describe('mediator.collectAllHrefs', () => {
  it('returns unique absolute hrefs', async () => {
    const page = makePage({ url: 'x', anchorHrefs: ['https://a/', 'https://b/', 'https://a/'] });
    const m = createElementMediator(page);
    const hrefs = await m.collectAllHrefs();
    expect(hrefs.length).toBe(2);
  });

  it('returns empty array when no anchors', async () => {
    const page = makePage({ url: 'x' });
    const m = createElementMediator(page);
    expect(await m.collectAllHrefs()).toEqual([]);
  });
});

describe('mediator.checkAttribute', () => {
  it('returns succeed(false) when result not found', async () => {
    const page = makePage({ url: 'x' });
    const m = createElementMediator(page);
    const notFound = {
      found: false,
      locator: false,
      candidate: false,
      context: false,
      index: -1,
      value: '',
    } as IRaceResult;
    const result = await m.checkAttribute(notFound, 'href');
    expect(result.success).toBe(true);
    if (result.success) expect(result.value).toBe(false);
  });

  it('returns succeed(true) when attribute present', async () => {
    const page = makePage({ url: 'x' });
    const m = createElementMediator(page);
    const found = {
      found: true,
      locator: makeLocator(1, '/link'),
      candidate: { kind: 'css', value: '#a' },
      context: page,
      index: 0,
      value: '',
    } as IRaceResult;
    const result = await m.checkAttribute(found, 'href');
    expect(result.success).toBe(true);
    if (result.success) expect(result.value).toBe(true);
  });
});

describe('mediator.getAttributeValue', () => {
  it('returns empty string when result not found', async () => {
    const page = makePage({ url: 'x' });
    const m = createElementMediator(page);
    const notFound = {
      found: false,
      locator: false,
      candidate: false,
      context: false,
      index: -1,
      value: '',
    } as IRaceResult;
    expect(await m.getAttributeValue(notFound, 'href')).toBe('');
  });

  it('returns attribute when present', async () => {
    const page = makePage({ url: 'x' });
    const m = createElementMediator(page);
    const found = {
      found: true,
      locator: makeLocator(1, '/link'),
      candidate: { kind: 'css', value: '#a' },
      context: page,
      index: 0,
      value: '',
    } as IRaceResult;
    expect(await m.getAttributeValue(found, 'href')).toBe('/link');
  });
});

describe('mediator.resolveAndClick', () => {
  it('factory returns a function', () => {
    const page = makePage({ url: 'x' });
    const m = createElementMediator(page);
    expect(typeof m.resolveAndClick).toBe('function');
  });
});

describe('mediator.resolveVisible', () => {
  it('returns NOT_FOUND for empty candidates array', async () => {
    const page = makePage({ url: 'x' });
    const m = createElementMediator(page);
    const result = await m.resolveVisible([]);
    expect(result.found).toBe(false);
  });
});

describe('mediator.resolveVisibleInContext', () => {
  it('returns NOT_FOUND for empty candidates array', async () => {
    const page = makePage({ url: 'x' });
    const m = createElementMediator(page);
    const result = await m.resolveVisibleInContext([], page);
    expect(result.found).toBe(false);
  });
});

describe('mediator.setActivePhase + setActiveStage', () => {
  it('returns true from setActivePhase', () => {
    const page = makePage({ url: 'x' });
    const m = createElementMediator(page);
    const didSetActivePhaseResult2 = m.setActivePhase('test');
    expect(didSetActivePhaseResult2).toBe(true);
  });
  it('returns true from setActiveStage', () => {
    const page = makePage({ url: 'x' });
    const m = createElementMediator(page);
    const didSetActiveStageResult3 = m.setActiveStage('PRE');
    expect(didSetActiveStageResult3).toBe(true);
  });
});

describe('extractActionMediator', () => {
  it('returns a sealed action mediator with executor methods', () => {
    const page = makePage({ url: 'x' });
    const full = createElementMediator(page);
    const action = extractActionMediator(full, page);
    expect(typeof action.fillInput).toBe('function');
    expect(typeof action.clickElement).toBe('function');
    expect(typeof action.pressEnter).toBe('function');
    expect(typeof action.navigateTo).toBe('function');
    expect(typeof action.getCurrentUrl).toBe('function');
    expect(typeof action.getCookies).toBe('function');
    expect(typeof action.collectAllHrefs).toBe('function');
    expect(typeof action.countByText).toBe('function');
    expect(typeof action.collectStorage).toBe('function');
  });

  it('delegates navigateTo/getCurrentUrl/waitForURL/waitForNetworkIdle', async () => {
    const page = makePage({ url: 'https://bank.co.il' });
    const full = createElementMediator(page);
    const action = extractActionMediator(full, page);
    const getCurrentUrlResult4 = action.getCurrentUrl();
    expect(getCurrentUrlResult4).toBe('https://bank.co.il');
    const nav = await action.navigateTo('x');
    expect(nav.success).toBe(true);
    const url = await action.waitForURL('**/x**');
    expect(url.success).toBe(true);
    const idle = await action.waitForNetworkIdle(10);
    expect(idle.success).toBe(true);
  });

  it('exposes hasTxnEndpoint() returning false when no txn traffic captured', () => {
    const page = makePage({ url: 'https://bank.co.il' });
    const full = createElementMediator(page);
    const action = extractActionMediator(full, page);
    const isHasTxn = action.hasTxnEndpoint();
    expect(isHasTxn).toBe(false);
  });

  it('exposes waitForTxnEndpoint as a function on the sealed action mediator', () => {
    const page = makePage({ url: 'https://bank.co.il' });
    const full = createElementMediator(page);
    const action = extractActionMediator(full, page);
    expect(typeof action.waitForTxnEndpoint).toBe('function');
  });
});
