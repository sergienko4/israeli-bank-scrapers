/**
 * Failing tests reproducing the four defects observed in the
 * 2026-05-06 live E2E run, derived from captured network traces in
 * `c:/tmp/runs/pipeline/<bank>/06-05-2026_17163537..41/`. Each
 * fixture is synthetic (no PII) but mirrors the exact body / URL /
 * method shape that broke the live run.
 *
 * Defects:
 *   A — `hasNamedContainer` is case-sensitive. Discount's
 *       `UserAccounts` (Pascal) is rejected by `accounts` (lower).
 *   B — `verifyPreNavReadiness` walks every pre-nav body via
 *       `.some(extractAccountRecords)`. Max's Lottie animation JSON
 *       has deep nesting; the recursive `bfsAccumulate` blows the
 *       Node stack. The auth FINAL throws "Maximum call stack size
 *       exceeded" instead of returning success/skip.
 *   C — Hapoalim never fires a `getAccounts` API; the accountId is
 *       in URL query parameters of every GET capture. The current
 *       discoverer only inspects `responseBody`, so it returns no
 *       account. C-POST: a parallel case for POST captures whose
 *       request `postData` carries the identifier.
 *   D1 — STRICT post-nav-only txn discovery: when post-nav has no
 *       WK-txn match, `discoverTransactionsEndpoint` MUST return
 *       false (no fallback). Confirms the strict gate stays.
 */

