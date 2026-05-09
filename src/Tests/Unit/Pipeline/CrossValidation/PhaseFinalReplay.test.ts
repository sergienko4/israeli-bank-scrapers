/**
 * Cross-validation harness — replay phase FINAL gatekeepers against
 * synthetic per-bank fixtures shaped after real production URL +
 * response patterns observed in `runs/pipeline/{bank}/<ts>/network/`.
 *
 * IMPORTANT: every fixture below is synthetic. No real account
 * numbers, no real card digits, no real auth tokens. The shapes are
 * accurate (URL stubs, container key names, accountId-style fields)
 * so the WK pattern matchers and `extractAccountRecords` exercise
 * the SAME code paths a real bank capture would, but the values are
 * obviously fake (`fake-card-1234`, `99-999-999999`, `fake-acct-A`).
 * This keeps the cross-validation strictly PII-free and stable over
 * time — real captures rotate IDs and tokens; this harness never
 * needs maintenance for that reason.
 *
 * Coverage:
 * - Per bank, the LOGIN/OTP-FILL.FINAL pre-nav account container
 *   readiness check passes when account-shape captures land in the
 *   pre-nav bucket and fails loud when they don't.
 * - Per bank, DASHBOARD.FINAL's post-nav transactions match passes
 *   when a txn-pattern URL is in the post-nav bucket.
 * - For Amex / Isracard specifically: when BOTH the multi-card
 *   widget POST (`GetLatestTransactions`) and the per-card full-
 *   history POST (`GetTransactionsList`) are present, the picker
 *   `discoverTransactionsEndpoint()` is documented (the test
 *   captures which one it picks so 5C's tie-breaker decision is
 *   driven by deterministic fixture behaviour).
 */

import { discoverAccountsInPool } from '../../../../Scrapers/Pipeline/Mediator/Network/AccountFromPool.js';
import { createFrozenNetwork } from '../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscovery.js';
import type { IDiscoveredEndpoint } from '../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscoveryTypes.js';
import { PIPELINE_WELL_KNOWN_API } from '../../../../Scrapers/Pipeline/Registry/WK/ScrapeWK.js';
import { makeMockContext } from '../Infrastructure/MockFactories.js';

/** Bundled args for `makeCapture` — keeps the helper inside the param budget. */
interface IMakeCaptureArgs {
  readonly url: string;
  readonly method: 'GET' | 'POST';
  readonly responseBody: unknown;
  readonly postData?: string;
  readonly timestamp?: number;
}

/**
 * Build a synthetic capture endpoint with explicit timestamp.
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

/** Per-bank fixture bundle for the replay harness. */
interface IBankFixture {
  /** Bank label for diagnostic output. */
  readonly label: string;
  /** Pre-nav captures — what the listener saw before the dashboard click. */
  readonly preNav: readonly IDiscoveredEndpoint[];
  /** Post-nav captures — what fires after the user clicks "Transactions". */
  readonly postNav: readonly IDiscoveredEndpoint[];
  /** Synthetic clickAt timestamp separating the two buckets. */
  readonly clickAtMs: number;
  /**
   * For diagnostic / 5C planning — when the bank has BOTH a widget
   * POST and a full-history POST, document which capture the picker
   * is EXPECTED to land on. Empty string when not applicable.
   */
  readonly expectedPickedTxnUrlContains: string;
}

