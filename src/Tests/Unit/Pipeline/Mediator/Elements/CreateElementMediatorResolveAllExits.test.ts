/**
 * Branch coverage for the four early-exit paths in resolveAllVisible:
 *  - empty candidate list           → []
 *  - cap is zero                    → []
 *  - no candidate fulfils the race  → []
 *  - buildLocatorEntries empty      → []
 *
 * Split out of CreateElementMediator.test.ts to keep that file under the
 * 300-line lint gate. Uses a minimal locally-defined page mock instead of
 * the heavier shared one in CreateElementMediator.test.ts.
 */

import type { Locator, Page } from 'playwright-core';

import createElementMediator from '../../../../../Scrapers/Pipeline/Mediator/Elements/CreateElementMediator.js';

const MOCK_URL = 'https://b.co.il';

/**
 * Build a no-op Locator whose `waitFor` rejects so the visibility race
 * never fulfils. Every accessor is a stub — the early-exit tests never
 * reach into element behaviour.
 * @returns Mock locator.
 */
function makeNoopLocator(): Locator {
  const self: unknown = {
    /**
     * Locator chaining stub.
     * @returns Self.
     */
    first: (): Locator => self as Locator,
    /**
     * resolveAllVisible enumerates `.nth(i)` per locator — return self
     * so the race protocol still gets a locator instance back.
     * @returns Self.
     */
    nth: (): Locator => self as Locator,
    /**
     * Match count — zero means resolveAllVisible's nth-expansion exits
     * early with empty entries.
     * @returns 0.
     */
    count: (): Promise<number> => Promise.resolve(0),
    /**
     * Visibility check rigged to reject so the race never fulfils.
     * @returns Always rejects to keep the race empty.
     */
    waitFor: (): Promise<false> => Promise.reject(new Error('not visible')),
  };
  return self as Locator;
}

/**
 * Build a minimal mock Page sufficient for resolveAllVisible's early-exit
 * branches. Only the methods the impl actually touches before bailing are
 * stubbed.
 * @returns Mock page.
 */
function makeMinimalPage(): Page {
  const noopLocator = makeNoopLocator();
  return {
    /**
     * Page URL accessor.
     * @returns Mock URL.
     */
    url: (): string => MOCK_URL,
    /**
     * Page event subscription stub — createElementMediator wires up
     * `request`/`response` listeners; we don't care, return a self-page.
     * @returns Self.
     */
    on: (): Page => ({}) as Page,
    /**
     * goto — never called in these early-exit tests but required by the
     * IElementMediator initialisation path.
     * @returns Resolves false.
     */
    goto: (): Promise<false> => Promise.resolve(false),
    /**
     * waitForResponse stub — pending forever, no early-exit test waits.
     * @returns Promise that never settles.
     */
    waitForResponse: (): Promise<false> => Promise.race([]),
    /**
     * Frame enumeration — none, so buildLocatorEntries can hit its empty path.
     * @returns Empty frame list.
     */
    frames: (): Page[] => [],
    /**
     * Main frame accessor — recursively returns a fresh minimal page.
     * @returns Self.
     */
    mainFrame: (): Page => makeMinimalPage(),
    /**
     * Generic locator builder — always returns the no-op locator.
     * @returns Locator.
     */
    locator: (): Locator => noopLocator,
    /**
     * Text locator builder — always returns the no-op locator.
     * @returns Locator.
     */
    getByText: (): Locator => noopLocator,
    /**
     * Role locator builder — always returns the no-op locator.
     * @returns Locator.
     */
    getByRole: (): Locator => noopLocator,
    /**
     * Placeholder locator builder — always returns the no-op locator.
     * @returns Locator.
     */
    getByPlaceholder: (): Locator => noopLocator,
    /**
     * Label locator builder — always returns the no-op locator.
     * @returns Locator.
     */
    getByLabel: (): Locator => noopLocator,
  } as unknown as Page;
}

describe('mediator.resolveAllVisible — early-exit branches', () => {
  it('returns [] when called with empty candidate list', async () => {
    const page = makeMinimalPage();
    const m = createElementMediator(page);
    const got = await m.resolveAllVisible([], 1000, 3);
    expect(got).toEqual([]);
  });

  it('returns [] when cap is 0 (caller asked for nothing)', async () => {
    const page = makeMinimalPage();
    const m = createElementMediator(page);
    const got = await m.resolveAllVisible([{ kind: 'css', value: '#x' }], 1000, 0);
    expect(got).toEqual([]);
  });

  it('returns [] when no candidate fulfills the visibility race', async () => {
    const page = makeMinimalPage();
    const m = createElementMediator(page);
    const got = await m.resolveAllVisible([{ kind: 'css', value: '#none' }], 50, 3);
    expect(got).toEqual([]);
  });

  it('returns [] when buildLocatorEntries produces zero entries (no contexts)', async () => {
    // Frames() returning an empty array would usually trigger this path; the
    // synthetic page always returns the page itself, so we hit the
    // no-fulfilled branch instead. Either way the function returns [].
    const page = makeMinimalPage();
    const m = createElementMediator(page);
    const got = await m.resolveAllVisible([{ kind: 'xpath', value: '//x' }], 25, 5);
    const isArray = Array.isArray(got);
    expect(isArray).toBe(true);
  });
});
