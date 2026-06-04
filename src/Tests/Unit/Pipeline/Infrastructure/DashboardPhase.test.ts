/**
 * Unit tests for DashboardPhase -- PRE/ACTION/POST via BasePhase class.
 *
 * PRE:    probe dashboard indicators via resolveVisible -> store match
 * ACTION: physical navigation -- always click (no strategy dispatch)
 * POST:   check changePassword -> validate traffic -> store dashboard state
 */

import type { SelectorCandidate } from '../../../../Scrapers/Base/Config/LoginConfigTypes.js';
import { ScraperErrorTypes } from '../../../../Scrapers/Base/ErrorTypes.js';
import type { IRaceResult } from '../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { NOT_FOUND_RESULT } from '../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import {
  createDashboardPhase,
  DashboardPhase,
} from '../../../../Scrapers/Pipeline/Phases/Dashboard/DashboardPhase.js';
import { none, some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IActionContext,
  IPipelineContext,
} from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
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

/** Fake endpoint that satisfies `countTxnTraffic`: URL matches a WK
 *  transaction pattern AND body carries a non-empty txn-array under a
 *  WK txnContainers key. */
const MOCK_EP = {
  url: '/api/v1/transactions/list',
  method: 'GET' as const,
  timestamp: 1,
  postData: '',
  responseBody: { transactions: [{ amount: 1, date: '2026-01-01' }] },
  contentType: 'application/json',
  requestHeaders: {},
  responseHeaders: {},
};

/** Shape of the makeDashCtx opts (shared with extracted helpers). */
interface IMakeDashCtxOpts {
  clickFound?: boolean;
  resolveVisible?: IRaceResult;
  hasFetchStrategy?: boolean;
  withEndpoints?: boolean;
}

/**
 * Build the resolveAndClick + resolveVisible race-result mocks from
 * the opts. Centralises the "found vs not-found" mapping so the
 * orchestrator stays within the test-helper statement cap.
 * @param opts - makeDashCtx opts.
 * @returns Click result + visible-race default.
 */
function buildClickAndVisibleMocks(opts: IMakeDashCtxOpts): {
  clickResult: Procedure<IRaceResult>;
  visibleResolved: IRaceResult;
} {
  const foundRace = { ...NOT_FOUND_RESULT, found: true } as IRaceResult;
  const clickRace = opts.clickFound ? foundRace : NOT_FOUND_RESULT;
  const clickResult = succeed(clickRace);
  const visibleResolved = opts.resolveVisible ?? (opts.clickFound ? foundRace : NOT_FOUND_RESULT);
  return { clickResult, visibleResolved };
}

/**
 * Wrap the mock mediator's network surface with the endpoint stubs
 * required by the POST gate (`getAllEndpoints` + the new
 * `discoverTransactionsEndpoint` lookup).
 * @param base - Mediator returned from makeMockMediator.
 * @param withEndpoints - Seed-endpoints flag.
 * @returns Same mediator shape with `network` overrides applied.
 */
function buildMediatorWithEndpoints(
  base: ReturnType<typeof makeMockMediator>,
  withEndpoints: boolean,
): ReturnType<typeof makeMockMediator> {
  const eps = withEndpoints ? [MOCK_EP] : [];
  /**
   * Return seeded endpoints for traffic gate.
   * @returns Mock endpoints array.
   */
  const getAllEndpoints = (): typeof eps => eps;
  /**
   * Return the seeded txn endpoint when present (matches the new POST
   * gate that uses `discoverTransactionsEndpoint` instead of any-endpoint
   * count).
   * @returns Seeded endpoint or false.
   */
  const discoverTransactionsEndpoint = (): typeof MOCK_EP | false =>
    withEndpoints ? MOCK_EP : false;
  const network = { ...base.network, getAllEndpoints, discoverTransactionsEndpoint };
  return { ...base, network };
}

/**
 * Build the fetch-strategy override block consumed by makeMockContext.
 * Returns an empty object when fetch is intentionally disabled.
 * @param hasFetchStrategy - Whether to include a fetch strategy mock.
 * @returns Partial context overrides for fetchStrategy.
 */
function buildFetchOverrides(hasFetchStrategy: boolean): {
  fetchStrategy?: ReturnType<typeof some<ReturnType<typeof makeMockFetchStrategy>>>;
} {
  if (!hasFetchStrategy) return {};
  const fetchStrategy = makeMockFetchStrategy();
  return { fetchStrategy: some(fetchStrategy) };
}

/**
 * Build a context with browser + mediator for dashboard tests.
 * @param opts - Mock configuration.
 * @param opts.clickFound - Whether resolveAndClick finds an element.
 * @param opts.resolveVisible - What resolveVisible returns.
 * @param opts.hasFetchStrategy - Whether to include fetch strategy.
 * @param opts.withEndpoints - Seed mock endpoints for POST gate.
 * @returns Pipeline context.
 */
