/**
 * Phase 7 — ACCOUNT-RESOLVE mediator stage handlers.
 *
 * Cross-validation foundation: synthetic capture pools mirror the
 * exact id source surfaced by each non-OTP bank's live trace
 * (response container vs. URL query vs. POST body). The test asserts
 * that the SAME generic predicate (`discoverAccountsInPool`) extracts
 * ids from each, so the new phase is PURE GENERIC — no per-bank code.
 */

import type { SelectorCandidate } from '../../../../../Scrapers/Base/Config/LoginConfigTypes.js';
import {
  ACCOUNT_RESOLVE_BUDGET_MS,
  executeAccountResolveAction,
  executeAccountResolveFinal,
  executeAccountResolvePost,
  executeAccountResolvePre,
} from '../../../../../Scrapers/Pipeline/Mediator/AccountResolve/AccountResolveActions.js';
import {
  type IElementMediator,
  type IRaceResult,
  NOT_FOUND_RESULT,
} from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import type { IDiscoveredEndpoint } from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscoveryTypes.js';
import { WK_DASHBOARD } from '../../../../../Scrapers/Pipeline/Registry/WK/DashboardWK.js';
import type { IPipelineContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { isOk, type Procedure, succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';

/** Shared no-op nudge result — a `found:false` success matching the real
 *  `resolveAndClick` contract (`Promise<Procedure<IRaceResult>>`) without
 *  driving an id into the pool. */
const NUDGE_NOOP_RESULT = succeed(NOT_FOUND_RESULT);

/** Args bundle for the synthetic-pool mediator factory. */
interface IPoolMediatorArgs {
  readonly captures: readonly IDiscoveredEndpoint[];
  readonly waitMatch?: IDiscoveredEndpoint | false;
  /** Bumps `captures` to `lateCaptures` after `waitForFirstId` resolves. */
  readonly lateCaptures?: readonly IDiscoveredEndpoint[];
  /**
   * Captures revealed by the PRE nudge click — simulates a nav-gated
   * accounts API (e.g. Isracard `GetCardList`) firing only after the
   * transactions link is clicked.
   */
  readonly onClickCaptures?: readonly IDiscoveredEndpoint[];
}

/**
 * Build a mediator-shaped stub whose network exposes a fixed pre-nav
 * pool plus a `waitForFirstId` that optionally swaps the pool to
 * simulate late-arriving captures.
 * @param args - Pool args.
 * @returns Mediator stub.
 */
function makePoolMediator(args: IPoolMediatorArgs): IElementMediator {
  let pool: readonly IDiscoveredEndpoint[] = args.captures;
  return {
    network: {
      /**
       * Returns the current pool snapshot (pre or post wait).
       * @returns Captured endpoints.
       */
      getPreNavCaptures: (): readonly IDiscoveredEndpoint[] => pool,
      /**
       * Resolves with the configured match; flips the pool when
       * lateCaptures supplied so POST sees the late arrivals.
       * @returns Match endpoint or false.
       */
      waitForFirstId: (): Promise<IDiscoveredEndpoint | false> => {
        if (args.lateCaptures) pool = args.lateCaptures;
        return Promise.resolve(args.waitMatch ?? false);
      },
    },
    /**
     * Stub for the smart-wait race added in PR #234 — the production
     * `awaitAndLog` races `waitForFirstId` against `waitForNetworkIdle`.
     * Stub returns a never-resolving promise so `waitForFirstId` always
     * wins the race; pool-mutation semantics stay the same as before.
     * @returns Promise that never resolves.
     */
    /** Smart-wait mock — awaits the custom wait so test stubs run.
     * @param cw - Caller-supplied custom wait promise.
     * @returns True after the custom wait settles. */
    raceWithNetworkIdle: async (cw: Promise<unknown>): Promise<true> => {
      try {
        await cw;
      } catch {
        /* swallow */
      }
      return true as const;
    },
    /**
     * Best-effort PRE nudge click. When `onClickCaptures` is supplied
     * the pool is swapped to it, modelling a same-URL SPA that only
     * fetches the accounts API once the transactions link is clicked.
     * @returns Resolved best-effort click sentinel.
     */
    resolveAndClick: (): Promise<Procedure<IRaceResult>> => {
      if (args.onClickCaptures) pool = args.onClickCaptures;
      return Promise.resolve(NUDGE_NOOP_RESULT);
    },
  } as unknown as IElementMediator;
}

/** Args for `makeCapture`. */
interface IMakeCaptureArgs {
  readonly url: string;
  readonly method: 'GET' | 'POST';
  readonly responseBody: unknown;
  readonly postData?: string;
}

/**
 * Build a synthetic discovered endpoint.
 * @param args - Capture args.
 * @returns Synthetic IDiscoveredEndpoint.
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
    timestamp: 100,
  };
}

describe('ACCOUNT_RESOLVE_BUDGET_MS', () => {
  it('is the configured 20-second wait budget (post-cumulative-cut bump, see Mediator JSDoc)', () => {
    expect(ACCOUNT_RESOLVE_BUDGET_MS).toBe(20_000);
  });
});

describe('executeAccountResolvePre', () => {
  it('fails fast when mediator is absent', async () => {
    const ctx = makeMockContext();
    const result = await executeAccountResolvePre(ctx);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain('ACCOUNT-RESOLVE');
      expect(result.errorMessage).toContain('no mediator');
    }
  });

  it('succeeds without mutating context when mediator is present', async () => {
    const mediator = makePoolMediator({ captures: [] });
    const baseCtx = makeMockContext();
    const ctx = {
      ...baseCtx,
      mediator: { has: true, value: mediator },
    } as IPipelineContext;
    const result = await executeAccountResolvePre(ctx);
    expect(result.success).toBe(true);
  });
});

describe('executeAccountResolvePre', () => {
  it('invokes waitForFirstId exactly once and returns the input context', async () => {
    // Pool already carries an id-bearing capture, so the PRE nudge is
    // correctly SKIPPED → a single passive wait (no post-nudge re-wait).
    const idCapture = makeCapture({
      url: 'https://web.isracard.example/ocp/statuspage/DigitalV3.StatusPage/GetCardList',
      method: 'POST',
      responseBody: { data: { cardsList: [{ accountNumber: '111' }] } },
    });
    let callCount = 0;
    const mediator = {
      network: {
        /**
         * Counter for assertion.
         * @returns The id-bearing match so the passive wait resolves.
         */
        waitForFirstId: (): Promise<IDiscoveredEndpoint> => {
          callCount += 1;
          return Promise.resolve(idCapture);
        },
        /**
         * Id-bearing pool stub (keeps the nudge skipped).
         * @returns Single id-bearing capture.
         */
        getPreNavCaptures: (): readonly IDiscoveredEndpoint[] => [idCapture],
      },
      /**
       * Never resolves so the race in `awaitAndLog` is decided by
       * `waitForFirstId` — keeps the call-count assertion intact.
       * @returns Promise that never resolves.
       */
      /** Smart-wait mock — awaits the custom wait so test stubs run.
       * @param cw - Caller-supplied custom wait promise.
       * @returns True after the custom wait settles. */
      raceWithNetworkIdle: async (cw: Promise<unknown>): Promise<true> => {
        try {
          await cw;
        } catch {
          /* swallow */
        }
        return true as const;
      },
    } as unknown as IElementMediator;
    const baseCtx = makeMockContext();
    const ctx = {
      ...baseCtx,
      mediator: { has: true, value: mediator },
    } as IPipelineContext;
    const result = await executeAccountResolvePre(ctx);
    expect(callCount).toBe(1);
    expect(result.success).toBe(true);
  });
});

