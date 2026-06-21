import type { SelectorCandidate } from '../../../../../Scrapers/Base/Config/LoginConfigTypes.js';
import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import {
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
import {
  fail,
  isOk,
  type Procedure,
  succeed,
} from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';
import { makeCapture, NUDGE_NOOP_RESULT } from './AccountResolveActions.fixtures.js';

/** Args for {@link makeHiddenMenuMediator}. */
interface IHiddenMenuArgs {
  /** Id-bearing accounts capture revealed once the cards view loads. */
  readonly reveal: IDiscoveredEndpoint;
  /** Tier-1: a direct TRANSACTIONS click reveals the pool (no menu needed). */
  readonly revealOnDirectClick?: boolean;
  /** Tier-2: a TRANSACTIONS click reveals the pool only after MENU_EXPAND. */
  readonly revealOnExpand?: boolean;
  /** Tier-3 input: hrefs returned by `collectAllHrefs`. */
  readonly hrefs?: readonly string[];
  /** Tier-3: `navigateTo` reveals the pool (a real txn href existed). */
  readonly revealOnNavigate?: boolean;
  /** Tier-3: `navigateTo` resolves to a FAILURE Procedure (navigation 500s). */
  readonly failNavigate?: boolean;
  /** Tier-3: serve an unparseable base URL so `toSafeHttpUrl` must catch. */
  readonly badBase?: boolean;
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
  const baseUrl = 'https://web.isracard.example/ocp';
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
     * Reference-identity click handler. With `revealOnDirectClick`, the first
     * TRANSACTIONS click reveals the pool (tier-1). Otherwise a MENU_EXPAND
     * click marks the menu open and a later TRANSACTIONS click reveals the
     * pool (tier-2). Every other click is a best-effort no-op.
     * @param candidates - The exact WK group the production nudge passed.
     * @returns Found sentinel for handled groups, no-op result otherwise.
     */
    resolveAndClick: (
      candidates: readonly SelectorCandidate[],
    ): Promise<Procedure<IRaceResult>> => {
      const isMenuClick = candidates === menuGroup;
      if (isMenuClick) isMenuExpanded = true;
      const isTxnClick = candidates === WK_DASHBOARD.TRANSACTIONS;
      const isMenuReady = args.revealOnExpand === true && isMenuExpanded;
      const isTxnReveal = isTxnClick && (args.revealOnDirectClick === true || isMenuReady);
      if (isTxnReveal) pool = revealedPool;
      const isHandled = isMenuClick || isTxnReveal;
      return Promise.resolve(isHandled ? okFound : NUDGE_NOOP_RESULT);
    },
    /**
     * Expose the configured hrefs for the tier-3 href scan.
     * @returns Hrefs present on the page.
     */
    collectAllHrefs: (): Promise<readonly string[]> => Promise.resolve(args.hrefs ?? []),
    /**
     * Report the current SPA URL used to resolve relative hrefs. With
     * `badBase`, returns an unparseable base so `toSafeHttpUrl` must catch.
     * @returns Current page URL, or '' when `badBase` is set.
     */
    getCurrentUrl: (): string => (args.badBase === true ? '' : baseUrl),
    /**
     * Record a navigation target and, when wired, reveal the pool — models
     * a real transactions-page href existing for the tier-3 navigation.
     * @param url - Absolute URL the nudge navigated to.
     * @returns Best-effort navigation success sentinel.
     */
    navigateTo: (url: string): Promise<Procedure<void>> => {
      navTargets.push(url);
      if (args.failNavigate === true) {
        const failed = fail(ScraperErrorTypes.Generic, 'navigation failed');
        return Promise.resolve(failed);
      }
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

  it('resolves accounts when the transactions link is directly clickable (tier-1)', async () => {
    // Healthy SPA: the visible transactions link resolves on the first click
    // and the accounts API fires immediately. Tier-1 confirms the traffic and
    // the walk stops — no menu expansion, no href navigation.
    const { mediator, navTargets } = makeHiddenMenuMediator({ reveal, revealOnDirectClick: true });
    const ctx = ctxFor(mediator);
    const pre = await executeAccountResolvePre(ctx);
    expect(pre.success).toBe(true);
    expect(navTargets).toHaveLength(0);
    const post = await executeAccountResolvePost(ctx);
    expect(post.success).toBe(true);
    if (isOk(post)) {
      expect(post.value.accountDiscovery.has).toBe(true);
    }
  });

  it('skips an unparseable txn href without navigating (safe-URL catch)', async () => {
    // A txn-pattern href that cannot resolve against the page base (an
    // unparseable base URL) must be swallowed: toSafeHttpUrl returns '' so the
    // nudge neither navigates nor throws. With no recovery the pool stays empty
    // and POST fails loud — proving the href was rejected, not followed.
    const { mediator, navTargets } = makeHiddenMenuMediator({
      reveal,
      hrefs: ['/ocp/transactions'],
      badBase: true,
      revealOnNavigate: true,
    });
    const ctx = ctxFor(mediator);
    const pre = await executeAccountResolvePre(ctx);
    expect(pre.success).toBe(true);
    expect(navTargets).toHaveLength(0);
    const post = await executeAccountResolvePost(ctx);
    expect(post.success).toBe(false);
  });

  it('aborts tier-3 cleanly when the navigation itself fails (no false resolve)', async () => {
    // A real txn href resolves and the nudge navigates to it, but the
    // navigation fails (e.g. the SPA route 500s). tierHrefNavigate must abort
    // on the failed Procedure rather than probing for accounts traffic on a
    // page that never loaded — best-effort, never throwing. navTargets proves
    // the navigation was attempted; the empty pool leaves POST to fail loud.
    const { mediator, navTargets } = makeHiddenMenuMediator({
      reveal,
      hrefs: ['https://web.isracard.example/ocp/transactions'],
      failNavigate: true,
    });
    const ctx = ctxFor(mediator);
    const pre = await executeAccountResolvePre(ctx);
    expect(pre.success).toBe(true);
    expect(navTargets).toContain('https://web.isracard.example/ocp/transactions');
    const post = await executeAccountResolvePost(ctx);
    expect(post.success).toBe(false);
  });
});
