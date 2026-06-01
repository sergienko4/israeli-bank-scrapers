/**
 * Unit tests for InitActions — navigation, validate, wire helpers.
 */

import { jest } from '@jest/globals';
import type { BrowserContext, Page } from 'playwright-core';

import ScraperError from '../../../../../Scrapers/Base/ScraperError.js';
import {
  executeNavigateToBank,
  executeValidatePage,
  executeWireComponents,
} from '../../../../../Scrapers/Pipeline/Mediator/Init/InitActions.js';
import type { INavTransportProbe } from '../../../../../Scrapers/Pipeline/Mediator/Init/NavigationDiagnostics.js';
import type { Option } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import { some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IBrowserState,
  IPipelineContext,
} from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { isOk } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';

/** Subset of the failure-snapshot payload the probe test inspects. */
interface IFailureLogPayload {
  readonly event?: string;
  readonly nodeTransportProbe?: Option<INavTransportProbe>;
}

/**
 * Type guard for the structured `INIT-ACTION-NAV-FAILURE` payload.
 * Pino accepts arbitrary first arguments; the test must narrow the
 * recorded call before reading the probe envelope.
 *
 * @param value - Recorded first argument of a `logger.warn` call.
 * @returns True when the value is an object with an `event` field.
 */
function isFailurePayload(value: unknown): value is IFailureLogPayload {
  if (typeof value !== 'object' || value === null) return false;
  return 'event' in value;
}

/**
 * Build a mock Page with scripted goto/title/url.
 * @param script - Behaviour.
 * @param script.url - Script URL.
 * @param script.title - Script title.
 * @param script.gotoThrows - Whether goto throws.
 * @param script.gotoErrorMessage - Custom error message for the goto rejection (default `nav-fail`).
 * @param script.titleThrows - Whether title throws.
 * @returns Mock Page.
 */
function makePage(script: {
  url?: string;
  title?: string;
  gotoThrows?: boolean;
  gotoErrorMessage?: string;
  titleThrows?: boolean;
}): Page {
  let currentUrl = script.url ?? 'https://bank.co.il';
  const self = {
    /**
     * url.
     * @returns Scripted URL.
     */
    url: (): string => currentUrl,
    /**
     * goto.
     * @param newUrl - Target URL.
     * @returns Scripted.
     */
    goto: (newUrl: string): Promise<boolean> => {
      if (script.gotoThrows) {
        const message = script.gotoErrorMessage ?? 'nav-fail';
        return Promise.reject(new Error(message));
      }
      currentUrl = newUrl;
      return Promise.resolve(true);
    },
    /**
     * title.
     * @returns Scripted title.
     */
    title: (): Promise<string> => {
      if (script.titleThrows) return Promise.reject(new Error('no title'));
      return Promise.resolve(script.title ?? 'Bank');
    },
    /**
     * on — no-op for createElementMediator's event listeners.
     * @returns Self.
     */
    on: (): Page => self as unknown as Page,
    /**
     * off — no-op.
     * @returns Self.
     */
    off: (): Page => self as unknown as Page,
    /**
     * frames — empty.
     * @returns Empty frames.
     */
    frames: (): Page[] => [],
    /**
     * waitForResponse — never resolves (fire-and-forget).
     * @returns Never-resolving promise.
     */
    waitForResponse: (): Promise<never> => Promise.race([]),
    /**
     * waitForLoadState — INIT.FINAL awaits the `load` event before
     * wiring components. Mock resolves immediately (load already
     * fired in the test fixture).
     * @returns Resolved void.
     */
    waitForLoadState: (): Promise<void> => Promise.resolve(undefined),
    /**
     * context — bag with on/off hooks.
     * @returns Self.
     */
    context: (): unknown => ({
      /**
       * Test helper.
       *
       * @returns Result.
       */
      on: (): unknown => undefined,
      /**
       * Test helper.
       *
       * @returns Result.
       */
      off: (): unknown => undefined,
    }),
  };
  return self as unknown as Page;
}