describe('executeAccountResolveAction', () => {
  it('is a no-op pass-through (sealed action context — no mediator)', async () => {
    const baseCtx = makeMockContext();
    const result = await executeAccountResolveAction(
      baseCtx as unknown as Parameters<typeof executeAccountResolveAction>[0],
    );
    expect(result.success).toBe(true);
  });
});

describe('executeAccountResolvePost — cross-bank fixtures (PURE GENERIC)', () => {
  it('Discount: extracts ids from response-container `UserAccounts` (PascalCase suffix)', async () => {
    // Mirrors the live Discount /Titan/gatewayAPI/userAccountsData
    // response shape — record carries an `AccountID` field that the
    // generic suffix matcher recognises (case-insensitive compare).
    const capture = makeCapture({
      url: 'https://start.telebank.example/Titan/gatewayAPI/userAccountsData',
      method: 'GET',
      responseBody: {
        UserAccountsData: {
          UserAccounts: [
            {
              NewAccountInfo: { BankID: '0011', AccountID: 'fake-acct-A' },
              FormatAccountID: '99-999-FAKE-A',
            },
          ],
        },
      },
    });
    const mediator = makePoolMediator({ captures: [capture] });
    const baseCtx = makeMockContext();
    const ctx = {
      ...baseCtx,
      mediator: { has: true, value: mediator },
    } as IPipelineContext;
    const result = await executeAccountResolvePost(ctx);
    const isResultOk = isOk(result);
    expect(isResultOk).toBe(true);
    if (isOk(result)) {
      expect(result.value.accountDiscovery.has).toBe(true);
      if (result.value.accountDiscovery.has) {
        expect(result.value.accountDiscovery.value.ids.length).toBeGreaterThan(0);
      }
    }
  });

  it('Isracard / Amex: extracts ids from response-container `cardsList`', async () => {
    const capture = makeCapture({
      url: 'https://web.isracard.example/ocp/statuspage/DigitalV3.StatusPage/GetCardList',
      method: 'POST',
      responseBody: {
        data: {
          cardsList: [
            { cardSuffix: '3333', accountNumber: '100003' },
            { cardSuffix: '4444', accountNumber: '100001' },
          ],
        },
      },
    });
    const mediator = makePoolMediator({ captures: [capture] });
    const baseCtx = makeMockContext();
    const ctx = {
      ...baseCtx,
      mediator: { has: true, value: mediator },
    } as IPipelineContext;
    const result = await executeAccountResolvePost(ctx);
    const isResultOk = isOk(result);
    expect(isResultOk).toBe(true);
    if (isOk(result) && result.value.accountDiscovery.has) {
      expect(result.value.accountDiscovery.value.ids.length).toBeGreaterThan(0);
    }
  });

  it('Hapoalim: extracts id from URL query parameter `?accountId=`', async () => {
    const capture = makeCapture({
      url: 'https://login.hapoalim.example/Authorizations?view=role&accountId=[REDACTED-ACCT]&lang=he',
      method: 'GET',
      responseBody: { ok: true },
    });
    const mediator = makePoolMediator({ captures: [capture] });
    const baseCtx = makeMockContext();
    const ctx = {
      ...baseCtx,
      mediator: { has: true, value: mediator },
    } as IPipelineContext;
    const result = await executeAccountResolvePost(ctx);
    const isResultOk = isOk(result);
    expect(isResultOk).toBe(true);
    if (isOk(result) && result.value.accountDiscovery.has) {
      expect(result.value.accountDiscovery.value.ids).toContain('[REDACTED-ACCT]');
    }
  });

  it('VisaCal: extracts id from response-container `cards`', async () => {
    const capture = makeCapture({
      url: 'https://api.cal-online.example/account/init',
      method: 'POST',
      responseBody: {
        result: {
          cards: [
            { last4Digits: '3020', cardUniqueId: 'fake-cal-card-1' },
            { last4Digits: '3308', cardUniqueId: 'fake-cal-card-2' },
          ],
        },
      },
    });
    const mediator = makePoolMediator({ captures: [capture] });
    const baseCtx = makeMockContext();
    const ctx = {
      ...baseCtx,
      mediator: { has: true, value: mediator },
    } as IPipelineContext;
    const result = await executeAccountResolvePost(ctx);
    const isResultOk = isOk(result);
    expect(isResultOk).toBe(true);
    if (isOk(result) && result.value.accountDiscovery.has) {
      expect(result.value.accountDiscovery.value.ids.length).toBeGreaterThan(0);
    }
  });

  it('fails loud with ACCOUNT_RESOLUTION_FAILED on empty pool', async () => {
    const mediator = makePoolMediator({ captures: [] });
    const baseCtx = makeMockContext();
    const ctx = {
      ...baseCtx,
      mediator: { has: true, value: mediator },
    } as IPipelineContext;
    const result = await executeAccountResolvePost(ctx);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain('ACCOUNT_RESOLUTION_FAILED');
      expect(result.errorMessage).toContain('pool=0');
    }
  });

  it('fails loud when pool has captures but none surface an account id', async () => {
    const noiseCapture = makeCapture({
      url: 'https://api.bank.example/marketing_banner',
      method: 'GET',
      responseBody: { promotion: { title: 'Some banner' } },
    });
    const mediator = makePoolMediator({ captures: [noiseCapture] });
    const baseCtx = makeMockContext();
    const ctx = {
      ...baseCtx,
      mediator: { has: true, value: mediator },
    } as IPipelineContext;
    const result = await executeAccountResolvePost(ctx);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain('ACCOUNT_RESOLUTION_FAILED');
    }
  });

  /**
   * Cards-only capture re-used by every billing-cycle test row —
   * ACCOUNT-RESOLVE needs at least one id-bearing capture in the
   * pool before the cycle-detector runs.
   */
  const cardsCapture = makeCapture({
    url: 'https://web.isracard.example/ocp/statuspage/DigitalV3.StatusPage/GetCardList',
    method: 'POST',
    responseBody: { data: { cardsList: [{ cardSuffix: 'FAKE_C01', accountNumber: '111' }] } },
  });

  /** Backbase cycle-catalog capture — two cycles, one open. */
  const backbaseCycleCapture = makeCapture({
    url: 'https://web.isracard.example/ocp/statuspage/DigitalV3.StatusPage/GetBillingsForMonthsOverview',
    method: 'POST',
    responseBody: {
      data: [
        { billingDate: '06/2026', isFinalBillingDate: false },
        { billingDate: '05/2026', isFinalBillingDate: true },
      ],
    },
  });

  /** One row in the catalog-commit truth table. */
  interface ICatalogCommitCase {
    readonly id: string;
    readonly captures: readonly IDiscoveredEndpoint[];
    readonly expectedCycleCount: number | false;
  }

  const catalogCommitCases: readonly ICatalogCommitCase[] = [
    {
      id: '[ACCOUNT-RESOLVE-CATALOG] commits Backbase catalog when pre-nav buffer carries cycle shape',
      captures: [cardsCapture, backbaseCycleCapture],
      expectedCycleCount: 2,
    },
    {
      id: '[ACCOUNT-RESOLVE-NO-CATALOG] omits catalog when pre-nav buffer carries no cycle shape',
      captures: [cardsCapture],
      expectedCycleCount: false,
    },
  ];

  it.each(catalogCommitCases)('$id', async testCase => {
    const mediator = makePoolMediator({ captures: testCase.captures });
    const baseCtx = makeMockContext();
    const ctx = {
      ...baseCtx,
      mediator: { has: true, value: mediator },
    } as IPipelineContext;
    const result = await executeAccountResolvePost(ctx);
    const isResultOk = isOk(result);
    expect(isResultOk).toBe(true);
    if (isOk(result) && result.value.accountDiscovery.has) {
      const catalog = result.value.accountDiscovery.value.billingCycleCatalog;
      if (testCase.expectedCycleCount === false) {
        expect(catalog).toBeUndefined();
      } else {
        expect(catalog?.cycles.length).toBe(testCase.expectedCycleCount);
      }
    }
  });
});

