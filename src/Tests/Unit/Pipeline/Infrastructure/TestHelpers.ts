/**
 * Shared test helpers for Pipeline unit tests.
 * Factories that extend MockFactories for phase-specific needs.
 */

import type { Page } from 'playwright-core';

import type { IActionMediator } from '../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import type { ScraperLogger } from '../../../../Scrapers/Pipeline/Types/Debug.js';
import { none, some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IActionContext,
  IBrowserState,
  IPipelineContext,
  IResolvedTarget,
} from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { succeed } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockFullPage } from '../../Scrapers/Pipeline/MockPipelineFactories.js';

/**
 * Narrow a ctx.browser Option to ISome and return the IBrowserState.
 * Throws if the browser slot is None — used in tests where browser was seeded.
 * @param ctx - Pipeline context that must have browser populated.
 * @returns The IBrowserState inside ctx.browser.
 */
/** Test-local error for missing browser state (PII-safe). */
class MissingBrowserStateError extends Error {
  /**
   * Construct with a fixed message.
   */
  constructor() {
    super('expected browser state');
    this.name = 'MissingBrowserStateError';
  }
}

/**
 * Narrow a ctx.browser Option to ISome and return the IBrowserState.
 * Throws if the browser slot is None — used in tests where browser was seeded.
 * @param ctx - Pipeline context that must have browser populated.
 * @returns The IBrowserState inside ctx.browser.
 */
export function requireBrowser(ctx: IPipelineContext): IBrowserState {
  if (!ctx.browser.has) throw new MissingBrowserStateError();
  return ctx.browser.value;
}

/**
 * Build a ScraperLogger with flush (pino-style).
 * @returns Logger-compatible mock with flush.
 */
export function makeFlushableLogger(): ScraperLogger {
  return {
    /**
     * No-op debug.
     * @returns True.
     */
    debug: (): boolean => true,
    /**
     * No-op trace.
     * @returns True.
     */
    trace: (): boolean => true,
    /**
     * No-op info.
     * @returns True.
     */
    info: (): boolean => true,
    /**
     * No-op warn.
     * @returns True.
     */
    warn: (): boolean => true,
    /**
     * No-op error.
     * @returns True.
     */
    error: (): boolean => true,
    /**
     * No-op flush.
     * @returns True.
     */
    flush: (): boolean => true,
  } as unknown as ScraperLogger;
}

/**
 * Build a mock Page with screenshot + evaluate (for phases that call either).
 * @param bodyText - Text returned by evaluate (defaults to empty).
 * @returns Extended mock Page.
 */
export function makeScreenshotPage(bodyText = ''): Page {
  const base = makeMockFullPage();
  return {
    ...base,
    /**
     * No-op screenshot.
     * @returns Resolved Buffer.
     */
    screenshot: (): Promise<Buffer> => {
      const emptyBuffer = Buffer.from('');
      return Promise.resolve(emptyBuffer);
    },
    /**
     * Return canned body text for document.body.innerText calls.
     * @returns The body text string.
     */
    evaluate: (): Promise<string> => Promise.resolve(bodyText),
  } as unknown as Page;
}

/**
 * Build a default IActionMediator mock.
 * @param overrides - Optional method overrides.
 * @returns Mock IActionMediator.
 */
export function makeMockActionExecutor(overrides: Partial<IActionMediator> = {}): IActionMediator {
  const base: IActionMediator = {
    /**
     * No-op click.
     * @returns Resolved true.
     */
    clickElement: (): Promise<true> => Promise.resolve(true),
    /**
     * No-op fill.
     * @returns Resolved true.
     */
    fillInput: (): Promise<true> => Promise.resolve(true),
    /**
     * No-op press enter.
     * @returns Resolved true.
     */
    pressEnter: (): Promise<true> => Promise.resolve(true),
    /**
     * Succeed navigation.
     * @returns Succeed(undefined).
     */
    navigateTo: () => {
      const okVoid = succeed(undefined);
      return Promise.resolve(okVoid);
    },
    /**
     * Succeed network idle.
     * @returns Succeed(undefined).
     */
    waitForNetworkIdle: () => {
      const okVoid = succeed(undefined);
      return Promise.resolve(okVoid);
    },
    /**
     * Succeed URL wait with false navigation.
     * @returns Succeed(false).
     */
    waitForURL: () => {
      const okFalse = succeed(false);
      return Promise.resolve(okFalse);
    },
    /**
     * Mock URL.
     * @returns About blank.
     */
    getCurrentUrl: () => 'about:blank',
    /**
     * Empty cookies.
     * @returns Empty array.
     */
    getCookies: () => Promise.resolve([]),
    /**
     * No-op cookie add.
     * @returns Resolved void.
     */
    addCookies: () => Promise.resolve(),
    /**
     * Zero count.
     * @returns 0.
     */
    countByText: () => Promise.resolve(0),
    /**
     * Empty hrefs.
     * @returns Empty array.
     */
    collectAllHrefs: () => Promise.resolve([]),
    /**
     * Empty storage.
     * @returns Empty object.
     */
    collectStorage: () => Promise.resolve({}),
    /**
     * No txn endpoint observed.
     * @returns False.
     */
    hasTxnEndpoint: (): boolean => false,
    /**
     * Mock event-driven wait — never resolves true.
     * @returns Resolved false.
     */
    waitForTxnEndpoint: (): Promise<boolean> => Promise.resolve(false),
  } as unknown as IActionMediator;
  return { ...base, ...overrides };
}

/**
 * Convert IPipelineContext to sealed IActionContext with executor.
 * @param base - Pipeline context.
 * @param executor - Executor or false for none().
 * @param extraDiag - Extra diagnostics keys (for otpTriggerTarget, etc.).
 * @returns Sealed IActionContext.
 */
export function toActionCtx(
  base: IPipelineContext,
  executor: IActionMediator | false,
  extraDiag: Readonly<Record<string, IResolvedTarget | string>> = {},
): IActionContext {
  const execOpt = executor === false ? none() : some(executor);
  return {
    options: base.options,
    credentials: base.credentials,
    companyId: base.companyId,
    logger: base.logger,
    diagnostics: { ...base.diagnostics, ...extraDiag },
    config: base.config,
    fetchStrategy: base.fetchStrategy,
    executor: execOpt,
    loginFieldDiscovery: base.loginFieldDiscovery,
    preLoginDiscovery: base.preLoginDiscovery,
    dashboard: base.dashboard,
    scrapeDiscovery: base.scrapeDiscovery,
    api: base.api,
    loginAreaReady: base.loginAreaReady,
  } as unknown as IActionContext;
}
