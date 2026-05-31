/**
 * Unit tests for HeuristicResolver — type-based field resolution fallback.
 */

import type { Frame, Locator, Page } from 'playwright-core';

import tryHeuristicProbe, {
  heuristicResolveInFrame,
} from '../../../../../Scrapers/Pipeline/Mediator/Selector/HeuristicResolver.js';

/** Local test error for rejecting with a non-Error class (PII-safe). */
class TestError extends Error {
  /**
   * Test helper.
   *
   * @param message - Message text.
   * @returns Result.
   */
  constructor(message: string) {
    super(message);
    this.name = 'TestError';
  }
}

/** Behaviour scripted into the mock locator. */
interface ILocScript {
  count: number;
  visible: boolean;
  enabled: boolean;
  id: string;
}

/**
 * Build a mock Locator that returns scripted count/isVisible/isEnabled.
 * @param script - Behaviour script.
 * @returns Mock locator.
 */
function makeLocator(script: ILocScript): Locator {
  return {
    /**
     * Count elements.
     * @returns Scripted count.
     */
    count: (): Promise<number> => Promise.resolve(script.count),
    /**
     * Is visible.
     * @returns Scripted visibility.
     */
    isVisible: (): Promise<boolean> => Promise.resolve(script.visible),
    /**
     * Is enabled.
     * @returns Scripted enabled state.
     */
    isEnabled: (): Promise<boolean> => Promise.resolve(script.enabled),
    /**
     * Get id attribute.
     * @returns Scripted id (as attribute value or '').
     */
    getAttribute: (): Promise<string | false> => Promise.resolve(script.id || false),
    /**
     * First.
     * @returns Self.
     */
    first: (): Locator => makeLocator(script),
    /**
     * Nth.
     * @returns Self.
     */
    nth: (): Locator => makeLocator(script),
  } as unknown as Locator;
}

/**
 * Build a mock frame that returns different locators per selector.
 * @param mapping - Selector → script mapping.
 * @returns Mock frame.
 */
function makeFrame(mapping: Record<string, ILocScript>): Frame {
  return {
    /**
     * Route selector to scripted locator.
     * @param sel - Selector string.
     * @returns Scripted locator.
     */
    locator: (sel: string): Locator => {
      const key = Object.keys(mapping).find((k): boolean => sel.includes(k));
      if (!key) return makeLocator({ count: 0, visible: false, enabled: false, id: '' });
      return makeLocator(mapping[key]);
    },
    /**
     * Frame URL.
     * @returns Empty URL.
     */
    url: (): string => 'https://frame.co.il/',
    /**
     * Frame name.
     * @returns Empty name.
     */
    name: (): string => '',
  } as unknown as Frame;
}

describe('heuristicResolveInFrame', () => {
  it('returns empty match for unknown field key', async () => {
    const frame = makeFrame({});
    const result = await heuristicResolveInFrame(frame, 'unknownKey');
    expect(result.selector).toBe('');
  });

  it('resolves password field when visible', async () => {
    const frame = makeFrame({
      password: { count: 1, visible: true, enabled: true, id: 'pwInput' },
    });
    const result = await heuristicResolveInFrame(frame, 'password');
    expect(result.selector).toBe('#pwInput');
  });

  it('falls back to type selector when password has no id', async () => {
    const frame = makeFrame({
      password: { count: 1, visible: true, enabled: true, id: '' },
    });
    const result = await heuristicResolveInFrame(frame, 'password');
    expect(result.selector).toContain('input[type="password"]');
  });

  it('returns empty when password hidden', async () => {
    const frame = makeFrame({
      password: { count: 1, visible: false, enabled: true, id: 'x' },
    });
    const result = await heuristicResolveInFrame(frame, 'password');
    expect(result.selector).toBe('');
  });

  it('returns empty when no password element', async () => {
    const frame = makeFrame({
      password: { count: 0, visible: false, enabled: false, id: '' },
    });
    const result = await heuristicResolveInFrame(frame, 'password');
    expect(result.selector).toBe('');
  });

  it('resolves id field by positional index 0', async () => {
    const frame = makeFrame({
      'input:not': { count: 3, visible: true, enabled: true, id: 'user' },
    });
    const result = await heuristicResolveInFrame(frame, 'id');
    expect(result.selector).toBe('#user');
  });

  it('returns empty when index >= total visible inputs', async () => {
    const frame = makeFrame({
      'input:not': { count: 0, visible: true, enabled: true, id: '' },
    });
    const result = await heuristicResolveInFrame(frame, 'id');
    expect(result.selector).toBe('');
  });

  it('returns empty when target input not visible', async () => {
    const frame = makeFrame({
      'input:not': { count: 3, visible: false, enabled: true, id: '' },
    });
    const result = await heuristicResolveInFrame(frame, 'id');
    expect(result.selector).toBe('');
  });

  it('returns empty when target input not enabled', async () => {
    const frame = makeFrame({
      'input:not': { count: 3, visible: true, enabled: false, id: '' },
    });
    const result = await heuristicResolveInFrame(frame, 'id');
    expect(result.selector).toBe('');
  });
});

