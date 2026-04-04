/**
 * Unit tests for HomePhase — PRE / ACTION / POST via BasePhase class.
 * PRE: goto homepage URL
 * ACTION: close popup + click login link via mediator
 * POST: store loginUrl in diagnostics
 */

import type { Page } from 'playwright-core';

import { ScraperErrorTypes } from '../../../../Scrapers/Base/ErrorTypes.js';
import { NOT_FOUND_RESULT } from '../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { HomePhase } from '../../../../Scrapers/Pipeline/Phases/Home/HomePhase.js';
import { some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IBrowserState,
  IPipelineContext,
} from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { isOk, succeed } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockMediator } from '../../Scrapers/Pipeline/MockPipelineFactories.js';
import { makeMockContext, makeMockPage } from './MockFactories.js';

/** Shared phase instance for all tests. */
const PHASE = new HomePhase();

/** Minimal bank config with urls.base for HOME phase. */
const MOCK_CONFIG = { urls: { base: 'https://test.bank.co.il' } };

/**
 * Build a mock page with goto + url tracking.
 * @param navigatedUrl - The URL the page reports after navigation.
 * @returns Mock page with navigation support.
 */
function makeNavPage(navigatedUrl = 'https://test.bank.co.il/login'): Page {
  const base = makeMockPage(navigatedUrl);
  const mainFrameObj = {
    /**
     * Return navigated URL.
     * @returns The mock URL string.
     */
    url: (): string => navigatedUrl,
  };
  return {
    ...base,
    /**
     * Simulate goto.
     * @returns Resolved true.
     */
    goto: (): Promise<boolean> => Promise.resolve(true),
    /**
     * Simulate waitForURL.
     * @returns Resolved true.
     */
    waitForURL: (): Promise<boolean> => Promise.resolve(true),
    /**
     * Simulate waitForLoadState.
     * @returns Resolved true.
     */
    waitForLoadState: (): Promise<boolean> => Promise.resolve(true),
    /**
     * Return main frame.
     * @returns Main frame object.
     */
    mainFrame: (): object => mainFrameObj,
    /**
     * Return frames list.
     * @returns Array with main frame.
     */
    frames: (): object[] => [mainFrameObj],
    /**
     * Mock locator.
     * @returns Locator with first().
     */
    locator: (): object => ({
      /**
       * First locator.
       * @returns Locator with click().
       */
      first: (): object => ({
        /**
         * Click mock.
         * @returns Resolved true.
         */
        click: (): Promise<boolean> => Promise.resolve(true),
      }),
    }),
  } as unknown as Page;
}

/**
 * Build a context with browser + mediator for HOME phase tests.
 * @param pageUrl - The URL after navigation.
 * @returns Pipeline context with browser and mediator.
 */
function makeHomeCtx(pageUrl = 'https://test.bank.co.il/login'): IPipelineContext {
  const page = makeNavPage(pageUrl);
  const browserState: IBrowserState = {
    page,
    context: {} as unknown as IBrowserState['context'],
    cleanups: [],
  };
  /** Found result for resolveVisible — login link detected. */
  const foundResult = { ...NOT_FOUND_RESULT, found: true, value: 'כניסה' };
  const mediator = makeMockMediator({
    /**
     * URL mock — returns the test page URL.
     * @returns Page URL string.
     */
    getCurrentUrl: (): string => pageUrl,
    /**
     * Resolve visible — returns found for HOME.PRE.
     * @returns Found race result.
     */
    resolveVisible: () => Promise.resolve(foundResult),
    /**
     * Resolve and click — best-effort, returns found.
     * @returns Resolved found.
     */
    resolveAndClick: () => {
      const result = succeed(foundResult);
      return Promise.resolve(result);
    },
    /**
     * Collect all hrefs — returns empty (no fallback needed).
     * @returns Empty array.
     */
    collectAllHrefs: () => Promise.resolve([]),
  });
  const ctx = makeMockContext({
    browser: some(browserState),
    mediator: some(mediator),
    config: MOCK_CONFIG as IPipelineContext['config'],
  });
  return ctx;
}

describe('HomePhase/PRE', () => {
  it('locates login nav link and returns success', async () => {
    const ctx = makeHomeCtx();
    const result = await PHASE.pre(ctx, ctx);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
  });

  it('fails when no mediator in context', async () => {
    const ctx = makeMockContext();
    const result = await PHASE.pre(ctx, ctx);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(false);
    if (!result.success) expect(result.errorType).toBe(ScraperErrorTypes.Generic);
  });
});

describe('HomePhase/ACTION', () => {
  it('clicks login link and navigates via mediator', async () => {
    const ctx = makeHomeCtx();
    const preResult = await PHASE.pre(ctx, ctx);
    expect(preResult.success).toBe(true);
    if (!preResult.success) return preResult;
    const actionResult = await PHASE.action(preResult.value, preResult.value);
    const isActionOk = isOk(actionResult);
    expect(isActionOk).toBe(true);
    return actionResult;
  });

  it('fails when no browser in context', async () => {
    const ctx = makeMockContext();
    const result = await PHASE.action(ctx, ctx);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(false);
  });

  it('fails when no mediator in context', async () => {
    const page = makeNavPage();
    const browserState: IBrowserState = {
      page,
      context: {} as unknown as IBrowserState['context'],
      cleanups: [],
    };
    const ctx = makeMockContext({
      browser: some(browserState),
      config: MOCK_CONFIG as IPipelineContext['config'],
    });
    const result = await PHASE.action(ctx, ctx);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(false);
  });
});

describe('HomePhase/POST', () => {
  it('validates login area detected (URL changed from homepage)', async () => {
    const loginUrl = 'https://start.telebank.co.il/login';
    const ctx = makeHomeCtx(loginUrl);
    const result = await PHASE.post(ctx, ctx);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
  });
});

describe('HomePhase/FINAL', () => {
  it('stores loginUrl in diagnostics and signals PRE-LOGIN', async () => {
    const loginUrl = 'https://start.telebank.co.il/login';
    const ctx = makeHomeCtx(loginUrl);
    const result = await PHASE.final(ctx, ctx);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    if (result.success) expect(result.value.diagnostics.loginUrl).toBe(loginUrl);
  });
});