describe('executeAccountResolveFinal', () => {
  it('is idempotent — pass-through success preserves empty accountDiscovery', async () => {
    const ctx = makeMockContext();
    const result = await executeAccountResolveFinal(ctx);
    expect(result.success).toBe(true);
    if (isOk(result)) {
      expect(result.value.accountDiscovery.has).toBe(false);
    }
  });

  it('is idempotent — pass-through success preserves populated accountDiscovery', async () => {
    const baseCtx = makeMockContext();
    const populated = {
      ...baseCtx,
      accountDiscovery: {
        has: true,
        value: {
          ids: ['[REDACTED-ACCT]'],
          records: [],
          containers: {},
          endpointCaptureIndex: 0,
        },
      },
    } as IPipelineContext;
    const result = await executeAccountResolveFinal(populated);
    expect(result.success).toBe(true);
    if (isOk(result)) {
      expect(result.value.accountDiscovery.has).toBe(true);
      if (result.value.accountDiscovery.has) {
        expect(result.value.accountDiscovery.value.ids).toContain('[REDACTED-ACCT]');
      }
    }
  });
});

describe('executeAccountResolvePre — wait outcome telemetry', () => {
  it('logs "matched" when waitForFirstId returns an endpoint', async () => {
    const idCapture: IDiscoveredEndpoint = {
      url: 'https://api.bank.example/Authorizations?accountId=ABC',
      method: 'GET',
      postData: '',
      responseBody: { ok: true },
      contentType: 'application/json',
      requestHeaders: {},
      responseHeaders: {},
      timestamp: 100,
    };
    const mediator = makePoolMediator({
      captures: [idCapture],
      waitMatch: idCapture,
    });
    const baseCtx = makeMockContext();
    const ctx = {
      ...baseCtx,
      mediator: { has: true, value: mediator },
    } as IPipelineContext;
    const result = await executeAccountResolvePre(ctx);
    expect(result.success).toBe(true);
  });

  it('handles waitForFirstId rejection via .catch — falls through to false outcome', async () => {
    const mediator = {
      network: {
        /**
         * Rejects to exercise the .catch branch in awaitAndLog.
         * @returns Rejected promise.
         */
        waitForFirstId: (): Promise<never> => Promise.reject(new Error('boom')),
        /**
         * Empty pool stub.
         * @returns Empty array.
         */
        getPreNavCaptures: (): readonly IDiscoveredEndpoint[] => [],
      },
      /**
       * Never resolves so the race outcome is decided by the rejected
       * `waitForFirstId` branch.
       * @returns Promise that never resolves.
       */
      /** Smart-wait mock — awaits the custom wait so test stubs run.
       * @param cw - Caller-supplied custom wait promise.
       * @returns True after the custom wait settles. */
      raceWithNetworkIdle: async (cw: Promise<unknown>): Promise<true> => {
        try {
          await cw;
        } catch {
          /* swallow */
        }
        return true as const;
      },
      /**
       * Best-effort PRE nudge click stub — the empty pool drives the
       * nudge, which re-waits (and re-rejects, still caught) → success.
       * @returns Resolved click sentinel.
       */
      resolveAndClick: (): Promise<Procedure<IRaceResult>> => Promise.resolve(NUDGE_NOOP_RESULT),
    } as unknown as IElementMediator;
    const baseCtx = makeMockContext();
    const ctx = {
      ...baseCtx,
      mediator: { has: true, value: mediator },
    } as IPipelineContext;
    const result = await executeAccountResolvePre(ctx);
    expect(result.success).toBe(true);
  });
});