const FIXTURES: readonly IBankFixture[] = [
  {
    label: 'discount',
    preNav: [
      makeCapture({
        url: 'https://start.telebank.co.il/Titan/gatewayAPI/userAccountsData/FetchAccountsNickName',
        method: 'GET',
        responseBody: {
          accounts: [{ accountId: 'fake-acct-A', accountNumber: '99-999-999999' }],
        },
        timestamp: 100,
      }),
    ],
    postNav: [
      makeCapture({
        url: 'https://start.telebank.co.il/Titan/gatewayAPI/lastTransactions/fake-acct-A/Date',
        method: 'GET',
        responseBody: { transactions: [{ amount: 1 }] },
        timestamp: 500,
      }),
    ],
    clickAtMs: 200,
    expectedPickedTxnUrlContains: 'lastTransactions',
  },
  {
    label: 'visacal',
    preNav: [
      makeCapture({
        url: 'https://api.cal-online.co.il/Account/AccountsSummary',
        method: 'GET',
        responseBody: { accounts: [{ accountId: 'fake-cal-1' }] },
        timestamp: 100,
      }),
    ],
    postNav: [
      // VisaCal serves the per-card history under
      // /Transactions-Service/api/transactions/v1 — matched by
      // WK.transactions's `/transactions\/v\d/i` pattern.
      makeCapture({
        url: 'https://api.cal-online.co.il/Transactions-Service/api/transactions/v1',
        method: 'POST',
        responseBody: { transactions: [] },
        postData: '{"cardId":"fake-card-1111"}',
        timestamp: 500,
      }),
    ],
    clickAtMs: 200,
    expectedPickedTxnUrlContains: 'transactions/v1',
  },
  {
    label: 'max',
    preNav: [
      makeCapture({
        url: 'https://www.max.co.il/api/registered/getRegisterUserData',
        method: 'GET',
        responseBody: { cards: [{ cardUniqueId: 'fake-max-card-1' }] },
        timestamp: 100,
      }),
    ],
    postNav: [
      makeCapture({
        url: 'https://www.max.co.il/api/registered/getTransactionsAndGraphs',
        method: 'POST',
        responseBody: { transactions: [] },
        postData: '{"cardUniqueId":"fake-max-card-1"}',
        timestamp: 500,
      }),
    ],
    clickAtMs: 200,
    expectedPickedTxnUrlContains: 'getTransactionsAndGraphs',
  },
  {
    label: 'hapoalim',
    preNav: [
      makeCapture({
        url: 'https://login.bankhapoalim.co.il/general/accounts',
        method: 'GET',
        // Hapoalim returns a ROOT-LEVEL array of account-shaped records.
        // The pre-nav check delegates to `extractAccountRecords` whose
        // 3rd tier (`rootAccountArray`) covers this shape.
        responseBody: [{ accountNumber: '99-999-FAKE-A', bankNumber: '12' }],
        timestamp: 100,
      }),
    ],
    postNav: [
      makeCapture({
        url: 'https://login.bankhapoalim.co.il/getTransactions/fake-acct-1',
        method: 'GET',
        responseBody: {
          transactions: [{ eventDate: 20260101, eventAmount: -10, description: 'FAKE' }],
        },
        timestamp: 500,
      }),
    ],
    clickAtMs: 200,
    expectedPickedTxnUrlContains: 'getTransactions',
  },
  {
    label: 'beinleumi',
    preNav: [
      makeCapture({
        url: 'https://online.fibi.co.il/wps/wcm/api/general/accountSummary',
        method: 'GET',
        responseBody: { bankAccounts: [{ accountNumber: 'FAKE-BL-1' }] },
        timestamp: 100,
      }),
    ],
    postNav: [
      makeCapture({
        url: 'https://online.fibi.co.il/wps/wcm/api/transactions/getTransactions',
        method: 'POST',
        responseBody: { transactions: [] },
        postData: '{"accountId":"FAKE-BL-1"}',
        timestamp: 500,
      }),
    ],
    clickAtMs: 200,
    expectedPickedTxnUrlContains: 'getTransactions',
  },
  {
    label: 'amex',
    preNav: [
      // Widget capture pre-click — multi-card POST body. This is the
      // "noise" capture that 5A's gate keeps OFF until OTP-FILL/
      // LOGIN.FINAL — but for Amex/Isracard the SAME endpoint may
      // also fire AFTER the click as the widget refreshes, so it
      // shows up in BOTH buckets in real runs. The tie-breaker (5C)
      // is what disambiguates widget from full-history.
      makeCapture({
        url: 'https://web.americanexpress.co.il/ocp/transactions/DigitalV3.Transactions_GetCardList',
        method: 'POST',
        responseBody: { cards: [{ cardUniqueId: 'fake-amex-1' }, { cardUniqueId: 'fake-amex-2' }] },
        postData: '{"cards":[{"cardUniqueId":"fake-amex-1"},{"cardUniqueId":"fake-amex-2"}]}',
        timestamp: 100,
      }),
    ],
    postNav: [
      // Multi-card widget AGAIN, post-click (mimics real Amex flow).
      makeCapture({
        url: 'https://web.americanexpress.co.il/ocp/statuspage/DigitalV3.StatusPage_GetLatestTransactions',
        method: 'POST',
        responseBody: { transactions: [] },
        postData: '{"cards":[{"cardUniqueId":"fake-amex-1"},{"cardUniqueId":"fake-amex-2"}]}',
        timestamp: 300,
      }),
      // Per-card full-history — this is what we WANT the picker to land on.
      makeCapture({
        url: 'https://web.americanexpress.co.il/ocp/transactions/DigitalV3.Transactions_GetTransactionsList',
        method: 'POST',
        responseBody: { transactions: [{ id: 1 }] },
        postData: '{"cardUniqueId":"fake-amex-1","billingMonth":"01/05/2026"}',
        timestamp: 500,
      }),
    ],
    clickAtMs: 200,
    // The picker today (postWithShape tier) prefers shape-passing POSTs;
    // the per-card body holds a transactions array → it lands on
    // GetTransactionsList. If 5C still proves needed, this fixture is the
    // baseline regression test the tie-breaker must keep green.
    expectedPickedTxnUrlContains: 'GetTransactionsList',
  },
  {
    label: 'isracard',
    preNav: [
      makeCapture({
        url: 'https://web.isracard.co.il/ocp/transactions/DigitalV3.Transactions_GetCardList',
        method: 'POST',
        responseBody: { cards: [{ cardUniqueId: 'fake-isr-1' }, { cardUniqueId: 'fake-isr-2' }] },
        postData: '{"cards":[{"cardUniqueId":"fake-isr-1"},{"cardUniqueId":"fake-isr-2"}]}',
        timestamp: 100,
      }),
    ],
    postNav: [
      makeCapture({
        url: 'https://web.isracard.co.il/ocp/statuspage/DigitalV3.StatusPage_GetLatestTransactions',
        method: 'POST',
        responseBody: { transactions: [] },
        postData: '{"cards":[{"cardUniqueId":"fake-isr-1"},{"cardUniqueId":"fake-isr-2"}]}',
        timestamp: 300,
      }),
      makeCapture({
        url: 'https://web.isracard.co.il/ocp/transactions/DigitalV3.Transactions_GetTransactionsList',
        method: 'POST',
        responseBody: { transactions: [{ id: 1 }] },
        postData: '{"cardUniqueId":"fake-isr-1","billingMonth":"01/05/2026"}',
        timestamp: 500,
      }),
    ],
    clickAtMs: 200,
    expectedPickedTxnUrlContains: 'GetTransactionsList',
  },
];