import { discoverAccountsInPool } from '../../../../Scrapers/Pipeline/Mediator/Auth/AccountDiscovery.js';
import executeLoginSignal from '../../../../Scrapers/Pipeline/Mediator/Auth/LoginSignalProbe.js';
import { verifyPreNavReadiness } from '../../../../Scrapers/Pipeline/Mediator/Auth/PreNavReadiness.js';
import { createFrozenNetwork } from '../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscovery.js';
import type { IDiscoveredEndpoint } from '../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscoveryTypes.js';
import { executeFillFinal } from '../../../../Scrapers/Pipeline/Mediator/OtpFill/OtpFillPhaseActions.js';
import { PIPELINE_WELL_KNOWN_API } from '../../../../Scrapers/Pipeline/Registry/WK/ScrapeWK.js';
import { some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import { isOk } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from '../Infrastructure/MockFactories.js';

/** Common shape for the auth-FINAL test contexts — both
 *  `executeLoginSignal` and `executeFillFinal` accept the same
 *  `IPipelineContext` shape; aliasing here lets tests skip the noisy
 *  `Parameters<typeof fn>[0]` cast inline (no nested-call lint error).
 */
type IPipelineCtxLike = Parameters<typeof executeLoginSignal>[0];

/** Args bundle for `makeCapture` — keeps the helper inside the param budget. */
interface IMakeCaptureArgs {
  readonly url: string;
  readonly method: 'GET' | 'POST';
  readonly responseBody: unknown;
  readonly postData?: string;
  readonly timestamp?: number;
}

/**
 * Build a synthetic capture endpoint.
 * @param args - Capture args.
 * @returns Synthetic endpoint.
 */
function makeCapture(args: IMakeCaptureArgs): IDiscoveredEndpoint {
  return {
    url: args.url,
    method: args.method,
    postData: args.postData ?? '',
    responseBody: args.responseBody,
    contentType: 'application/json',
    requestHeaders: {},
    responseHeaders: {},
    timestamp: args.timestamp ?? 0,
  };
}

describe('Defect A — case-insensitive suffix container match (no over-match)', () => {
  it('does NOT match `accountSettings` as `accounts` (substring would, suffix must not)', () => {
    // Self-validation guard: the original substring approach falsely
    // flagged `accountSettings` because `accountsettings`.includes
    // (`accounts`) is true. Suffix-only matching rejects this.
    const overMatch = makeCapture({
      url: 'https://x.example/api/settings',
      method: 'GET',
      responseBody: {
        accountSettings: [{ themePref: 'dark' }, { language: 'he' }],
      },
      timestamp: 50,
    });
    const result = discoverAccountsInPool([overMatch]);
    expect(result.endpoint).toBe(false);
  });

  it('still matches PascalCase suffix variants (`MyCards`, `customerCards`)', () => {
    const camelMatch = makeCapture({
      url: 'https://x.example/api/customer',
      method: 'GET',
      responseBody: { customerCards: [{ cardUniqueId: 'CC-1' }] },
      timestamp: 50,
    });
    const result = discoverAccountsInPool([camelMatch]);
    expect(result.endpoint).not.toBe(false);
    expect(result.ids).toContain('CC-1');
  });

  it('discount: discoverAccountsInPool finds account when container key is PascalCase `UserAccounts`', () => {
    // Verbatim shape of Discount's
    // /Titan/gatewayAPI/userAccountsData?FetchAccountsNickName=true
    // capture (synthetic IDs).
    const ep = makeCapture({
      url: 'https://start.telebank.example/Titan/gatewayAPI/userAccountsData',
      method: 'GET',
      responseBody: {
        UserAccountsData: {
          IdentityType: '1',
          UserAccounts: [
            {
              NewAccountInfo: { BankID: '0011', BranchID: '0219', AccountID: 'fake-acct-A' },
              AccountInfo: { BankID: '0', BranchID: '535', AccountID: 'fake-internal' },
              AccountName: 'Synthetic Test Account',
              FormatAccountID: '99-999-FAKE-A',
            },
          ],
          DefaultAccountNumber: '99-999-FAKE-A',
        },
      },
    });
    const result = discoverAccountsInPool([ep]);
    expect(result.endpoint).not.toBe(false);
    expect(result.ids.length).toBeGreaterThan(0);
  });
});

/**
 * Build a synthetic body with massive breadth — `drainLifoStack`
 * (LIFO traversal in `findFirstArray`) recurses once per stack
 * entry. ~60k items = ~60k recursion frames. Comfortably blows
 * Node's default ~10–15k stack frame budget. Mirrors the ratio of
 * Max's real Lottie animation JSON.
 * @returns Synthetic adversarial body.
 */
function buildHighBreadthBody(): Record<string, unknown> {
  const innerCount = 200;
  const outerCount = 300;
  const layers = Array.from({ length: outerCount }, (_unused, i) => ({
    ind: i,
    ty: 'shape',
    shapes: Array.from({ length: innerCount }, (_inner, j) => ({
      ind: j,
      ty: 'gr',
      ks: { o: { a: 0, k: 100 } },
    })),
  }));
  return { v: '5.9.0', fr: 25, ip: 0, op: 50, nm: 'CARDS', layers };
}

describe('Defect B — recursive walker must not crash on adversarial pre-nav body', () => {
  it('verifyPreNavReadiness does NOT throw on a Lottie-shaped pre-nav body', () => {
    const lottie = makeCapture({
      url: 'https://www.max.example/animations/cards.lottie.json',
      method: 'GET',
      responseBody: buildHighBreadthBody(),
      timestamp: 50,
    });
    const account = makeCapture({
      url: 'https://www.max.example/api/registered/getRegisterUserData',
      method: 'GET',
      responseBody: { cards: [{ cardUniqueId: 'fake-card-1' }] },
      timestamp: 100,
    });
    const network = createFrozenNetwork([lottie, account], false, 200);
    const baseCtx = makeMockContext();
    const ctx = {
      ...baseCtx,
      mediator: { has: true, value: { network } },
    } as unknown as ReturnType<typeof makeMockContext>;
    let didThrow = false;
    let result;
    try {
      result = verifyPreNavReadiness(ctx, 'LOGIN');
    } catch {
      didThrow = true;
    }
    expect(didThrow).toBe(false);
    if (result) {
      const isResultOk = isOk(result);
      expect(isResultOk).toBe(true);
    }
  });
});

describe('Defect C — request-side identifier extraction (method-specific)', () => {
  it('hapoalim: discoverAccountsInPool extracts accountId from GET URL query when no body container', () => {
    // Hapoalim's captures: every URL has `?accountId=12-170-FAKE-1`,
    // body has no `accounts` / `cards` / `bankAccounts` container,
    // body is not a root-array. The discoverer must inspect the URL
    // query (GET-only path) and surface the accountId.
    const ep = makeCapture({
      url: 'https://login.bankhapoalim.example/ServerServices/general/parties/basic?accountId=12-170-FAKE-1&view=totals&lang=he',
      method: 'GET',
      responseBody: {
        partySerialId: 4_678_873,
        bankNumber: 12,
        partyId: 'fake-party-id',
        partyShortId: 314_076_571,
        partyFullName: 'Synthetic Test',
        manyAccounts: false,
      },
    });
    const result = discoverAccountsInPool([ep]);
    expect(result.endpoint).not.toBe(false);
    expect(result.ids).toContain('12-170-FAKE-1');
  });

  it('post-only: discoverAccountsInPool extracts accountId from POST postData when no body container', () => {
    // Synthetic POST capture where the request postData carries the
    // identifier (a known WK queryId field) and the response body
    // does not expose any account container.
    const ep = makeCapture({
      url: 'https://api.cal-online.example/Account/AccountsRefresh',
      method: 'POST',
      responseBody: { metadata: {}, status: 'ok' },
      postData: '{"cardUniqueId":"fake-cal-card-1","extra":"meta"}',
    });
    const result = discoverAccountsInPool([ep]);
    expect(result.endpoint).not.toBe(false);
    expect(result.ids).toContain('fake-cal-card-1');
  });
});

/** Args for the wait-tracking mediator stub used by the late-capture tests. */
interface IWaitMediatorArgs {
  /** Captures available BEFORE waitForTraffic resolves. */
  readonly preWaitCaptures: readonly IDiscoveredEndpoint[];
  /** Captures available AFTER waitForTraffic resolves (simulates late arrival). */
  readonly postWaitCaptures: readonly IDiscoveredEndpoint[];
  /** Tracker the test uses to assert order of calls. */
  readonly callLog: string[];
}

/**
 * Build a stub mediator whose `waitForTraffic` flips the captures
 * pool from `preWaitCaptures` (initial) to `postWaitCaptures` (after
 * the wait resolves). Lets the test assert that discovery sees the
 * LATE arrivals only when called AFTER the wait.
 * @param args - Wait stub args.
 * @returns Mediator-shaped stub.
 */
function makeWaitMediator(args: IWaitMediatorArgs): unknown {
  let captures: readonly IDiscoveredEndpoint[] = args.preWaitCaptures;
  return {
    /**
     * No-op idle wait for the cookie audit step.
     * @returns Resolved succeed.
     */
    waitForNetworkIdle: (): Promise<{ success: true; value: boolean }> =>
      Promise.resolve({ success: true, value: true }),
    /**
     * Single-cookie stub so cookieCount > 0 (auth gate passes).
     * @returns Mock cookie list.
     */
    getCookies: (): Promise<readonly { name: string; domain: string; value: string }[]> =>
      Promise.resolve([{ name: 'SID', domain: 'bank.example', value: 'x' }]),
    /**
     * URL stub used in diagnostics.
     * @returns Mock dashboard URL.
     */
    getCurrentUrl: (): string => 'https://bank.example/dashboard',
    /**
     * Stub for `probeDashboardReveal` — returns not-visible.
     * @returns Resolved false.
     */
    resolveVisible: (): Promise<false> => Promise.resolve(false),
    network: {
      /**
       * Flips the captures pool from `preWaitCaptures` to
       * `postWaitCaptures` so subsequent `getPreNavCaptures` calls
       * see the LATE arrival.
       * @returns First post-wait capture or false.
       */
      waitForTraffic: (): Promise<IDiscoveredEndpoint | false> => {
        args.callLog.push('waitForTraffic');
        captures = args.postWaitCaptures;
        return Promise.resolve(args.postWaitCaptures[0] ?? false);
      },
      /**
       * Returns the current pool — pre-wait initially, post-wait
       * after `waitForTraffic` resolves.
       * @returns Current captures.
       */
      getPreNavCaptures: (): readonly IDiscoveredEndpoint[] => {
        const length = String(captures.length);
        args.callLog.push(`getPreNavCaptures(${length})`);
        return captures;
      },
      /**
       * Mirror of `getPreNavCaptures` for the readiness fallback.
       * @returns Current captures.
       */
      getAllEndpoints: (): readonly IDiscoveredEndpoint[] => captures,
      /**
       * Stub auth discovery — never finds a token.
       * @returns Resolved false.
       */
      discoverAuthToken: (): Promise<string | false> => Promise.resolve(false),
    },
  };
}

describe('Pattern 1 — auth FINAL waits for account-shape capture before discovery', () => {
  /**
   * Builds a synthetic Isracard-style account capture (cardsList).
   * @returns Late-arriving account capture.
   */
  function makeIsracardCardsCapture(): IDiscoveredEndpoint {
    return makeCapture({
      url: 'https://web.isracard.example/ocp/statuspage/DigitalV3.StatusPage/GetCardList',
      method: 'POST',
      responseBody: {
        data: {
          cardsList: [
            { cardSuffix: '0786', accountNumber: '203489', cardGuid: 'g1' },
            { cardSuffix: '1314', accountNumber: '228812', cardGuid: 'g2' },
          ],
        },
      },
      postData: '{"companyCode":"99","cardSuffixLength":4}',
      timestamp: 100,
    });
  }

  it('LOGIN.FINAL — waits for WK accounts traffic when phase==="login", then discovers', async () => {
    const callLog: string[] = [];
    const lateAccountCapture = makeIsracardCardsCapture();
    const mediator = makeWaitMediator({
      preWaitCaptures: [],
      postWaitCaptures: [lateAccountCapture],
      callLog,
    });
    const baseCtx = makeMockContext();
    const ctx = {
      ...baseCtx,
      login: some({}),
      mediator: { has: true, value: mediator },
      accountDiscoveryAt: 'login',
    } as unknown as IPipelineCtxLike;
    const result = await executeLoginSignal(ctx);
    const isResultOk = isOk(result);
    expect(isResultOk).toBe(true);
    // waitForTraffic must be called BEFORE getPreNavCaptures returns >0
    const waitIdx = callLog.indexOf('waitForTraffic');
    expect(waitIdx).toBeGreaterThanOrEqual(0);
    if (isResultOk) {
      expect(result.value.accountDiscovery.has).toBe(true);
      if (result.value.accountDiscovery.has) {
        expect(result.value.accountDiscovery.value.ids.length).toBeGreaterThan(0);
      }
    }
  });

  it('LOGIN.FINAL — skips wait + discovery when phase==="otp-fill" (OTP banks defer to OTP-FILL)', async () => {
    const callLog: string[] = [];
    const mediator = makeWaitMediator({
      preWaitCaptures: [],
      postWaitCaptures: [makeIsracardCardsCapture()],
      callLog,
    });
    const baseCtx = makeMockContext();
    const ctx = {
      ...baseCtx,
      login: some({}),
      mediator: { has: true, value: mediator },
      accountDiscoveryAt: 'otp-fill',
    } as unknown as IPipelineCtxLike;
    const result = await executeLoginSignal(ctx);
    const isResultOk = isOk(result);
    expect(isResultOk).toBe(true);
    // Critical: NO waitForTraffic call (single-wait contract for OTP banks)
    expect(callLog).not.toContain('waitForTraffic');
  });

  it('OTP-FILL.FINAL — waits + discovers when phase==="otp-fill"', async () => {
    const callLog: string[] = [];
    const lateAccountCapture = makeIsracardCardsCapture();
    const mediator = makeWaitMediator({
      preWaitCaptures: [],
      postWaitCaptures: [lateAccountCapture],
      callLog,
    });
    const baseCtx = makeMockContext();
    const ctx = {
      ...baseCtx,
      mediator: { has: true, value: mediator },
      accountDiscoveryAt: 'otp-fill',
    } as unknown as IPipelineCtxLike;
    const result = await executeFillFinal(ctx);
    const isResultOk = isOk(result);
    expect(isResultOk).toBe(true);
    expect(callLog).toContain('waitForTraffic');
    if (isResultOk) {
      expect(result.value.accountDiscovery.has).toBe(true);
      if (result.value.accountDiscovery.has) {
        expect(result.value.accountDiscovery.value.ids.length).toBeGreaterThan(0);
      }
    }
  });

  it('OTP-FILL.FINAL — skips wait + discovery when phase==="login" (defensive)', async () => {
    const callLog: string[] = [];
    const mediator = makeWaitMediator({
      preWaitCaptures: [],
      postWaitCaptures: [makeIsracardCardsCapture()],
      callLog,
    });
    const baseCtx = makeMockContext();
    const ctx = {
      ...baseCtx,
      mediator: { has: true, value: mediator },
      accountDiscoveryAt: 'login',
    } as unknown as IPipelineCtxLike;
    const result = await executeFillFinal(ctx);
    const isResultOk = isOk(result);
    expect(isResultOk).toBe(true);
    expect(callLog).not.toContain('waitForTraffic');
  });

  it('WK.accounts patterns are the canonical wait signal (sanity)', () => {
    expect(PIPELINE_WELL_KNOWN_API.accounts.length).toBeGreaterThan(0);
  });
});

describe('Defect D1 — strict post-nav-only txn discovery (no fallback)', () => {
  it('discoverTransactionsEndpoint returns false when post-nav has no WK-txn match', () => {
    // VisaCal-shape: pre-nav contains a WK-txn match (filteredTransactions),
    // post-nav has none. Strict gate: picker MUST return false.
    // Pre-nav fallback would mask a broken click — D1 says fail loud.
    const preNavTxn = makeCapture({
      url: 'https://api.cal-online.example/Transactions/api/filteredTransactions/getFilteredTransactions',
      method: 'POST',
      responseBody: { transactions: [{ id: 1 }] },
      postData: '{}',
      timestamp: 100,
    });
    const postNavNoise = makeCapture({
      url: 'https://api.cal-online.example/some-noise',
      method: 'GET',
      responseBody: { ok: true },
      timestamp: 500,
    });
    const network = createFrozenNetwork([preNavTxn, postNavNoise], false, 200);
    const picked = network.discoverTransactionsEndpoint();
    expect(picked).toBe(false);
  });
});