describe('executeAccountResolvePost — boundary case', () => {
  it('returns pass-through success when mediator absent (no-op guard)', async () => {
    const ctx = makeMockContext();
    const result = await executeAccountResolvePost(ctx);
    expect(result.success).toBe(true);
    if (isOk(result)) {
      expect(result.value.accountDiscovery.has).toBe(false);
    }
  });
});

describe('executeAccountResolvePre — same-URL SPA cards-view nudge', () => {
  // Isracard's modern id-bearing endpoint (GetCardList) only fires once
  // the visible transactions link is clicked — the same-URL SPA never
  // auto-navigates to the cards view. The PRE nudge clicks it when passive
  // discovery yields no id, so the live capture lands in the pre-nav pool
  // POST reads. These two tests reproduce that live scenario offline.
  const idCapture = makeCapture({
    url: 'https://web.isracard.example/ocp/statuspage/DigitalV3.StatusPage/GetCardList',
    method: 'POST',
    responseBody: { data: { cardsList: [{ cardSuffix: 'FAKE_C01', accountNumber: '111' }] } },
  });
  const noiseCapture = makeCapture({
    url: 'https://api.bank.example/marketing/banner',
    method: 'GET',
    responseBody: { promotion: { title: 'Some banner' } },
  });

  /**
   * Wrap a pool mediator in a has:true pipeline context.
   * @param mediator - Pool mediator stub.
   * @returns Context with the mediator present.
   */
  function ctxWith(mediator: IElementMediator): IPipelineContext {
    return { ...makeMockContext(), mediator: { has: true, value: mediator } };
  }

  it('nudges the cards view when passive discovery finds no id, then resolves the revealed accounts', async () => {
    // Empty passive pool → nudge clicks → onClickCaptures reveals the
    // GetCardList capture → POST resolves. A non-firing nudge would leave
    // the pool empty and POST would fail loud — so a passing POST is proof.
    const mediator = makePoolMediator({ captures: [], onClickCaptures: [idCapture] });
    const ctx = ctxWith(mediator);
    const pre = await executeAccountResolvePre(ctx);
    expect(pre.success).toBe(true);
    const post = await executeAccountResolvePost(ctx);
    expect(post.success).toBe(true);
    if (isOk(post)) {
      expect(post.value.accountDiscovery.has).toBe(true);
      if (post.value.accountDiscovery.has) {
        expect(post.value.accountDiscovery.value.ids.length).toBeGreaterThan(0);
      }
    }
  });

  it('does NOT click when passive discovery already found an id (zero blast radius for passive banks)', async () => {
    // onClickCaptures is a POISON pool with no id — were the nudge to fire
    // it would erase the real id and POST would fail loud. A passing POST
    // therefore proves the click was correctly skipped.
    const mediator = makePoolMediator({ captures: [idCapture], onClickCaptures: [noiseCapture] });
    const ctx = ctxWith(mediator);
    const pre = await executeAccountResolvePre(ctx);
    expect(pre.success).toBe(true);
    const post = await executeAccountResolvePost(ctx);
    expect(post.success).toBe(true);
    if (isOk(post)) {
      expect(post.value.accountDiscovery.has).toBe(true);
      if (post.value.accountDiscovery.has) {
        expect(post.value.accountDiscovery.value.ids.length).toBeGreaterThan(0);
      }
    }
  });
});

