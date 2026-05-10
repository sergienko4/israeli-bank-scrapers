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
  const cookieSnapshots: readonly ICookieSnapshot[] = fixture.cookieNames.map(
    (name): ICookieSnapshot =>
      ({
        name,
        value: 'redacted',
        domain: 'example.bank',
        path: '/',
        expires: -1,
        httpOnly: true,
        secure: true,
        sameSite: 'None',
      }) as ICookieSnapshot,
  );
  const fetchOpts: IFetchOpts = { extraHeaders: fixture.headers };
  return {
    /**
     * Return the fixture cookies.
     * @returns Cookie snapshots.
     */
    getCookies: (): Promise<readonly ICookieSnapshot[]> => Promise.resolve(cookieSnapshots),
    /**
     * Reveal probe — returns a found result with a synthetic
     * dashboard candidate when `dashboardRevealed=true`, else a
     * not-found shape (probeDashboardReveal returns 'no reveal'
     * for the not-found case).
     * @returns Resolve-visible result.
     */
    resolveVisible: (): Promise<unknown> => {
      if (!fixture.dashboardRevealed) {
        return Promise.resolve({ found: false, candidate: false });
      }
      return Promise.resolve({
        found: true,
        candidate: { kind: 'textContent', value: 'יתרה' },
      });
    },
    network: {
      /**
       * Empty endpoint pool — PRE counts captures only.
       * @returns Empty array.
       */
      getAllEndpoints: (): readonly [] => [],
      /**
       * Fixture-scoped auth-token discovery stub.
       * @returns Fixture token (string | false).
       */
      discoverAuthToken: (): Promise<string | false> => Promise.resolve(fixture.authToken),
      /**
       * Fixture-scoped origin discovery stub.
       * @returns Fixture origin (string | false).
       */
      discoverOrigin: (): string | false => fixture.origin,
      /**
       * Fixture-scoped site-id discovery stub.
       * @returns Fixture siteId (string | false).
       */
      discoverSiteId: (): string | false => fixture.siteId,
      /**
       * Fixture-scoped fetch-header builder stub.
       * @returns Fixture headers wrapped in IFetchOpts.
       */
      buildDiscoveredHeaders: (): Promise<IFetchOpts> => Promise.resolve(fetchOpts),
    },
    /**
     * No-op settle wait — AUTH-DISCOVERY.PRE awaits this before
     * inventorying the capture pool. Resolves immediately so the
     * factory test does not pay a real timer in unit-test land.
     * @returns Resolved succeed.
     */
    waitForNetworkIdle: () => Promise.resolve({ success: true as const, value: undefined }),
  } as unknown as IElementMediator;
}

/**
 * Run AUTH-DISCOVERY's full PRE → POST → FINAL chain against a
 * per-bank fixture and return the resulting context.
 * @param fixture - Per-bank fixture.
 * @returns Final pipeline context after FINAL.
 */
async function runAuthDiscoveryChain(fixture: IBankFixture): Promise<IPipelineContext> {
  const baseCtx = makeMockContext();
  const mediator = makeFixtureMediator(fixture);
  const ctx: IPipelineContext = {
    ...baseCtx,
    mediator: { has: true, value: mediator },
  };
  const preResult = await executeAuthDiscoveryPre(ctx);
  const isPreOk = isOk(preResult);
  expect(isPreOk).toBe(true);
  const preCtx = preResult.success ? preResult.value : ctx;
  const postResult = await executeAuthDiscoveryPost(preCtx);
  const isPostOk = isOk(postResult);
  expect(isPostOk).toBe(true);
  const postCtx = postResult.success ? postResult.value : ctx;
  const finalResult = await executeAuthDiscoveryFinal(postCtx);
  const isFinalOk = isOk(finalResult);
  expect(isFinalOk).toBe(true);
  return finalResult.success ? finalResult.value : ctx;
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
        expect(ctx.authDiscovery.value.sessionCookieNames.length).toBe(fixture.cookieNames.length);
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
