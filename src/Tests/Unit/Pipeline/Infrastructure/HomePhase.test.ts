/**
 * Unit tests for HomePhase — PRE/ACTION/POST split.
 * Tests each sub-step independently with distinct error messages.
 *
 * PRE:    goto(homepage) → wait for page readiness
 * ACTION: close popup → find login link (href strategy) → click
 * POST:   wait for credentials form → store loginUrl
 */

import type { Page } from 'playwright-core';

import type { SelectorCandidate } from '../../../../Scrapers/Base/Config/LoginConfigTypes.js';
import { ScraperErrorTypes } from '../../../../Scrapers/Base/ErrorTypes.js';
import type { IRaceResult } from '../../../../Scrapers/Pipeline/Mediator/ElementMediator.js';
import { NOT_FOUND_RESULT } from '../../../../Scrapers/Pipeline/Mediator/ElementMediator.js';
import {
  createHomePhase,
  HOME_ACTION_STEP,
  HOME_POST_STEP,
  HOME_PRE_STEP,
  HOME_STEP,
} from '../../../../Scrapers/Pipeline/Phases/HomePhase.js';
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
 * @param gotoFail - If true, page.goto rejects.
 * @returns Mock page.
 */
function makeNavPage(navigatedUrl = 'https://test.bank.co.il/login', gotoFail = false): Page {
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
     * Simulate page.goto — can fail if gotoFail is true.
     * @returns Resolved or rejected.
     */
    goto: gotoFail
      ? (): Promise<never> => Promise.reject(new Error('net::ERR_NAME_NOT_RESOLVED'))
      : (): Promise<boolean> => Promise.resolve(true),
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
 * Build a mock IRaceResult for testing href strategy.
 * @param href - The href attribute to return from the locator.
 * @returns IRaceResult with a mock locator.
 */
function makeHrefResult(href: string): IRaceResult {
  const candidate: SelectorCandidate = { kind: 'textContent', value: 'כניסה', target: 'href' };
  return {
    found: true,
    locator: {
      /**
       * Return href attribute.
       * @returns The href value.
       */
      getAttribute: (): Promise<string> => Promise.resolve(href),
      /**
       * Click the locator.
       * @returns Resolved.
       */
      click: (): Promise<boolean> => Promise.resolve(true),
      /**
       * Inner text mock.
       * @returns The link text.
       */
      innerText: (): Promise<string> => Promise.resolve('כניסה'),
    } as unknown as IRaceResult['locator'],
    candidate,
    context: {} as IRaceResult['context'],
    index: 0,
    value: href,
  };
}

/**
 * Build a context with browser + mediator for HOME phase tests.
 * @param opts - Options for configuring the mock.
 * @param opts.resolveAndClick - What resolveAndClick returns.
 * @param opts.resolveVisible - What resolveVisible returns.
 * @param opts.pageUrl - URL reported by page.url().
 * @param opts.gotoFail - Whether page.goto should fail.
 * @returns Pipeline context.
 */
function makeHomeCtx(opts: {
  resolveAndClick?: boolean;
  resolveVisible?: IRaceResult;
  pageUrl?: string;
  gotoFail?: boolean;
}): IPipelineContext {
  const page = makeNavPage(opts.pageUrl ?? 'https://test.bank.co.il/login', opts.gotoFail);
  const browserState: IBrowserState = {
    page,
    context: {} as unknown as IBrowserState['context'],
    cleanups: [],
  };
  const mediator = makeMockMediator({
    /**
     * Return configured resolveAndClick result.
     * @returns The configured result.
     */
    resolveAndClick: (): Promise<boolean> => Promise.resolve(opts.resolveAndClick ?? true),
    /**
     * Return configured resolveVisible result.
     * @returns The configured IRaceResult.
     */
    resolveVisible: (): Promise<IRaceResult> =>
      Promise.resolve(opts.resolveVisible ?? NOT_FOUND_RESULT),
  });
  return makeMockContext({
    browser: some(browserState),
    mediator: some(mediator),
    config: MOCK_CONFIG as IPipelineContext['config'],
  });
}

// ── HOME_STEP (legacy, backward compat) ──────────────────

describe('HomePhase/HOME_STEP', () => {
  it('still exported for backward compatibility', () => {
    expect(HOME_STEP).toBeDefined();
    expect(HOME_STEP.name).toBe('home');
  });

  it('succeeds when mediator resolves navigation elements', async () => {
    const ctx = makeHomeCtx({ resolveAndClick: true });
    const isSuccess = isOk(await HOME_STEP.execute(ctx, ctx));
    expect(isSuccess).toBe(true);
  });

  it('succeeds even when no navigation elements found (best-effort)', async () => {
    const ctx = makeHomeCtx({ resolveAndClick: false });
    const isSuccess = isOk(await HOME_STEP.execute(ctx, ctx));
    expect(isSuccess).toBe(true);
  });
});

// ── PRE step ──────────────────────────────────────────────

describe('HomePhase/PRE', () => {
  it('succeeds when page.goto resolves', async () => {
    const ctx = makeHomeCtx({});
    const isSuccess = isOk(await HOME_PRE_STEP.execute(ctx, ctx));
    expect(isSuccess).toBe(true);
  });

  it('fails with homepage unreachable when goto rejects', async () => {
    const ctx = makeHomeCtx({ gotoFail: true });
    const result = await HOME_PRE_STEP.execute(ctx, ctx);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain('Homepage unreachable');
    }
  });

  it('fails when no browser in context', async () => {
    const ctx = makeMockContext();
    const result = await HOME_PRE_STEP.execute(ctx, ctx);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(false);
    if (!result.success) {
      expect(result.errorType).toBe(ScraperErrorTypes.Generic);
    }
  });
});

