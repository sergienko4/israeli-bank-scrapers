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
import { WK_DASHBOARD } from '../../../../Scrapers/Pipeline/Registry/WK/DashboardWK.js';
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
  const network = { ...base.network, ...buildEndpointOverrides(eps, withEndpoints) };
  return { ...base, network };
}

/** Endpoint stubs spread into `base.network` to seed POST-gate. */
interface IEndpointOverrides {
  getAllEndpoints: () => readonly (typeof MOCK_EP)[];
  discoverTransactionsEndpoint: () => typeof MOCK_EP | false;
}

/**
 * Build the network-surface overrides for `buildMediatorWithEndpoints`.
 * Split out from the parent helper to comply with §19.10 (≤10 lines).
 * @param eps - Seeded endpoints array (empty when withEndpoints false).
 * @param withEndpoints - Whether to expose the seeded txn endpoint.
 * @returns Object spread into `base.network` to seed POST-gate stubs.
 */
function buildEndpointOverrides(
  eps: readonly (typeof MOCK_EP)[],
  withEndpoints: boolean,
): IEndpointOverrides {
  const getAllEndpoints = makeEndpointGetter(eps);
  const discoverTransactionsEndpoint = makeTxnEndpointGetter(withEndpoints);
  return { getAllEndpoints, discoverTransactionsEndpoint };
}

/**
 * Higher-order helper for the POST-gate `getAllEndpoints` stub.
 * Returns a closure-over-eps thunk so `buildEndpointOverrides` stays ≤10 lines.
 * @param eps - Seeded endpoints array.
 * @returns Thunk that returns the array on each call.
 */
function makeEndpointGetter(eps: readonly (typeof MOCK_EP)[]): () => readonly (typeof MOCK_EP)[] {
  return (): readonly (typeof MOCK_EP)[] => eps;
}

/**
 * Higher-order helper for the POST-gate `discoverTransactionsEndpoint` stub.
 * Returns the seeded endpoint when present, false otherwise.
 * @param withEndpoints - Whether the test seeded a txn endpoint.
 * @returns Thunk returning the seeded endpoint or false.
 */
function makeTxnEndpointGetter(withEndpoints: boolean): () => typeof MOCK_EP | false {
  return (): typeof MOCK_EP | false => (withEndpoints ? MOCK_EP : false);
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
  const browserState = makeMockBrowserState();
  const browser = some(browserState);
  const baseMediator = buildBaseMediator(opts);
  const mediatorImpl = buildMediatorWithEndpoints(baseMediator, opts.withEndpoints ?? false);
  const mediator = some(mediatorImpl);
  const fetchOverrides = buildFetchOverrides(opts.hasFetchStrategy !== false);
  return makeMockContext({ browser, mediator, ...fetchOverrides });
}

/**
 * Build the base mock mediator with resolveAndClick / resolveVisible stubs
 * configured from the test opts. Split from makeDashCtx for §19.10.
 * @param opts - makeDashCtx opts (clickFound / resolveVisible).
 * @returns Mock mediator before endpoint overrides apply.
 */
function buildBaseMediator(opts: IMakeDashCtxOpts): ReturnType<typeof makeMockMediator> {
  const { clickResult, visibleResolved } = buildClickAndVisibleMocks(opts);
  return makeMockMediator({
    resolveAndClick: makeClickStub(clickResult),
    resolveVisible: makeVisibleStub(visibleResolved),
  });
}

/**
 * Higher-order helper that wraps a fixed click result in a Promise-returning
 * stub matching the resolveAndClick mediator signature.
 * @param clickResult - The fixed Procedure to resolve.
 * @returns Mediator-shaped resolveAndClick stub.
 */
function makeClickStub(clickResult: Procedure<IRaceResult>): () => Promise<Procedure<IRaceResult>> {
  return (): Promise<Procedure<IRaceResult>> => Promise.resolve(clickResult);
}

/**
 * Structural equality for a single selector candidate — compares the
 * semantic fields (kind/value/target/match) rather than object identity.
 * @param x - First candidate.
 * @param y - Second candidate.
 * @returns True when both candidates carry identical field values.
 */
function sameCandidate(x: SelectorCandidate, y: SelectorCandidate): boolean {
  return x.kind === y.kind && x.value === y.value && x.target === y.target && x.match === y.match;
}

/**
 * Structural (not reference) equality for two candidate lists — order-
 * sensitive and element-wise. Lets the stub recognise the dashboard success
 * group even when the call site passes a copied array; a `===` identity check
 * would silently miss the copy and stop modelling the forced-change page.
 * @param a - First candidate list.
 * @param b - Second candidate list.
 * @returns True when both lists are the same length with equal elements.
 */
function sameCandidates(a: readonly SelectorCandidate[], b: readonly SelectorCandidate[]): boolean {
  return a.length === b.length && a.every((x, i) => sameCandidate(x, b[i]));
}

/**
 * Higher-order helper that wraps a fixed race result in a Promise-returning
 * stub matching the resolveVisible mediator signature. The dashboard-success
 * group resolves NOT_FOUND so a change-password probe models a real
 * forced-change page (which replaces the dashboard) rather than the benign
 * settings-menu link that coexists with a ready dashboard.
 * @param visibleResolved - The fixed IRaceResult to resolve.
 * @returns Mediator-shaped resolveVisible stub.
 */
function makeVisibleStub(
  visibleResolved: IRaceResult,
): (candidates: readonly SelectorCandidate[]) => Promise<IRaceResult> {
  const successGroup = WK_DASHBOARD.SUCCESS as unknown as readonly SelectorCandidate[];
  return (candidates: readonly SelectorCandidate[]): Promise<IRaceResult> =>
    Promise.resolve(sameCandidates(candidates, successGroup) ? NOT_FOUND_RESULT : visibleResolved);
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

describe('makeVisibleStub — structural (not reference) success-group match (CR #381)', () => {
  it('resolves NOT_FOUND for a copied success group (structural, not reference)', async () => {
    const visible: IRaceResult = {
      found: true,
      locator: false,
      candidate: false,
      context: false,
      index: 0,
      value: '',
      identity: false,
    };
    const stub = makeVisibleStub(visible);
    const success = WK_DASHBOARD.SUCCESS as unknown as readonly SelectorCandidate[];
    const copiedSuccess = success.map(c => ({ ...c }));
    const result = await stub(copiedSuccess);
    expect(result).toBe(NOT_FOUND_RESULT);
  });
});
