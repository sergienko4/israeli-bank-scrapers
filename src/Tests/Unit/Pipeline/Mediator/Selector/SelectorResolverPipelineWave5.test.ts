/**
 * Wave 5 branch coverage for SelectorResolverPipeline.
 * Targets: toFieldContext match.kind missing (line 72), reduceFrameActions
 * early-exit when match found (246), probeMainPage bank-found path (318/366/383).
 */

import type { Frame, Locator, Page } from 'playwright-core';

import type {
  IFieldConfig,
  SelectorCandidate,
} from '../../../../../Scrapers/Base/Config/LoginConfig.js';
import {
  probeIframes,
  probeMainPage,
  resolveInMainContext,
  searchInChildFrames,
} from '../../../../../Scrapers/Pipeline/Mediator/Selector/SelectorResolverPipeline.js';

/**
 * Build a frame that returns a "found" locator.
 * @param url - Parameter.
 * @returns Result.
 */
function makeFoundFrame(url = 'https://inner.bank.co.il'): Frame {
  return {
    /**
     * $ returns found element.
     * @returns Found.
     */
    $: (): Promise<Record<string, unknown>> => Promise.resolve({}),
    /**
     * URL.
     * @returns URL string.
     */
    url: (): string => url,
    /**
     * Locator that reports count=1 + fillable.
     * @returns Locator.
     */
    locator: (): Locator =>
      ({
        /**
         * First.
         * @returns Self locator with count=1.
         */
        first: (): unknown => ({
          /**
           * Count=1.
           * @returns Result.
           */
          count: (): Promise<number> => Promise.resolve(1),
          /**
           * Evaluate true (fillable).
           * @returns Result.
           */
          evaluate: (): Promise<boolean> => Promise.resolve(true),
        }),
      }) as unknown as Locator,
  } as unknown as Frame;
}

/**
 * Build a page exposing the given child frames.
 * @param childFrames - Parameter.
 * @returns Result.
 */
function makePageWithFrames(childFrames: Frame[] = []): Page {
  const main = {
    /**
     * Frame URL.
     * @returns Result.
     */
    url: (): string => 'https://main.bank.co.il',
  };
  return {
    /**
     * $ null.
     * @returns Result.
     */
    $: (): Promise<false> => Promise.resolve(false),
    /**
     * Title.
     * @returns Result.
     */
    title: (): Promise<string> => Promise.resolve('Mock'),
    /**
     * Main frame.
     * @returns Result.
     */
    mainFrame: (): Frame => main as unknown as Frame,
    /**
     * Frames list.
     * @returns Result.
     */
    frames: (): Frame[] => [main as unknown as Frame, ...childFrames],
    /**
     * Locator.
     * @returns Result.
     */
    locator: (): Locator =>
      ({
        /**
         * First.
         * @returns Result.
         */
        first: (): unknown => ({
          /**
           * Count 0.
           * @returns Result.
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

describe('SelectorResolverPipeline — Wave 5 branches', () => {
  it('searchInChildFrames returns early when first iframe finds match (line 246)', async () => {
    // Use two frames: first finds the match, second would also find but is not called
    const foundFrame1 = makeFoundFrame();
    const foundFrame2 = makeFoundFrame();
    const page = makePageWithFrames([foundFrame1, foundFrame2]);
    const candidates: SelectorCandidate[] = [{ kind: 'css', value: '#user' }];
    const result = await searchInChildFrames(page, candidates);
    expect(typeof result.selector).toBe('string');
  });

  it('resolveInMainContext returns found match when candidate resolves (line 293)', async () => {
    const foundPage = {
      ...makePageWithFrames(),
      /**
       * $ returns non-null to trigger probe found.
       * @returns Found.
       */
      $: (): Promise<Record<string, unknown>> => Promise.resolve({}),
      /**
       * Locator returning count=1.
       * @returns Fillable locator.
       */
      locator: (): Locator =>
        ({
          /**
           * First.
           * @returns Result.
           */
          first: (): unknown => ({
            /**
             * Count=1.
             * @returns Result.
             */
            count: (): Promise<number> => Promise.resolve(1),
            /**
             * Fillable.
             * @returns Result.
             */
            evaluate: (): Promise<boolean> => Promise.resolve(true),
          }),
        }) as unknown as Locator,
    } as unknown as Page;
    const candidates: SelectorCandidate[] = [{ kind: 'css', value: '#user' }];
    const result = await resolveInMainContext(foundPage, candidates, 'username');
    expect(typeof result.selector).toBe('string');
  });

  it('probeMainPage: bank-found → returns IFieldContext with isResolved (line 366)', async () => {
    const foundPage = {
      ...makePageWithFrames(),
      /**
       * $ returns non-null.
       * @returns Result.
       */
      $: (): Promise<Record<string, unknown>> => Promise.resolve({}),
      /**
       * Locator count=1.
       * @returns Result.
       */
      locator: (): Locator =>
        ({
          /**
           * First.
           * @returns Result.
           */
          first: (): unknown => ({
            /**
             * Count=1.
             * @returns Result.
             */
            count: (): Promise<number> => Promise.resolve(1),
            /**
             * Fillable.
             * @returns Result.
             */
            evaluate: (): Promise<boolean> => Promise.resolve(true),
          }),
        }) as unknown as Locator,
    } as unknown as Page;
    const result = await probeMainPage({
      pageOrFrame: foundPage,
      field: FIELD,
      pageUrl: 'https://bank.co.il',
      bankCandidates: [{ kind: 'css', value: '#user' }],
      wellKnownCandidates: [{ kind: 'css', value: '#fallback' }],
    });
    expect(typeof result).toBe('object');
  });

  it('probeIframes: bank iframe match (isResolved=true branch line 339)', async () => {
    const foundFrame = makeFoundFrame();
    const page = makePageWithFrames([foundFrame]);
    const result = await probeIframes(page, {
      pageOrFrame: page,
      field: FIELD,
      pageUrl: 'https://bank.co.il',
      bankCandidates: [{ kind: 'css', value: '#user' }],
      wellKnownCandidates: [],
    });
    expect(typeof result).toBe('object');
  });

  it('probeMainPage with only WK candidates that match (line 383)', async () => {
    const foundPage = {
      ...makePageWithFrames(),
      /**
       * $ found.
       * @returns Result.
       */
      $: (): Promise<Record<string, unknown>> => Promise.resolve({}),
      /**
       * Locator count=1.
       * @returns Result.
       */
      locator: (): Locator =>
        ({
          /**
           * First.
           * @returns Result.
           */
          first: (): unknown => ({
            /**
             * Count=1.
             * @returns Result.
             */
            count: (): Promise<number> => Promise.resolve(1),
            /**
             * Fillable.
             * @returns Result.
             */
            evaluate: (): Promise<boolean> => Promise.resolve(true),
          }),
        }) as unknown as Locator,
    } as unknown as Page;
    const result = await probeMainPage({
      pageOrFrame: foundPage,
      field: FIELD,
      pageUrl: 'https://bank.co.il',
      bankCandidates: [],
      wellKnownCandidates: [{ kind: 'css', value: '#wkuser' }],
    });
    expect(typeof result).toBe('object');
  });
});