describe('tryHeuristicProbe', () => {
  it('probes a Frame directly when passed a frame', async () => {
    const frame = makeFrame({
      password: { count: 1, visible: true, enabled: true, id: 'pw' },
    });
    const result = await tryHeuristicProbe(frame, 'password');
    expect(result).not.toBe(false);
    if (result) {
      expect(result.isResolved).toBe(true);
      expect(result.round).toBe('heuristic');
      expect(result.resolvedVia).toBe('heuristic');
    }
  });

  it('returns false for unknown field on Frame', async () => {
    const frame = makeFrame({});
    const result = await tryHeuristicProbe(frame, 'unknownKey');
    expect(result).toBe(false);
  });

  it('searches iframes then main when passed a Page', async () => {
    const noMatch = makeFrame({});
    const mainFrame = makeFrame({});
    const page = {
      /**
       * Return frame list.
       * @returns Frames.
       */
      frames: (): Frame[] => [mainFrame, noMatch],
      /**
       * Return main frame.
       * @returns Main frame.
       */
      mainFrame: (): Frame => mainFrame,
    } as unknown as Page;
    const result = await tryHeuristicProbe(page, 'password');
    expect(result).toBe(false);
  });

  it('finds password in an iframe when page has children', async () => {
    const iframeFrame = makeFrame({
      password: { count: 1, visible: true, enabled: true, id: 'pw' },
    });
    const mainFrame = makeFrame({});
    const page = {
      /**
       * Frames list.
       * @returns Main + iframe.
       */
      frames: (): Frame[] => [mainFrame, iframeFrame],
      /**
       * Main frame.
       * @returns Main frame.
       */
      mainFrame: (): Frame => mainFrame,
    } as unknown as Page;
    const result = await tryHeuristicProbe(page, 'password');
    expect(result).not.toBe(false);
  });
});

// ── Rejecting-promise coverage for .catch lambdas ────────────────────────

/**
 * Build a locator whose methods reject → exercises the ): 0 / ): false
 * catch lambdas in resolvePasswordInFrame and resolveTextByIndex.
 * @param rejects - Map of methods that should reject.
 * @returns Mock Locator.
 */
function makeRejectingLocator(
  rejects: Partial<Record<'count' | 'isVisible' | 'isEnabled' | 'getAttribute', boolean>>,
): Locator {
  return {
    /**
     * Test helper.
     *
     * @returns Result.
     */
    count: (): Promise<number> =>
      rejects.count ? Promise.reject(new Error('count fail')) : Promise.resolve(1),
    /**
     * Test helper.
     *
     * @returns Result.
     */
    isVisible: (): Promise<boolean> =>
      rejects.isVisible ? Promise.reject(new Error('vis fail')) : Promise.resolve(true),
    /**
     * Test helper.
     *
     * @returns Result.
     */
    isEnabled: (): Promise<boolean> =>
      rejects.isEnabled ? Promise.reject(new Error('en fail')) : Promise.resolve(true),
    /**
     * Test helper.
     *
     * @returns Result.
     */
    getAttribute: (): Promise<string | false> =>
      rejects.getAttribute ? Promise.reject(new Error('attr fail')) : Promise.resolve('x'),
    /**
     * Test helper.
     *
     * @returns Result.
     */
    first: (): Locator => makeRejectingLocator(rejects),
    /**
     * Test helper.
     *
     * @returns Result.
     */
    nth: (): Locator => makeRejectingLocator(rejects),
  } as unknown as Locator;
}

describe('heuristicResolveInFrame — catch lambda coverage', () => {
  it.each([
    { rejects: { count: true }, field: 'password' },
    { rejects: { isVisible: true }, field: 'password' },
    { rejects: { getAttribute: true }, field: 'password' },
    { rejects: { count: true }, field: 'id' },
    { rejects: { isVisible: true }, field: 'id' },
    { rejects: { isEnabled: true }, field: 'id' },
    { rejects: { getAttribute: true }, field: 'id' },
  ])(
    '$field with rejecting $rejects still resolves without throwing',
    async ({ rejects, field }) => {
      const loc = makeRejectingLocator(rejects);
      const frame = {
        /**
         * Test helper.
         *
         * @returns Result.
         */
        locator: (): Locator => loc,
        /**
         * Test helper.
         *
         * @returns Result.
         */
        url: (): string => '',
        /**
         * Test helper.
         *
         * @returns Result.
         */
        name: (): string => '',
      } as unknown as Frame;
      const result = await heuristicResolveInFrame(frame, field);
      expect(typeof result.selector).toBe('string');
    },
  );

  it('resolvePasswordInFrame rethrow path via tryHeuristicProbe swallows via outer catch', async () => {
    // Make a frame whose locator throws SYNCHRONOUSLY so resolvePasswordInFrame's
    // own .catch wrapper in heuristicResolveInFrame fires.
    const frame = {
      /**
       * Test helper.
       *
       * @returns Result.
       */
      locator: (): Locator => {
        throw new TestError('boom');
      },
      /**
       * Test helper.
       *
       * @returns Result.
       */
      url: (): string => '',
      /**
       * Test helper.
       *
       * @returns Result.
       */
      name: (): string => '',
    } as unknown as Frame;
    const result = await heuristicResolveInFrame(frame, 'password');
    expect(result.selector).toBe('');
  });

  it('resolveTextByIndex try/catch returns empty when locator throws sync', async () => {
    const frame = {
      /**
       * Test helper.
       *
       * @returns Result.
       */
      locator: (): Locator => {
        throw new TestError('boom');
      },
      /**
       * Test helper.
       *
       * @returns Result.
       */
      url: (): string => '',
      /**
       * Test helper.
       *
       * @returns Result.
       */
      name: (): string => '',
    } as unknown as Frame;
    const result = await heuristicResolveInFrame(frame, 'id');
    expect(result.selector).toBe('');
  });
});
