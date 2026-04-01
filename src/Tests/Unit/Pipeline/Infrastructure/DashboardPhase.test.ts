/**
 * Unit tests for DashboardPhase — PRE/ACTION/POST via BasePhase class.
 *
 * PRE:    probe dashboard indicators via resolveVisible → store match
 * ACTION: build API context from network traffic
 * POST:   check changePassword → store dashboard.pageUrl
 */

import type { SelectorCandidate } from '../../../../Scrapers/Base/Config/LoginConfigTypes.js';
import { ScraperErrorTypes } from '../../../../Scrapers/Base/ErrorTypes.js';
import type { IRaceResult } from '../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { NOT_FOUND_RESULT } from '../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import {
  createDashboardPhase,
  DashboardPhase,
} from '../../../../Scrapers/Pipeline/Phases/Dashboard/DashboardPhase.js';
import { some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type { IPipelineContext } from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { isOk, succeed } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import {
  makeMockBrowserState,
  makeMockFetchStrategy,
  makeMockMediator,
} from '../../Scrapers/Pipeline/MockPipelineFactories.js';
import { makeMockContext } from './MockFactories.js';

/** Shared phase instance for all tests. */
const PHASE = new DashboardPhase();

/**
 * Build a context with browser + mediator for dashboard tests.
 * @param opts - Mock configuration.
 * @param opts.clickFound - Whether resolveAndClick finds an element.
 * @param opts.resolveVisible - What resolveVisible returns.
 * @param opts.hasFetchStrategy - Whether to include fetch strategy.
 * @returns Pipeline context.
 */
function makeDashCtx(opts: {
  clickFound?: boolean;
  resolveVisible?: IRaceResult;
  hasFetchStrategy?: boolean;
}): IPipelineContext {
  const clickRace = opts.clickFound ? { ...NOT_FOUND_RESULT, found: true } : NOT_FOUND_RESULT;
  const clickResult = succeed(clickRace);
  const browserState = makeMockBrowserState();
  const mediator = makeMockMediator({
    /**
     * Return configured resolveAndClick Procedure.
     * @returns Procedure with IRaceResult.
     */
    resolveAndClick: (): Promise<Procedure<IRaceResult>> => Promise.resolve(clickResult),
    /**
     * Return configured resolveVisible result.
     * @returns IRaceResult.
     */
    resolveVisible: (): Promise<IRaceResult> =>
      Promise.resolve(opts.resolveVisible ?? NOT_FOUND_RESULT),
  });
  const hasFetch = opts.hasFetchStrategy !== false;
  const fetchStrategy = makeMockFetchStrategy();
  const fetchOverrides = hasFetch ? { fetchStrategy: some(fetchStrategy) } : {};
  return makeMockContext({
    browser: some(browserState),
    mediator: some(mediator),
    ...fetchOverrides,
  });
}

// ── PRE step ──────────────────────────────────────────────

describe('DashboardPhase/PRE', () => {
  it('succeeds when dashboard indicator found', async () => {
    const greetingCandidate: SelectorCandidate = { kind: 'regex', value: '^שלום\\s+\\S+' };
    const mockResult: IRaceResult = {
      found: true,
      locator: false,
      candidate: greetingCandidate,
      context: false,
      index: 0,
      value: 'שלום ישראל',
    };
    const ctx = makeDashCtx({ resolveVisible: mockResult });
    const isSuccess = isOk(await PHASE.pre(ctx, ctx));
    expect(isSuccess).toBe(true);
  });

  it('succeeds even when no dashboard indicator found (best-effort)', async () => {
    const ctx = makeDashCtx({});
    const isSuccess = isOk(await PHASE.pre(ctx, ctx));
    expect(isSuccess).toBe(true);
  });

  it('fails when no browser in context', async () => {
    const ctx = makeMockContext();
    const isSuccess = isOk(await PHASE.pre(ctx, ctx));
    expect(isSuccess).toBe(false);
  });
});

// ── ACTION step ──────────────────────────────────────────

describe('DashboardPhase/ACTION', () => {
  it('builds API context when fetchStrategy is present', async () => {
    const ctx = makeDashCtx({ hasFetchStrategy: true });
    const result = await PHASE.action(ctx, ctx);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    if (result.success) expect(result.value.api.has).toBe(true);
  });

  it('succeeds without API context when no fetchStrategy', async () => {
    const ctx = makeDashCtx({ hasFetchStrategy: false });
    const result = await PHASE.action(ctx, ctx);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    if (result.success) expect(result.value.api.has).toBe(false);
  });

  it('fails when no mediator in context', async () => {
    const browserState = makeMockBrowserState();
    const ctx = makeMockContext({ browser: some(browserState) });
    const isSuccess = isOk(await PHASE.action(ctx, ctx));
    expect(isSuccess).toBe(false);
  });
});

// ── POST step ─────────────────────────────────────────────

describe('DashboardPhase/POST', () => {
  it('stores dashboard pageUrl', async () => {
    const ctx = makeDashCtx({ clickFound: false });
    const result = await PHASE.post(ctx, ctx);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    if (result.success) expect(result.value.dashboard.has).toBe(true);
  });

  it('fails with ChangePassword when indicator found', async () => {
    const ctx = makeDashCtx({ clickFound: true });
    const result = await PHASE.post(ctx, ctx);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(false);
    if (!result.success) expect(result.errorType).toBe(ScraperErrorTypes.ChangePassword);
  });

  it('hard-fails with UNPRIMED when strategy=TRIGGER and trafficCount=0', async () => {
    const baseCtx = makeDashCtx({ clickFound: false });
    const triggerCtx = {
      ...baseCtx,
      diagnostics: { ...baseCtx.diagnostics, dashboardStrategy: 'TRIGGER' as const },
    };
    const result = await PHASE.post(triggerCtx, triggerCtx);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('UNPRIMED');
  });

  it('succeeds for BYPASS strategy even with 0 traffic', async () => {
    const baseCtx = makeDashCtx({ clickFound: false });
    const bypassCtx = {
      ...baseCtx,
      diagnostics: { ...baseCtx.diagnostics, dashboardStrategy: 'BYPASS' as const },
    };
    const result = await PHASE.post(bypassCtx, bypassCtx);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
  });
});

// ── Factory ──────────────────────────────────────────────

describe('DashboardPhase/createDashboardPhase', () => {
  it('returns a DashboardPhase instance with correct name', () => {
    const phase = createDashboardPhase();
    expect(phase.name).toBe('dashboard');
    expect(phase).toBeInstanceOf(DashboardPhase);
  });
});