/** Replay bundle pairing the test context with its frozen network. */
interface IReplayBundle {
  readonly ctx: ReturnType<typeof makeMockContext>;
  readonly network: ReturnType<typeof createFrozenNetwork>;
}

/**
 * Build a replay bundle: a context whose mediator wraps a frozen
 * network primed with both pre-nav and post-nav buckets, plus the
 * raw network handle for direct assertions.
 * @param fixture - Bank fixture.
 * @returns Bundle with ctx + network.
 */
function makeReplayBundle(fixture: IBankFixture): IReplayBundle {
  const merged = [...fixture.preNav, ...fixture.postNav];
  const network = createFrozenNetwork(merged, false, fixture.clickAtMs);
  const baseCtx = makeMockContext();
  const ctx = {
    ...baseCtx,
    mediator: { has: true, value: { network } },
  } as unknown as ReturnType<typeof makeMockContext>;
  return { ctx, network };
}

/**
 * Build a context whose mediator's pre-nav has been STRIPPED of any
 * account container — exercises the readiness fail path. We do this
 * by feeding only post-nav captures into the frozen network and
 * setting clickAt at 0 so the pre-nav bucket is empty.
 * @param fixture - Bank fixture.
 * @returns Pipeline context stub with no pre-nav account container.
 */
function makeStrippedPreNavCaptures(fixture: IBankFixture): readonly IDiscoveredEndpoint[] {
  // Replace pre-nav captures with a single non-account body so the
  // pool is non-empty but no record matches the account container
  // check.
  const noAccountBody = makeCapture({
    url: 'https://example.invalid/api/no-account',
    method: 'GET',
    responseBody: { unrelated: 'no-container' },
    timestamp: 50,
  });
  const merged = [noAccountBody, ...fixture.postNav];
  const network = createFrozenNetwork(merged, false, fixture.clickAtMs);
  return network.getPreNavCaptures();
}