/**
 * Build a context with scripted page attached.
 * @param page - Mock page.
 * @returns Pipeline context with browser.
 */
function ctxWithPage(page: Page): IPipelineContext {
  const base = makeMockContext();
  return {
    ...base,
    browser: some({
      browser: {},
      context: {} as BrowserContext,
      page,
    } as unknown as IBrowserState),
  };
}

describe('executeNavigateToBank', () => {
  it('fails when no browser is available', async () => {
    const ctx = makeMockContext();
    const result = await executeNavigateToBank(ctx);
    const isOkResult1 = isOk(result);
    expect(isOkResult1).toBe(false);
  });

  it('succeeds when goto resolves', async () => {
    const page = makePage({ url: 'https://bank.co.il' });
    const ctx = ctxWithPage(page);
    const result = await executeNavigateToBank(ctx);
    const isOkResult2 = isOk(result);
    expect(isOkResult2).toBe(true);
  });

  it('fails when goto throws', async () => {
    const page = makePage({ gotoThrows: true });
    const ctx = ctxWithPage(page);
    const result = await executeNavigateToBank(ctx);
    const isOkResult3 = isOk(result);
    expect(isOkResult3).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('navigation failed');
  });

  it('runs the transport probe and surfaces fail when the goto error fingerprints as a timeout', async () => {
    const probeUrl = 'http://127.0.0.1:1/';
    const page = makePage({
      url: 'about:blank',
      gotoThrows: true,
      gotoErrorMessage: 'page.goto: Timeout 15000ms exceeded.',
    });
    const baseCtx = ctxWithPage(page);
    const probeCtx: IPipelineContext = {
      ...baseCtx,
      config: { ...baseCtx.config, urls: { ...baseCtx.config.urls, base: probeUrl } },
    };
    const warnSpy = jest.spyOn(probeCtx.logger, 'warn').mockImplementation(() => undefined);
    const result = await executeNavigateToBank(probeCtx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(false);
    const navFailureCall = warnSpy.mock.calls.find(
      call => isFailurePayload(call[0]) && call[0].event === 'INIT-ACTION-NAV-FAILURE',
    );
    expect(navFailureCall).toBeDefined();
    if (!navFailureCall) throw new ScraperError('INIT-ACTION-NAV-FAILURE warn call missing');
    const firstArg = navFailureCall[0];
    const isFailure = isFailurePayload(firstArg);
    expect(isFailure).toBe(true);
    if (!isFailure) throw new ScraperError('warn payload not a failure log envelope');
    expect(firstArg.nodeTransportProbe).toBeDefined();
    const probe = firstArg.nodeTransportProbe;
    expect(probe?.has).toBe(true);
    if (probe?.has) {
      expect(probe.value.timing).toBe('post-failure');
    }
  });
});

describe('executeValidatePage', () => {
  it('fails when no browser', async () => {
    const makeMockContextResult4 = makeMockContext();
    const result = await executeValidatePage(makeMockContextResult4);
    const isOkResult5 = isOk(result);
    expect(isOkResult5).toBe(false);
  });

  it('succeeds when page URL is not about:blank', async () => {
    const page = makePage({ url: 'https://bank.co.il/login' });
    const ctxWithPageResult6 = ctxWithPage(page);
    const result = await executeValidatePage(ctxWithPageResult6);
    const isOkResult7 = isOk(result);
    expect(isOkResult7).toBe(true);
  });

  it('fails when page URL is about:blank', async () => {
    const page = makePage({ url: 'about:blank' });
    const ctxWithPageResult8 = ctxWithPage(page);
    const result = await executeValidatePage(ctxWithPageResult8);
    const isOkResult9 = isOk(result);
    expect(isOkResult9).toBe(false);
  });

  // PR #221 review-fix session (2026-05-11): the earlier contract said
  // "POST is URL-only, no HTML scan". Empirical evidence under parallel
  // pre-commit Phase 5 (3 consecutive failures, screenshots captured)
  // showed Camoufox can render its built-in `Server Not Found` /
  // `We're having trouble finding that site` neterror page for the
  // target URL while keeping the URL unchanged. The DOM loads, the
  // commit fires, but the content is Firefox's local error page —
  // not the bank's HTML. Without this gate the failure cascaded 25-30s
  // through HOME → LOGIN → AUTH-DISCOVERY before AUTH-DISCOVERY.FINAL
  // raised `AUTH_DISCOVERY_DASHBOARD_NOT_READY — reveal-missing`.
  // Title-based detection is the cheapest reliable signal — Firefox
  // sets a deterministic title for every neterror sub-type.
  it('INIT-POST-NETERROR-001: fails when page title is "Server Not Found" (Firefox cold-start DNS)', async () => {
    const page = makePage({ url: 'https://start.telebank.co.il/login', title: 'Server Not Found' });
    const ctx = ctxWithPage(page);
    const result = await executeValidatePage(ctx);
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('browser error page');
  });

  it('INIT-POST-NETERROR-002: fails when title contains "trouble finding that site" (Firefox 100+ format)', async () => {
    const page = makePage({
      url: 'https://login.bankhapoalim.co.il/ng-portals/auth/he/login',
      title: "Hmm. We're having trouble finding that site.",
    });
    const ctx = ctxWithPage(page);
    const result = await executeValidatePage(ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(false);
  });

  it('INIT-POST-NETERROR-003: succeeds when page title is a legitimate bank title', async () => {
    const page = makePage({ url: 'https://bank.co.il', title: 'בנק דיסקונט - דף בית' });
    const ctx = ctxWithPage(page);
    const result = await executeValidatePage(ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
  });

  it('INIT-POST-NETERROR-004: succeeds when title() rejects — observability-only gate, never crashes POST', async () => {
    const page = makePage({ url: 'https://bank.co.il', titleThrows: true });
    const ctx = ctxWithPage(page);
    const result = await executeValidatePage(ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
  });
});

describe('executeWireComponents', () => {
  it('fails when no browser', async () => {
    const makeMockContextResult12 = makeMockContext();
    const result = await executeWireComponents(makeMockContextResult12);
    const isOkResult13 = isOk(result);
    expect(isOkResult13).toBe(false);
  });

  it('succeeds with mediator + fetchStrategy + loginUrl in diagnostics', async () => {
    const page = makePage({ url: 'https://bank.co.il/login' });
    const ctxWithPageResult14 = ctxWithPage(page);
    const result = await executeWireComponents(ctxWithPageResult14);
    const isOkResult15 = isOk(result);
    expect(isOkResult15).toBe(true);
    if (result.success) {
      expect(result.value.mediator.has).toBe(true);
      expect(result.value.fetchStrategy.has).toBe(true);
      expect(result.value.diagnostics.loginUrl).toBe('https://bank.co.il/login');
    }
  });

  it('fails loud when domcontentloaded never fires within INIT_DOM_READY_TIMEOUT_MS', async () => {
    // Mission M4.F1 follow-up — INIT.FINAL must signal LOUD when
    // the page never reached DOMContentLoaded. We make
    // `waitForLoadState` reject (Playwright's TimeoutError shape)
    // and assert the failure surfaces with the new error code.
    const page = makePage({ url: 'https://bank.co.il/login' });
    /**
     * Simulates Playwright's TimeoutError when DOMContentLoaded
     * never fires within the budget — INIT.FINAL must surface
     * this loud.
     *
     * @returns Rejected promise with a TimeoutError-shaped message.
     */
    const rejectingWait = (): Promise<void> =>
      Promise.reject(new Error('TimeoutError: dcl never fired'));
    (page as unknown as { waitForLoadState: () => Promise<void> }).waitForLoadState = rejectingWait;
    const ctxWithPageResult16 = ctxWithPage(page);
    const result = await executeWireComponents(ctxWithPageResult16);
    const isOkResult17 = isOk(result);
    expect(isOkResult17).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain('domcontentloaded not observed');
    }
  });
});
