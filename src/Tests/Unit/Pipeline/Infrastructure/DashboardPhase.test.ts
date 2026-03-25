/**
 * Unit tests for DashboardPhase — PRE/ACTION/POST split.
 *
 * PRE:    probe dashboard indicators via resolveVisible → store which matched
 * ACTION: build API context from network traffic
 * POST:   check changePassword → store dashboard.pageUrl
 */

import type { SelectorCandidate } from '../../../../Scrapers/Base/Config/LoginConfigTypes.js';
import { ScraperErrorTypes } from '../../../../Scrapers/Base/ErrorTypes.js';
import type { IRaceResult } from '../../../../Scrapers/Pipeline/Mediator/ElementMediator.js';
import { NOT_FOUND_RESULT } from '../../../../Scrapers/Pipeline/Mediator/ElementMediator.js';
import {
  createDashboardPhase,
  DASHBOARD_ACTION_STEP,
  DASHBOARD_POST_STEP,
  DASHBOARD_PRE_STEP,
  DASHBOARD_STEP,
} from '../../../../Scrapers/Pipeline/Phases/DashboardPhase.js';
import { some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type { IPipelineContext } from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { isOk } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import {
  makeMockBrowserState,
  makeMockFetchStrategy,
  makeMockMediator,
} from '../../Scrapers/Pipeline/MockPipelineFactories.js';
import { makeMockContext } from './MockFactories.js';

/**
 * Build a context with browser + mediator for dashboard tests.
 * @param opts - Mock configuration.
 * @param opts.resolveAndClick - What resolveAndClick returns.
 * @param opts.resolveVisible - What resolveVisible returns.
 * @param opts.hasFetchStrategy - Whether to include fetch strategy.
 * @returns Pipeline context.
 */
function makeDashCtx(opts: {
  resolveAndClick?: boolean;
  resolveVisible?: IRaceResult;
  hasFetchStrategy?: boolean;
}): IPipelineContext {
  const browserState = makeMockBrowserState();
  const mediator = makeMockMediator({
    /**
     * Return configured resolveAndClick result.
     * @returns Boolean.
     */
    resolveAndClick: (): Promise<boolean> => Promise.resolve(opts.resolveAndClick ?? true),
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

// ── DASHBOARD_STEP (legacy) ──────────────────────────────

describe('DashboardPhase/DASHBOARD_STEP', () => {
  it('still exported for backward compatibility', () => {
    expect(DASHBOARD_STEP).toBeDefined();
    expect(DASHBOARD_STEP.name).toBe('dashboard');
  });
});

// ── PRE step ──────────────────────────────────────────────

describe('DashboardPhase/PRE', () => {
  it('succeeds when dashboard indicator found', async () => {
    const greetingCandidate: SelectorCandidate = {
      kind: 'regex',
      value: '^שלום\\s+\\S+',
    };
    const mockResult: IRaceResult = {
      found: true,
      locator: false,
      candidate: greetingCandidate,
      context: false,
      index: 0,
      value: 'שלום ישראל',
    };
    const ctx = makeDashCtx({ resolveVisible: mockResult });
    const isSuccess = isOk(await DASHBOARD_PRE_STEP.execute(ctx, ctx));
    expect(isSuccess).toBe(true);
  });

  it('succeeds even when no dashboard indicator found (best-effort)', async () => {
    const ctx = makeDashCtx({});
    const isSuccess = isOk(await DASHBOARD_PRE_STEP.execute(ctx, ctx));
    expect(isSuccess).toBe(true);
  });

  it('fails when no browser in context', async () => {
    const ctx = makeMockContext();
    const isSuccess = isOk(await DASHBOARD_PRE_STEP.execute(ctx, ctx));
    expect(isSuccess).toBe(false);
  });
});

// ── ACTION step ──────────────────────────────────────────

describe('DashboardPhase/ACTION', () => {
  it('builds API context when fetchStrategy is present', async () => {
    const ctx = makeDashCtx({ hasFetchStrategy: true });
    const result = await DASHBOARD_ACTION_STEP.execute(ctx, ctx);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    if (result.success) {
      expect(result.value.api.has).toBe(true);
    }
  });

  it('succeeds without API context when no fetchStrategy', async () => {
    const ctx = makeDashCtx({ hasFetchStrategy: false });
    const result = await DASHBOARD_ACTION_STEP.execute(ctx, ctx);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    if (result.success) {
      expect(result.value.api.has).toBe(false);
    }
  });

  it('fails when no mediator in context', async () => {
    const browserState = makeMockBrowserState();
    const ctx = makeMockContext({ browser: some(browserState) });
    const isSuccess = isOk(await DASHBOARD_ACTION_STEP.execute(ctx, ctx));
    expect(isSuccess).toBe(false);
  });
});

// ── POST step ─────────────────────────────────────────────

describe('DashboardPhase/POST', () => {
  it('stores dashboard pageUrl', async () => {
    const ctx = makeDashCtx({ resolveAndClick: false });
    const result = await DASHBOARD_POST_STEP.execute(ctx, ctx);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    if (result.success) {
      expect(result.value.dashboard.has).toBe(true);
    }
  });

  it('fails with ChangePassword when changePassword indicator found', async () => {
    const ctx = makeDashCtx({ resolveAndClick: true });
    const result = await DASHBOARD_POST_STEP.execute(ctx, ctx);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(false);
    if (!result.success) {
      expect(result.errorType).toBe(ScraperErrorTypes.ChangePassword);
    }
  });
});

// ── createDashboardPhase factory ─────────────────────────

describe('DashboardPhase/createDashboardPhase', () => {
  it('returns IPhaseDefinition with pre, action, and post', () => {
    const phase = createDashboardPhase();
    expect(phase.name).toBe('dashboard');
    expect(phase.pre.has).toBe(true);
    expect(phase.post.has).toBe(true);
  });
});