function makeDashCtx(opts: IMakeDashCtxOpts): IPipelineContext {
  const { clickResult, visibleResolved } = buildClickAndVisibleMocks(opts);
  const browserState = makeMockBrowserState();
  const base = makeMockMediator({
    /**
     * Return configured resolveAndClick Procedure.
     * @returns Procedure with IRaceResult.
     */
    resolveAndClick: (): Promise<Procedure<IRaceResult>> => Promise.resolve(clickResult),
    /**
     * Return configured resolveVisible result.
     * @returns IRaceResult.
     */
    resolveVisible: (): Promise<IRaceResult> => Promise.resolve(visibleResolved),
  });
  const mediator = buildMediatorWithEndpoints(base, opts.withEndpoints ?? false);
  const fetchOverrides = buildFetchOverrides(opts.hasFetchStrategy !== false);
  return makeMockContext({
    browser: some(browserState),
    mediator: some(mediator),
    ...fetchOverrides,
  });
}

// -- PRE step --

describe('DashboardPhase/PRE', () => {
  it('fails when indicator found but no navigation target', async () => {
    const greetingCandidate: SelectorCandidate = { kind: 'regex', value: String.raw`^שלום\s+\S+` };
    const mockResult: IRaceResult = {
      found: true,
      locator: false,
      candidate: greetingCandidate,
      context: false,
      index: 0,
      value: 'שלום ישראל',
      identity: false,
    };
    const ctx = makeDashCtx({ resolveVisible: mockResult });
    const isSuccess = isOk(await PHASE.pre(ctx, ctx));
    expect(isSuccess).toBe(false);
  });

  it('fails when no navigation target found', async () => {
    const ctx = makeDashCtx({});
    const result = await PHASE.pre(ctx, ctx);
    const didSucceed = isOk(result);
    expect(didSucceed).toBe(false);
  });

  it('fails when no browser in context', async () => {
    const ctx = makeMockContext();
    const isSuccess = isOk(await PHASE.pre(ctx, ctx));
    expect(isSuccess).toBe(false);
  });
});

// -- ACTION step (sealed -- pure navigation) --

describe('DashboardPhase/ACTION', () => {
  it('succeeds with no target (no-op -- traffic from login)', async () => {
    const ctx = makeDashCtx({ hasFetchStrategy: true });
    const actionCtx = { ...ctx, executor: none() } as unknown as IActionContext;
    const result = await PHASE.action(actionCtx, actionCtx);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
  });

  it('succeeds without fetchStrategy (no-op navigation)', async () => {
    const ctx = makeDashCtx({ hasFetchStrategy: false });
    const actionCtx = { ...ctx, executor: none() } as unknown as IActionContext;
    const result = await PHASE.action(actionCtx, actionCtx);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
  });

  it('succeeds even without mediator (sealed action is mediator-free)', async () => {
    const browserState = makeMockBrowserState();
    const ctx = makeMockContext({ browser: some(browserState) });
    const actionCtx = { ...ctx, executor: none() } as unknown as IActionContext;
    const isSuccess = isOk(await PHASE.action(actionCtx, actionCtx));
    expect(isSuccess).toBe(true);
  });
});

// -- POST step --

describe('DashboardPhase/POST', () => {
  it('stores dashboard pageUrl when endpoints exist', async () => {
    const ctx = makeDashCtx({ clickFound: false, withEndpoints: true });
    const result = await PHASE.post(ctx, ctx);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    if (result.success) expect(result.value.dashboard.has).toBe(true);
  });

  it('fails when no endpoints captured (traffic gate)', async () => {
    const ctx = makeDashCtx({ clickFound: false, withEndpoints: false });
    const result = await PHASE.post(ctx, ctx);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(false);
  });

  it('fails with ChangePassword when indicator found', async () => {
    const ctx = makeDashCtx({ clickFound: true, withEndpoints: true });
    const result = await PHASE.post(ctx, ctx);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(false);
    if (!result.success) expect(result.errorType).toBe(ScraperErrorTypes.ChangePassword);
  });
});

describe('DashboardPhase/FINAL', () => {
  it('delegates to executeCollectAndSignal — fails when dashboard not ready', async () => {
    const ctx = makeDashCtx({ clickFound: false, withEndpoints: false });
    const result = await PHASE.final(ctx, ctx);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(false);
  });
});

// -- Factory --

describe('DashboardPhase/createDashboardPhase', () => {
  it('returns a DashboardPhase instance with correct name', () => {
    const phase = createDashboardPhase();
    expect(phase.name).toBe('dashboard');
    expect(phase).toBeInstanceOf(DashboardPhase);
  });
});