describe('Cross-validation — phase FINAL replay (synthetic per-bank fixtures)', () => {
  for (const fixture of FIXTURES) {
    it(`${fixture.label}: pre-nav holds account-id-bearing capture (ACCOUNT-RESOLVE input)`, () => {
      const { network } = makeReplayBundle(fixture);
      const preNav = network.getPreNavCaptures();
      const result = discoverAccountsInPool(preNav);
      expect(result.endpoint).not.toBe(false);
      expect(result.ids.length).toBeGreaterThan(0);
    });

    it(`${fixture.label}: stripped pre-nav yields no ids — ACCOUNT-RESOLVE would fail loud`, () => {
      const preNav = makeStrippedPreNavCaptures(fixture);
      const result = discoverAccountsInPool(preNav);
      expect(result.endpoint).toBe(false);
      expect(result.ids.length).toBe(0);
    });

    it(`${fixture.label}: post-nav has WK transactions match`, () => {
      const { network } = makeReplayBundle(fixture);
      const postNav = network.getPostNavCaptures();
      const hasMatch = postNav.some((ep): boolean =>
        PIPELINE_WELL_KNOWN_API.transactions.some((p): boolean => p.test(ep.url)),
      );
      expect(hasMatch).toBe(true);
    });

    it(`${fixture.label}: discoverTransactionsEndpoint picks the expected URL`, () => {
      const { network } = makeReplayBundle(fixture);
      const picked = network.discoverTransactionsEndpoint();
      expect(picked).not.toBe(false);
      if (picked !== false) {
        expect(picked.url).toContain(fixture.expectedPickedTxnUrlContains);
      }
    });
  }
});

describe('Cross-validation — pipeline must STOP when no data', () => {
  it('discovery returns empty when pre-nav pool is non-empty but every body is unrelated', () => {
    const noise = [
      makeCapture({
        url: 'https://x/noise/1',
        method: 'GET',
        responseBody: { foo: 1 },
        timestamp: 100,
      }),
      makeCapture({
        url: 'https://x/noise/2',
        method: 'POST',
        responseBody: { bar: 'baz' },
        postData: '{}',
        timestamp: 200,
      }),
    ];
    const network = createFrozenNetwork(noise, false, 50);
    const preNav = network.getPreNavCaptures();
    const result = discoverAccountsInPool(preNav);
    expect(result.ids.length).toBe(0);
  });

  it('discovery returns empty on an empty pre-nav pool', () => {
    const network = createFrozenNetwork([], false, false);
    const preNav = network.getPreNavCaptures();
    const result = discoverAccountsInPool(preNav);
    expect(result.ids.length).toBe(0);
  });
});
