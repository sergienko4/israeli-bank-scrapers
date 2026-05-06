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
import { verifyPreNavReadiness } from '../../../../Scrapers/Pipeline/Mediator/Auth/PreNavReadiness.js';
import { createFrozenNetwork } from '../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscovery.js';
import type { IDiscoveredEndpoint } from '../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscoveryTypes.js';
import { isOk } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from '../Infrastructure/MockFactories.js';

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