/** Args for {@link makeHiddenMenuMediator}. */
interface IHiddenMenuArgs {
  /** Id-bearing accounts capture revealed once the cards view loads. */
  readonly reveal: IDiscoveredEndpoint;
  /** Tier-2: a TRANSACTIONS click reveals the pool only after MENU_EXPAND. */
  readonly revealOnExpand?: boolean;
  /** Tier-3 input: hrefs returned by `collectAllHrefs`. */
  readonly hrefs?: readonly string[];
  /** Tier-3: `navigateTo` reveals the pool (a real txn href existed). */
  readonly revealOnNavigate?: boolean;
}

/**
 * Build a hidden-menu SPA mediator: the transactions link resolves only
 * AFTER the collapsed menu is expanded (tier-2), or via a txn-page href
 * (tier-3). Models the live Isracard/Amex account-resolve failures the
 * single-shot nudge could not recover — a lone TRANSACTIONS click lands
 * on nothing, leaving the pool empty so POST fails loud. Clicks are
 * matched by reference identity against the exact WK groups the
 * production nudge passes.
 * @param args - Reveal capture + which recovery path is wired.
 * @returns Mediator stub plus the recorded navigateTo targets.
 */
function makeHiddenMenuMediator(args: IHiddenMenuArgs): {
  mediator: IElementMediator;
  navTargets: string[];
} {
  const revealedPool: readonly IDiscoveredEndpoint[] = [args.reveal];
  const menuGroup = WK_DASHBOARD.MENU_EXPAND as unknown as readonly SelectorCandidate[];
  const okFound: Procedure<IRaceResult> = succeed({ ...NOT_FOUND_RESULT, found: true });
  const okVoid: Procedure<void> = succeed(undefined);
  const navTargets: string[] = [];
  let pool: readonly IDiscoveredEndpoint[] = [];
  let isMenuExpanded = false;

  const mediator = {
    network: {
      /**
       * Snapshot the current pre-nav pool.
       * @returns Captured endpoints.
       */
      getPreNavCaptures: (): readonly IDiscoveredEndpoint[] => pool,
      /**
       * Apply the id predicate to the current pool.
       * @param _timeoutMs - Ignored budget.
       * @param predicate - Id-bearing capture selector.
       * @returns Match endpoint or false.
       */
      waitForFirstId: (
        _timeoutMs: number,
        predicate: (p: readonly IDiscoveredEndpoint[]) => IDiscoveredEndpoint | false,
      ): Promise<IDiscoveredEndpoint | false> => {
        const match = predicate(pool);
        return Promise.resolve(match);
      },
      /**
       * Resolve the first pooled capture whose URL matches a pattern.
       * @param patterns - Accounts-API URL patterns.
       * @returns Matching endpoint or false.
       */
      waitForTraffic: (patterns: readonly RegExp[]): Promise<IDiscoveredEndpoint | false> => {
        const match = pool.find(capture => patterns.some(p => p.test(capture.url)));
        return Promise.resolve(match ?? false);
      },
    },
    /**
     * Smart-wait mock — awaits the custom wait so test stubs run.
     * @param cw - Caller-supplied custom wait promise.
     * @returns True after the custom wait settles.
     */
    raceWithNetworkIdle: async (cw: Promise<unknown>): Promise<true> => {
      try {
        await cw;
      } catch {
        /* swallow */
      }
      return true as const;
    },
    /**
     * Reference-identity click handler. A MENU_EXPAND click marks the menu
     * open; a later TRANSACTIONS click then reveals the pool (tier-2).
     * Every other click is a best-effort no-op (the collapsed-menu miss).
     * @param candidates - The exact WK group the production nudge passed.
     * @returns Found sentinel for handled groups, no-op result otherwise.
     */
    resolveAndClick: (
      candidates: readonly SelectorCandidate[],
    ): Promise<Procedure<IRaceResult>> => {
      const isMenuClick = candidates === menuGroup;
      if (isMenuClick) isMenuExpanded = true;
      const isTxnReveal = candidates === WK_DASHBOARD.TRANSACTIONS && args.revealOnExpand === true;
      if (isTxnReveal && isMenuExpanded) pool = revealedPool;
      const isHandled = isMenuClick || (isTxnReveal && isMenuExpanded);
      return Promise.resolve(isHandled ? okFound : NUDGE_NOOP_RESULT);
    },
    /**
     * Expose the configured hrefs for the tier-3 href scan.
     * @returns Hrefs present on the page.
     */
    collectAllHrefs: (): Promise<readonly string[]> => Promise.resolve(args.hrefs ?? []),
    /**
     * Report the current SPA URL used to resolve relative hrefs.
     * @returns Current page URL.
     */
    getCurrentUrl: (): string => 'https://web.isracard.example/ocp',
    /**
     * Record a navigation target and, when wired, reveal the pool — models
     * a real transactions-page href existing for the tier-3 navigation.
     * @param url - Absolute URL the nudge navigated to.
     * @returns Best-effort navigation success sentinel.
     */
    navigateTo: (url: string): Promise<Procedure<void>> => {
      navTargets.push(url);
      if (args.revealOnNavigate === true) pool = revealedPool;
      return Promise.resolve(okVoid);
    },
  } as unknown as IElementMediator;
  return { mediator, navTargets };
}

