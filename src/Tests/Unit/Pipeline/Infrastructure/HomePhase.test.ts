/**
 * Unit tests for HomePhase — generic homepage → login page navigation.
 * Tests that HOME phase uses mediator.resolveAndClick with WellKnown candidates
 * and discovers loginUrl dynamically from page.url() after navigation.
 */

import type { Page } from 'playwright-core';

import { ScraperErrorTypes } from '../../../../Scrapers/Base/ErrorTypes.js';
import { HOME_STEP } from '../../../../Scrapers/Pipeline/Phases/HomePhase.js';
import { some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IBrowserState,
  IPipelineContext,
} from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { isOk } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockMediator } from '../../Scrapers/Pipeline/MockPipelineFactories.js';
import { makeMockContext, makeMockPage } from './MockFactories.js';

/** Minimal bank config with urls.base for HOME phase. */
const MOCK_CONFIG = { urls: { base: 'https://test.bank.co.il' } };

/**
 * Build a mock page with goto + url tracking.
 * @param navigatedUrl - The URL the page reports after navigation.
 * @returns Mock page.
 */
function makeNavPage(navigatedUrl = 'https://test.bank.co.il/login'): Page {
  const base = makeMockPage(navigatedUrl);
  const mainFrameObj = {
    /**
     * Return navigated URL for frame mock.
     * @returns The navigated URL.
     */
    url: (): string => navigatedUrl,
  };
  return {
    ...base,
    /**
     * Simulate page.goto.
     * @returns Resolved.
     */
    goto: (): Promise<boolean> => Promise.resolve(true),
    /**
     * Simulate waitForURL.
     * @returns Resolved.
     */
    waitForURL: (): Promise<boolean> => Promise.resolve(true),
    /**
     * Return main frame.
     * @returns Main frame mock.
     */
    mainFrame: (): object => mainFrameObj,
    /**
     * Return frames list (main only, no child iframes in test).
     * @returns Array with main frame.
     */
    frames: (): object[] => [mainFrameObj],
  } as unknown as Page;
}

/**
 * Build a context with browser + mediator for HOME phase tests.
 * @param resolveResult - What resolveAndClick returns.
 * @param pageUrl - The URL reported by page.url() after navigation.
 * @returns Pipeline context.
 */
function makeHomeCtx(
  resolveResult: boolean,
  pageUrl = 'https://test.bank.co.il/login',
): IPipelineContext {
  const page = makeNavPage(pageUrl);
  const browserState: IBrowserState = {
    page,
    context: {} as unknown as IBrowserState['context'],
    cleanups: [],
  };
  const mediator = makeMockMediator({
    /**
     * Return configured result.
     * @returns The resolveAndClick result.
     */
    resolveAndClick: (): Promise<boolean> => Promise.resolve(resolveResult),
  });
  return makeMockContext({
    browser: some(browserState),
    mediator: some(mediator),
    config: MOCK_CONFIG as IPipelineContext['config'],
  });
}

describe('HomePhase', () => {
  it('succeeds when mediator resolves navigation elements', async () => {
    const ctx = makeHomeCtx(true);
    const result = await HOME_STEP.execute(ctx, ctx);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
  });

  it('succeeds even when no navigation elements found (best-effort)', async () => {
    const ctx = makeHomeCtx(false);
    const result = await HOME_STEP.execute(ctx, ctx);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
  });

  it('discovers loginUrl from page.url() after navigation', async () => {
    const loginUrl = 'https://start.telebank.co.il/login';
    const ctx = makeHomeCtx(true, loginUrl);
    const result = await HOME_STEP.execute(ctx, ctx);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    if (result.success) {
      expect(result.value.diagnostics.loginUrl).toBe(loginUrl);
    }
  });

  it('fails when no browser in context', async () => {
    const ctx = makeMockContext();
    const result = await HOME_STEP.execute(ctx, ctx);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(false);
    if (!result.success) {
      expect(result.errorType).toBe(ScraperErrorTypes.Generic);
    }
  });

  it('fails when no mediator in context', async () => {
    const page = makeNavPage();
    const browserState: IBrowserState = {
      page,
      context: {} as unknown as IBrowserState['context'],
      cleanups: [],
    };
    const ctx = makeMockContext({ browser: some(browserState) });
    const result = await HOME_STEP.execute(ctx, ctx);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(false);
  });
});
