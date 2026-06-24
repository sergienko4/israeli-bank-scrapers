/**
 * Mission 1 — cross-bank factory test for AUTH-DISCOVERY.
 *
 * <p>One logic path, parametrized over every browser-flow bank.
 * Same shape as `CrossBankAccountResolve.test.ts` and
 * `CrossBankScrapeConsumesTxnEndpoint.test.ts` — exercise the
 * production handlers (not internal helpers) against a per-bank
 * synthesised mediator and assert the slim {@link IAuthDiscovery}
 * contract emits the expected booleans + counts.
 *
 * <p>Per-bank fixtures live inline (closed enum) — JSON snapshots
 * for AUTH-DISCOVERY entry state are tracked as a future
 * enhancement (would replace the inline literals with
 * `Bank/<Bank>/AuthDiscovery/<Bank>AuthDiscovery.test.ts`); the
 * factory pattern + parametrization stay identical. Today's M1
 * cap: prove every pre-listed bank flows through PRE → POST →
 * FINAL with no regression and emits a populated
 * `ctx.authDiscovery`.
 */

import {
  executeAuthDiscoveryFinal,
  executeAuthDiscoveryPost,
  executeAuthDiscoveryPre,
} from '../../../../../Scrapers/Pipeline/Mediator/AuthDiscovery/AuthDiscoveryActions.js';
import type {
  ICookieSnapshot,
  IElementMediator,
} from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import type { IFetchOpts } from '../../../../../Scrapers/Pipeline/Strategy/Fetch/FetchStrategy.js';
import type { IPipelineContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { isOk } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';

/** Browser-flow bank enum for cross-bank fixture coverage. */
type FixtureBank =
  | 'discount'
  | 'hapoalim'
  | 'beinleumi'
  | 'max'
  | 'visacal'
  | 'amex'
  | 'isracard'
  | 'onezero'
  | 'massad'
  | 'otsarHahayal'
  | 'pagi'
  | 'mercantile';

/** Inline per-bank fixture — code-defined for M1. */
interface IBankFixture {
  readonly bank: FixtureBank;
  readonly cookieNames: readonly string[];
  readonly authToken: string | false;
  readonly origin: string | false;
  readonly siteId: string | false;
  readonly headers: Readonly<Record<string, string>>;
  readonly dashboardRevealed: boolean;
}

/** All browser-flow banks must appear in the fixture list. */
const BANK_FIXTURES: readonly IBankFixture[] = [
  {
    bank: 'discount',
    cookieNames: ['JSESSIONID', 'TS01abc'],
    authToken: false,
    origin: 'https://www.discountbank.co.il',
    siteId: false,
    headers: { Accept: 'application/json' },
    dashboardRevealed: true,
  },
  {
    bank: 'hapoalim',
    cookieNames: ['JSESSIONID', 'PSEK', 'BRP_AT'],
    authToken: 'fake-bearer-hapoalim',
    origin: 'https://login.bankhapoalim.co.il',
    siteId: false,
    headers: { 'X-Channel-Id': 'INTERNET-NEW' },
    dashboardRevealed: true,
  },
  {
    bank: 'beinleumi',
    cookieNames: ['JSESSIONID', 'sessionId'],
    authToken: 'fake-bearer-beinleumi',
    origin: 'https://www.fibi.co.il',
    siteId: '10',
    headers: { 'X-Site-Id': '10', Accept: 'application/json' },
    dashboardRevealed: true,
  },
  {
    bank: 'max',
    cookieNames: ['__RequestVerificationToken', '.AspNet.ApplicationCookie'],
    authToken: false,
    origin: 'https://www.max.co.il',
    siteId: false,
    headers: { Accept: 'application/json' },
    dashboardRevealed: true,
  },
  {
    bank: 'visacal',
    cookieNames: ['ARRAffinity', 'cal-online-session'],
    authToken: 'fake-bearer-visacal',
    origin: 'https://www.cal-online.co.il',
    siteId: false,
    headers: { Accept: 'application/json' },
    dashboardRevealed: true,
  },
  {
    bank: 'amex',
    cookieNames: ['ASP.NET_SessionId', 'AmexSession'],
    authToken: false,
    origin: 'https://he.americanexpress.co.il',
    siteId: false,
    headers: { Accept: 'application/json' },
    dashboardRevealed: true,
  },
  {
    bank: 'isracard',
    cookieNames: ['ASP.NET_SessionId', 'IsracardSession'],
    authToken: false,
    origin: 'https://digital.isracard.co.il',
    siteId: false,
    headers: { Accept: 'application/json' },
    dashboardRevealed: true,
  },
  {
    bank: 'onezero',
    cookieNames: ['onezero-session', 'auth0-session'],
    authToken: 'fake-bearer-onezero',
    origin: 'https://app.onezerobank.com',
    siteId: false,
    headers: { Authorization: 'Bearer fake-bearer-onezero' },
    dashboardRevealed: true,
  },
  {
    bank: 'massad',
    cookieNames: ['JSESSIONID', 'sessionId'],
    authToken: false,
    origin: 'https://www.bankmassad.example',
    siteId: '14',
    headers: { 'X-Site-Id': '14', Accept: 'application/json' },
    dashboardRevealed: true,
  },
  {
    bank: 'otsarHahayal',
    cookieNames: ['JSESSIONID', 'sessionId'],
    authToken: false,
    origin: 'https://www.bankotsar.example',
    siteId: '14',
    headers: { 'X-Site-Id': '14', Accept: 'application/json' },
    dashboardRevealed: true,
  },
  {
    bank: 'pagi',
    cookieNames: ['JSESSIONID', 'sessionId'],
    authToken: false,
    origin: 'https://www.bankpagi.example',
    siteId: '14',
    headers: { 'X-Site-Id': '14', Accept: 'application/json' },
    dashboardRevealed: true,
  },
  {
    bank: 'mercantile',
    cookieNames: ['JSESSIONID', 'TS01abc'],
    authToken: false,
    origin: 'https://www.mercantile.example',
    siteId: false,
    headers: { Accept: 'application/json' },
    dashboardRevealed: true,
  },
];

/** Default cookie metadata applied uniformly to every fixture cookie. */
const COOKIE_DEFAULTS = {
  value: 'redacted',
  domain: 'example.bank',
  path: '/',
  expires: -1,
  httpOnly: true,
  secure: true,
  sameSite: 'None',
} as const;

/**
 * Build a single cookie snapshot from a fixture cookie name. Mock
 * metadata is sourced from COOKIE_DEFAULTS. Extracted per §19.10.
 * @param name - Cookie name from the fixture.
 * @returns Cookie snapshot with default mock metadata applied.
 */
function cookieFromName(name: string): ICookieSnapshot {
  return { name, ...COOKIE_DEFAULTS };
}

/**
 * Build the per-bank cookie snapshots consumed by `makeFixtureMediator`.
 * Extracted per §19.10 (≤10 lines) so the parent helper stays short.
 * @param cookieNames - Fixture cookie names (only the name matters here).
 * @returns Cookie snapshot array with mock metadata applied uniformly.
 */
function buildCookieSnapshots(cookieNames: readonly string[]): readonly ICookieSnapshot[] {
  return cookieNames.map(cookieFromName);
}

/** Synthetic dashboard candidate emitted by the reveal stub. */
const REVEALED_RESULT = {
  found: true,
  candidate: { kind: 'textContent', value: 'יתרה' },
} as const;

/** Sentinel emitted when the fixture has no dashboard reveal. */
const NOT_REVEALED_RESULT = { found: false, candidate: false } as const;

/**
 * Build the `resolveVisible` stub for `makeFixtureMediator`. Returns a
 * positive resolve when the fixture advertises a dashboard reveal, the
 * not-found sentinel otherwise. Extracted per §19.10.
 * @param fixture - Per-bank fixture (only `dashboardRevealed` is read).
 * @returns Mediator-shaped resolveVisible stub.
 */
function buildResolveVisibleStub(fixture: IBankFixture): () => Promise<unknown> {
  return (): Promise<unknown> =>
    Promise.resolve(fixture.dashboardRevealed ? REVEALED_RESULT : NOT_REVEALED_RESULT);
}

/** Shape of the `network` sub-object on the fixture mediator. */
interface IAuthDiscoveryNetworkStub {
  getAllEndpoints: () => readonly [];
  discoverAuthToken: () => Promise<string | false>;
  discoverOrigin: () => string | false;
  discoverSiteId: () => string | false;
  buildDiscoveredHeaders: () => Promise<IFetchOpts>;
  discoverByPatterns: () => false;
}

/**
 * Empty endpoint pool stub — PRE counts captures only.
 * Extracted per §19.10 so `buildNetworkStub` stays compact.
 * @returns Thunk that returns the empty tuple.
 */
function makeEmptyEndpointsGetter(): () => readonly [] {
  return (): readonly [] => [];
}

/**
 * Fixture-scoped auth-token discovery stub.
 * @param fixture - Per-bank fixture (only `authToken` is read).
 * @returns Thunk that resolves to the fixture token.
 */
function makeAuthTokenGetter(fixture: IBankFixture): () => Promise<string | false> {
  return (): Promise<string | false> => Promise.resolve(fixture.authToken);
}

/**
 * Fixture-scoped origin discovery stub.
 * @param fixture - Per-bank fixture (only `origin` is read).
 * @returns Thunk that returns the fixture origin.
 */
function makeOriginGetter(fixture: IBankFixture): () => string | false {
  return (): string | false => fixture.origin;
}

/**
 * Fixture-scoped site-id discovery stub.
 * @param fixture - Per-bank fixture (only `siteId` is read).
 * @returns Thunk that returns the fixture siteId.
 */
function makeSiteIdGetter(fixture: IBankFixture): () => string | false {
  return (): string | false => fixture.siteId;
}

/**
 * Fixture-scoped fetch-header builder stub.
 * @param fetchOpts - Pre-built fetch opts (headers merged in).
 * @returns Thunk that resolves to the fetch opts.
 */
function makeDiscoveredHeadersBuilder(fetchOpts: IFetchOpts): () => Promise<IFetchOpts> {
  return (): Promise<IFetchOpts> => Promise.resolve(fetchOpts);
}

/**
 * Stub `discoverByPatterns` — factory tests have no first-party API captures.
 * @returns Always false.
 */
function noopPatternDiscovery(): false {
  return false;
}

/**
 * Build the `network` sub-object for `makeFixtureMediator`. Implements
 * only the surface AUTH-DISCOVERY touches. Extracted per §19.10.
 * @param fixture - Per-bank fixture.
 * @param fetchOpts - Pre-built fetch opts for buildDiscoveredHeaders.
 * @returns Network helper bundle (6 stubs).
 */
function buildNetworkStub(fixture: IBankFixture, fetchOpts: IFetchOpts): IAuthDiscoveryNetworkStub {
  return {
    getAllEndpoints: makeEmptyEndpointsGetter(),
    discoverAuthToken: makeAuthTokenGetter(fixture),
    discoverOrigin: makeOriginGetter(fixture),
    discoverSiteId: makeSiteIdGetter(fixture),
    buildDiscoveredHeaders: makeDiscoveredHeadersBuilder(fetchOpts),
    discoverByPatterns: noopPatternDiscovery,
  };
}

/** Settle sentinel emitted by buildSettleStub (avoids returning undefined). */
const SETTLE_OK_SENTINEL = { success: true as const, value: 'settled' as const };

/**
 * Build a no-op `waitForNetworkIdle` stub. AUTH-DISCOVERY.PRE awaits it
 * before inventorying the capture pool — instant resolve dodges the
 * real timer cost in unit-test land. Extracted per §19.10.
 * @returns Mediator-shaped waitForNetworkIdle stub.
 */
function buildSettleStub(): () => Promise<typeof SETTLE_OK_SENTINEL> {
  return (): Promise<typeof SETTLE_OK_SENTINEL> => Promise.resolve(SETTLE_OK_SENTINEL);
}

/**
 * Build a `getCurrentUrl` stub returning the empty-string "test path"
 * sentinel — the FINAL gate disables the URL-change check when either
 * side is `''` so the gate decides on REVEAL alone. Extracted per §19.10.
 * @returns Mediator-shaped getCurrentUrl stub.
 */
function buildUrlStub(): () => string {
  return (): string => '';
}

/**
 * Build the `getCookies` stub for `makeFixtureMediator`. Extracted per
 * §19.10 so the parent factory stays under the line cap.
 * @param cookieSnapshots - Pre-built cookie snapshots from the fixture.
 * @returns Mediator-shaped getCookies stub.
 */
function buildGetCookiesStub(
  cookieSnapshots: readonly ICookieSnapshot[],
): () => Promise<readonly ICookieSnapshot[]> {
  return (): Promise<readonly ICookieSnapshot[]> => Promise.resolve(cookieSnapshots);
}

/** Internal shape of the assembled mediator stub before IElementMediator cast. */
interface IFixtureMediatorStub {
  getCookies: () => Promise<readonly ICookieSnapshot[]>;
  resolveVisible: () => Promise<unknown>;
  network: IAuthDiscoveryNetworkStub;
  waitForNetworkIdle: () => Promise<typeof SETTLE_OK_SENTINEL>;
  getCurrentUrl: () => string;
}

/** Params bundle for `assembleMediatorStub`. */
interface IAssembleStubParams {
  cookieSnapshots: readonly ICookieSnapshot[];
  fixture: IBankFixture;
  fetchOpts: IFetchOpts;
}

/**
 * Assemble the fixture-mediator stub from its 5 component sub-builders.
 * Extracted per §19.10 so `makeFixtureMediator` stays ≤10 lines.
 * @param params - Pre-built inputs (cookies, fixture, fetch opts).
 * @returns Stub object ready for the final IElementMediator cast.
 */
function assembleMediatorStub(params: IAssembleStubParams): IFixtureMediatorStub {
  return {
    getCookies: buildGetCookiesStub(params.cookieSnapshots),
    resolveVisible: buildResolveVisibleStub(params.fixture),
    network: buildNetworkStub(params.fixture, params.fetchOpts),
    waitForNetworkIdle: buildSettleStub(),
    getCurrentUrl: buildUrlStub(),
  };
}

/**
 * Build a per-bank mock mediator that returns the fixture's
 * cookies + network helper outputs + dashboard reveal result. Type
 * cast to `IElementMediator` — only the surface AUTH-DISCOVERY
 * touches is implemented.
 *
 * <p>`probeDashboardReveal` is invoked by AUTH-DISCOVERY.POST and
 * delegates to `mediator.resolveVisible(...)`. The mock here
 * returns a positive resolve when `dashboardRevealed=true`, else
 * a no-found shape.
 *
 * @param fixture - Per-bank inline fixture.
 * @returns Mediator stub.
 */
function makeFixtureMediator(fixture: IBankFixture): IElementMediator {
  const cookieSnapshots = buildCookieSnapshots(fixture.cookieNames);
  const fetchOpts: IFetchOpts = { extraHeaders: fixture.headers };
  const stub = assembleMediatorStub({ cookieSnapshots, fixture, fetchOpts });
  return stub as unknown as IElementMediator;
}

/**
 * Execute one AUTH-DISCOVERY phase step and assert the result was Ok.
 * Centralises the isOk + ok-expect + Ok-unwrap pattern so the chain
 * orchestrator stays within the test-helper statement cap.
 * @param label - Phase step label ('PRE' | 'POST' | 'FINAL') for jest output.
 * @param result - Procedure returned by the phase executor.
 * @param fallback - Context to return when result wasn't Ok (unreachable
 * in green path; satisfies type narrowing).
 * @returns Unwrapped context.
 */
function expectOkAndUnwrap(
  label: string,
  result: Awaited<ReturnType<typeof executeAuthDiscoveryPre>>,
  fallback: IPipelineContext,
): IPipelineContext {
  const isStepOk = isOk(result);
  // jest's expect carries the label in the diff so the failing phase is obvious.
  expect({ label, isOk: isStepOk }).toEqual({ label, isOk: true });
  return result.success ? result.value : fallback;
}

/**
 * Build the initial AUTH-DISCOVERY pipeline context wired to the
 * fixture mediator. Extracted per §19.10 so runAuthDiscoveryChain
 * stays ≤10 lines.
 * @param fixture - Per-bank fixture.
 * @returns Pipeline context with the mediator option populated.
 */
function buildAuthDiscoveryCtx(fixture: IBankFixture): IPipelineContext {
  const baseCtx = makeMockContext();
  const mediator = makeFixtureMediator(fixture);
  return { ...baseCtx, mediator: { has: true, value: mediator } };
}

/**
 * Run AUTH-DISCOVERY's full PRE → POST → FINAL chain against a
 * per-bank fixture and return the resulting context.
 * @param fixture - Per-bank fixture.
 * @returns Final pipeline context after FINAL.
 */
async function runAuthDiscoveryChain(fixture: IBankFixture): Promise<IPipelineContext> {
  const ctx = buildAuthDiscoveryCtx(fixture);
  const preResult = await executeAuthDiscoveryPre(ctx);
  const preCtx = expectOkAndUnwrap('PRE', preResult, ctx);
  const postResult = await executeAuthDiscoveryPost(preCtx);
  const postCtx = expectOkAndUnwrap('POST', postResult, ctx);
  const finalResult = await executeAuthDiscoveryFinal(postCtx);
  return expectOkAndUnwrap('FINAL', finalResult, ctx);
}

describe('Mission 1 — AuthDiscoveryFactoryTest cross-bank coverage', () => {
  it('every browser-flow bank ships an M1 fixture', () => {
    const fixtureBanks = BANK_FIXTURES.map((f): FixtureBank => f.bank);
    const banks = new Set(fixtureBanks);
    const required: readonly FixtureBank[] = [
      'discount',
      'hapoalim',
      'beinleumi',
      'max',
      'visacal',
      'amex',
      'isracard',
      'onezero',
      'massad',
      'otsarHahayal',
      'pagi',
      'mercantile',
    ];
    for (const bank of required) {
      const isPresent = banks.has(bank);
      expect(isPresent).toBe(true);
    }
  });

  describe.each(BANK_FIXTURES)('$bank', fixture => {
    it('emits ctx.authDiscovery with non-empty session cookie names', async () => {
      const ctx = await runAuthDiscoveryChain(fixture);
      expect(ctx.authDiscovery.has).toBe(true);
      if (ctx.authDiscovery.has) {
        expect(ctx.authDiscovery.value.sessionCookieNames).toHaveLength(fixture.cookieNames.length);
      }
    });

    it('emits the fixture authToken / origin / siteId verbatim onto the slim shape', async () => {
      const ctx = await runAuthDiscoveryChain(fixture);
      expect(ctx.authDiscovery.has).toBe(true);
      if (ctx.authDiscovery.has) {
        const snap = ctx.authDiscovery.value;
        expect(snap.authToken).toBe(fixture.authToken);
        expect(snap.origin).toBe(fixture.origin);
        expect(snap.siteId).toBe(fixture.siteId);
      }
    });

    it('emits dashboardReady=true when the reveal probe finds a marker', async () => {
      const ctx = await runAuthDiscoveryChain(fixture);
      expect(ctx.authDiscovery.has).toBe(true);
      if (ctx.authDiscovery.has) {
        expect(ctx.authDiscovery.value.dashboardReady).toBe(fixture.dashboardRevealed);
      }
    });

    it('preserves the discovered fetch headers on the slim shape', async () => {
      const ctx = await runAuthDiscoveryChain(fixture);
      expect(ctx.authDiscovery.has).toBe(true);
      if (ctx.authDiscovery.has) {
        expect(ctx.authDiscovery.value.headers).toEqual(fixture.headers);
      }
    });
  });
});

describe('Mission 1 — AUTH-DISCOVERY fail-loud (single fail-code in M1)', () => {
  it('POST fails AUTH_DISCOVERY_SESSION_INVALID when cookies=0', async () => {
    const fixture: IBankFixture = {
      bank: 'discount',
      cookieNames: [],
      authToken: false,
      origin: 'https://www.discountbank.co.il',
      siteId: false,
      headers: {},
      dashboardRevealed: true,
    };
    const baseCtx = makeMockContext();
    const mediator = makeFixtureMediator(fixture);
    const ctx: IPipelineContext = {
      ...baseCtx,
      mediator: { has: true, value: mediator },
    };
    const result = await executeAuthDiscoveryPost(ctx);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain('AUTH_DISCOVERY_SESSION_INVALID');
    }
  });

  it('POST passes through when no mediator (test paths)', async () => {
    const baseCtx = makeMockContext();
    const result = await executeAuthDiscoveryPost(baseCtx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
  });

  it('PRE passes through when no mediator', async () => {
    const baseCtx = makeMockContext();
    const result = await executeAuthDiscoveryPre(baseCtx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
  });

  it('FINAL passes through when authDiscovery is none', async () => {
    const baseCtx = makeMockContext();
    const result = await executeAuthDiscoveryFinal(baseCtx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
  });
});