// ── ACTION step ──────────────────────────────────────────

describe('HomePhase/ACTION', () => {
  it('succeeds when mediator resolves all steps', async () => {
    const ctx = makeHomeCtx({ resolveAndClick: true });
    const isSuccess = isOk(await HOME_ACTION_STEP.execute(ctx, ctx));
    expect(isSuccess).toBe(true);
  });

  it('succeeds even when no elements found (best-effort navigation)', async () => {
    const ctx = makeHomeCtx({ resolveAndClick: false });
    const isSuccess = isOk(await HOME_ACTION_STEP.execute(ctx, ctx));
    expect(isSuccess).toBe(true);
  });

  it('fails when no mediator in context', async () => {
    const page = makeNavPage();
    const browserState: IBrowserState = {
      page,
      context: {} as unknown as IBrowserState['context'],
      cleanups: [],
    };
    const ctx = makeMockContext({ browser: some(browserState) });
    const isSuccess = isOk(await HOME_ACTION_STEP.execute(ctx, ctx));
    expect(isSuccess).toBe(false);
  });
});

// ── POST step ─────────────────────────────────────────────

describe('HomePhase/POST', () => {
  it('discovers loginUrl from page.url() after navigation', async () => {
    const loginUrl = 'https://start.telebank.co.il/login';
    const ctx = makeHomeCtx({ pageUrl: loginUrl });
    const result = await HOME_POST_STEP.execute(ctx, ctx);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    if (result.success) {
      expect(result.value.diagnostics.loginUrl).toBe(loginUrl);
    }
  });

  it('fails when no browser in context', async () => {
    const ctx = makeMockContext();
    const result = await HOME_POST_STEP.execute(ctx, ctx);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain('No browser');
    }
  });
});

// ── createHomePhase factory ──────────────────────────────

describe('HomePhase/createHomePhase', () => {
  it('returns IPhaseDefinition with pre, action, and post', () => {
    const phase = createHomePhase();
    expect(phase.name).toBe('home');
    expect(phase.pre.has).toBe(true);
    expect(phase.post.has).toBe(true);
  });
});

// ── Href strategy ─────────────────────────────────────────

describe('HomePhase/href-strategy', () => {
  it('clicks login link when href contains /login', async () => {
    const hrefResult = makeHrefResult('/login');
    const ctx = makeHomeCtx({ resolveAndClick: true, resolveVisible: hrefResult });
    const isSuccess = isOk(await HOME_ACTION_STEP.execute(ctx, ctx));
    expect(isSuccess).toBe(true);
  });

  it('clicks login link when href contains /connect', async () => {
    const hrefResult = makeHrefResult('/connect');
    const ctx = makeHomeCtx({ resolveAndClick: true, resolveVisible: hrefResult });
    const isSuccess = isOk(await HOME_ACTION_STEP.execute(ctx, ctx));
    expect(isSuccess).toBe(true);
  });

  it('still succeeds when href points to /branches (best-effort fallback)', async () => {
    const hrefResult = makeHrefResult('/branches');
    const ctx = makeHomeCtx({ resolveAndClick: true, resolveVisible: hrefResult });
    const isSuccess = isOk(await HOME_ACTION_STEP.execute(ctx, ctx));
    expect(isSuccess).toBe(true);
  });
});
