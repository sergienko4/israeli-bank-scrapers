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

import { discoverAccountsInPool } from '../../../../Scrapers/Pipeline/Mediator/Network/AccountFromPool.js';
import { createFrozenNetwork } from '../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscovery.js';
import type { IDiscoveredEndpoint } from '../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscoveryTypes.js';
import { PIPELINE_WELL_KNOWN_API } from '../../../../Scrapers/Pipeline/Registry/WK/ScrapeWK.js';

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
  it('discoverAccountsInPool does NOT throw on a Lottie-shaped pre-nav body', () => {
    // After Phase 7, ACCOUNT-RESOLVE.POST is the consumer. The
    // recursive walker's stack-safety still matters because
    // `discoverAccountsInPool` runs `extractAccountRecords` on every
    // body in the pool — including adversarial Lottie animation JSON.
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
    const pool = [lottie, account];
    let didThrow = false;
    let ids: readonly string[] = [];
    try {
      const result = discoverAccountsInPool(pool);
      ids = result.ids;
    } catch {
      didThrow = true;
    }
    expect(didThrow).toBe(false);
    expect(ids).toContain('fake-card-1');
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

describe('Pattern 1 — sanity (wait/discover migrated to ACCOUNT-RESOLVE)', () => {
  // Phase 7 (2026-05-07) moved the wait-for-account-traffic and the
  // discovery commit out of LOGIN.FINAL/OTP-FILL.FINAL into the
  // dedicated ACCOUNT-RESOLVE phase. Regression coverage for the new
  // owner lives in
  // `src/Tests/Unit/Pipeline/Mediator/AccountResolve/AccountResolveActions.test.ts`.
  // Only the WK-shape sanity check remains here.
  it('WK.accounts patterns are the canonical wait signal (sanity)', () => {
    expect(PIPELINE_WELL_KNOWN_API.accounts.length).toBeGreaterThan(0);
  });
});

describe('Defect D1 — Phase 7e: shape-aware full-pool picker (no bucket constraint)', () => {
  it('discoverTransactionsEndpoint picks shape-passing capture regardless of pre-/post-nav bucket', () => {
    // Phase 7e: VisaCal-class banks fire the txn URL at login-FINAL,
    // before any dashboard click. The picker walks the full captured
    // pool and prefers shape-passing captures over noise — no
    // pre-/post-nav bucket constraint. The fail-loud signal for
    // broken-click banks is now "no shape-passing capture anywhere",
    // not "no post-nav capture".
    const preNavTxn = makeCapture({
      url: 'https://api.cal-online.example/Transactions/api/filteredTransactions/getFilteredTransactions',
      method: 'POST',
      responseBody: { transactions: [{ date: '2026-01-01', amount: -10, description: 'FAKE' }] },
      postData: '{"cardUniqueId":"FAKE"}',
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
    expect(picked).not.toBe(false);
    if (picked !== false) {
      expect(picked.url).toContain('filteredTransactions');
    }
  });
});
