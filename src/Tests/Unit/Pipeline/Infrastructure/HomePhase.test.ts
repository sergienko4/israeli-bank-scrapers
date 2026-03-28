/**
 * Unit tests for HomePhase — PRE / ACTION / POST separation.
 * PRE: goto + close popup + discover login clickable
 * ACTION: click discovered element + wait nav
 * POST: confirm arrival + store loginUrl
 */

import type { Page } from 'playwright-core';

import { ScraperErrorTypes } from '../../../../Scrapers/Base/ErrorTypes.js';
import { HOME_ACTION_STEP, HOME_POST_STEP, HOME_PRE_STEP } from '../../../../Scrapers/Pipeline/Phases/HomePhase.js';
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
     * Return navigated URL.
     * @returns The URL.
     */
    url: (): string => navigatedUrl,
  };
  return {
    ...base,
    /** Simulate goto. */
    goto: (): Promise<boolean> => Promise.resolve(true),
    /** Simulate waitForURL. */
    waitForURL: (): Promise<boolean> => Promise.resolve(true),
    /** Simulate waitForLoadState. */
    waitForLoadState: (): Promise<boolean> => Promise.resolve(true),
    /** Return main frame. */
    mainFrame: (): object => mainFrameObj,
    /** Return frames list. */
    frames: (): object[] => [mainFrameObj],
    /** Mock locator. */
    locator: (): object => ({
      /** First locator. */
      first: (): object => ({
        /** Click mock. */
        click: (): Promise<boolean> => Promise.resolve(true),
      }),
    }),
  } as unknown as Page;
}

/**
 * Build a context with browser + mediator for HOME phase tests.
 * @param resolveClickableSelector - CSS returned by resolveClickable (empty = not found).
 * @param pageUrl - The URL after navigation.
 * @returns Pipeline context.
 */
function makeHomeCtx(
  resolveClickableSelector = '',
  pageUrl = 'https://test.bank.co.il/login',
): IPipelineContext {
  const page = makeNavPage(pageUrl);
  const browserState: IBrowserState = {
    page,
    context: {} as unknown as IBrowserState['context'],
    cleanups: [],
  };
  const resolveClickableResult = resolveClickableSelector
    ? { success: true as const, value: { isResolved: true, selector: resolveClickableSelector, context: page, resolvedVia: 'wellKnown' as const, round: 'mainPage' as const } }
    : { success: true as const, value: { isResolved: false, selector: '', context: page, resolvedVia: 'notResolved' as const, round: 'notResolved' as const } };
  const mediator = makeMockMediator({
    /** Return configured resolveAndClick result. */
    resolveAndClick: (): Promise<boolean> => Promise.resolve(false),
    /** Return configured resolveClickable result. */
    resolveClickable: (): Promise<typeof resolveClickableResult> => Promise.resolve(resolveClickableResult),
  });
  return makeMockContext({
    browser: some(browserState),
    mediator: some(mediator),
    config: MOCK_CONFIG as IPipelineContext['config'],
  });
}

describe('HomePhase/PRE', () => {
  it('discovers login clickable and stores selector in diagnostics', async () => {
    const ctx = makeHomeCtx('#loginBtn');
    const result = await HOME_PRE_STEP.execute(ctx, ctx);
    expect(isOk(result)).toBe(true);
    if (result.success) {
      expect(result.value.diagnostics.homeDiscovery).toBe('#loginBtn');
    }
  });

  it('stores empty homeDiscovery when no clickable found', async () => {
    const ctx = makeHomeCtx('');
    const result = await HOME_PRE_STEP.execute(ctx, ctx);
    expect(isOk(result)).toBe(true);
    if (result.success) {
      expect(result.value.diagnostics.homeDiscovery).toBe('');
    }
  });

  it('fails when no browser in context', async () => {
    const ctx = makeMockContext();
    const result = await HOME_PRE_STEP.execute(ctx, ctx);
    expect(isOk(result)).toBe(false);
    if (!result.success) {
      expect(result.errorType).toBe(ScraperErrorTypes.Generic);
    }
  });
});

describe('HomePhase/ACTION', () => {
  it('clicks discovered element when homeDiscovery is set', async () => {
    const ctx = makeHomeCtx('#loginBtn');
    const preResult = await HOME_PRE_STEP.execute(ctx, ctx);
    expect(preResult.success).toBe(true);
    if (!preResult.success) return;
    const actionResult = await HOME_ACTION_STEP.execute(preResult.value, preResult.value);
    expect(isOk(actionResult)).toBe(true);
  });

  it('skips click when homeDiscovery is empty (already on login page)', async () => {
    const ctx = makeHomeCtx('');
    const preResult = await HOME_PRE_STEP.execute(ctx, ctx);
    expect(preResult.success).toBe(true);
    if (!preResult.success) return;
    const actionResult = await HOME_ACTION_STEP.execute(preResult.value, preResult.value);
    expect(isOk(actionResult)).toBe(true);
  });
});

describe('HomePhase/POST', () => {
  it('stores loginUrl from current page URL', async () => {
    const loginUrl = 'https://start.telebank.co.il/login';
    const ctx = makeHomeCtx('', loginUrl);
    const result = await HOME_POST_STEP.execute(ctx, ctx);
    expect(isOk(result)).toBe(true);
    if (result.success) {
      expect(result.value.diagnostics.loginUrl).toBe(loginUrl);
    }
  });
});