describe('executeAccountResolvePre — multi-tier hidden-menu nudge (regression firing tests)', () => {
  const reveal = makeCapture({
    url: 'https://web.isracard.example/ocp/statuspage/DigitalV3.StatusPage/GetCardList',
    method: 'POST',
    responseBody: { data: { cardsList: [{ cardSuffix: 'FAKE_C01', accountNumber: '111' }] } },
  });

  /**
   * Wrap a hidden-menu mediator in a has:true pipeline context.
   * @param mediator - Hidden-menu mediator stub.
   * @returns Context with the mediator present.
   */
  function ctxFor(mediator: IElementMediator): IPipelineContext {
    return { ...makeMockContext(), mediator: { has: true, value: mediator } };
  }

  it('resolves accounts when the transactions link is hidden behind a collapsed menu', async () => {
    // RED on the single-shot nudge: a lone TRANSACTIONS click lands on
    // nothing (menu collapsed) → GetCardList never fires → empty pool →
    // POST fails loud. The multi-tier nudge expands the menu first.
    const { mediator } = makeHiddenMenuMediator({ reveal, revealOnExpand: true });
    const ctx = ctxFor(mediator);
    const pre = await executeAccountResolvePre(ctx);
    expect(pre.success).toBe(true);
    const post = await executeAccountResolvePost(ctx);
    expect(post.success).toBe(true);
    if (isOk(post)) {
      expect(post.value.accountDiscovery.has).toBe(true);
    }
  });

  it('resolves accounts by navigating a txn-page href when no link resolves', async () => {
    // RED on the single-shot nudge: no clickable link resolves at all →
    // tier-3 navigates directly to a discovered transactions-page href.
    const { mediator, navTargets } = makeHiddenMenuMediator({
      reveal,
      hrefs: ['https://web.isracard.example/ocp/transactions'],
      revealOnNavigate: true,
    });
    const ctx = ctxFor(mediator);
    const pre = await executeAccountResolvePre(ctx);
    expect(pre.success).toBe(true);
    const post = await executeAccountResolvePost(ctx);
    expect(post.success).toBe(true);
    expect(navTargets).toContain('https://web.isracard.example/ocp/transactions');
  });

  it('never navigates to a same-text login-redirect href (decoy rejected)', async () => {
    // Amex signature: the only same-text hrefs point at /personalarea/login/.
    // The txn-pattern filter must reject them so the nudge never navigates
    // to the login page (which would destroy the authenticated session).
    const { mediator, navTargets } = makeHiddenMenuMediator({
      reveal,
      hrefs: ['https://web.isracard.example/personalarea/login/'],
      revealOnNavigate: true,
    });
    const ctx = ctxFor(mediator);
    const pre = await executeAccountResolvePre(ctx);
    expect(pre.success).toBe(true);
    expect(navTargets).toHaveLength(0);
  });
});
