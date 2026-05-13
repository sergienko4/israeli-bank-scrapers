/**
 * Unit tests for Strategy/Scrape/ScrapeDataActions — pure helpers + lookup/resolve.
 */

import {
  buildAccountResult,
  buildFilterDataUrl,
  deduplicateTxns,
  lookupBalance,
  parseStartDate,
  rateLimitPause,
  resolveTxnUrl,
  templatePostBody,
} from '../../../../../Scrapers/Pipeline/Strategy/Scrape/ScrapeDataActions.js';
import type { IAccountAssemblyCtx } from '../../../../../Scrapers/Pipeline/Strategy/Scrape/ScrapeTypes.js';
import { isOk } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import type { ITransaction } from '../../../../../Transactions.js';
import { TransactionStatuses, TransactionTypes } from '../../../../../Transactions.js';
import {
  makeApi,
  makeEndpoint,
  makeFc,
  makeNetwork,
  stubFetchGetFail,
  stubFetchGetOk,
} from '../StrategyTestHelpers.js';

/**
 * Build a minimal transaction with the required fields.
 * @param overrides - Field overrides.
 * @returns ITransaction.
 */
function makeTxn(overrides: Partial<ITransaction> = {}): ITransaction {
  const defaults: ITransaction = {
    type: TransactionTypes.Normal,
    date: '2026-01-10',
    processedDate: '2026-01-10',
    originalAmount: -100,
    originalCurrency: 'ILS',
    chargedAmount: -100,
    description: 'shop',
    status: TransactionStatuses.Completed,
    identifier: 'id-1',
  };
  return { ...defaults, ...overrides };
}

describe('parseStartDate', () => {
  it('converts YYYYMMDD string to Date', () => {
    const d = parseStartDate('20260115');
    const getUTCFullYearResult1 = d.getUTCFullYear();
    expect(getUTCFullYearResult1).toBe(2026);
    const getUTCMonthResult2 = d.getUTCMonth();
    expect(getUTCMonthResult2).toBe(0);
    const getUTCDateResult3 = d.getUTCDate();
    expect(getUTCDateResult3).toBe(15);
  });

  it('works with different months', () => {
    const d = parseStartDate('20251231');
    const getUTCFullYearResult4 = d.getUTCFullYear();
    expect(getUTCFullYearResult4).toBe(2025);
    const getUTCMonthResult5 = d.getUTCMonth();
    expect(getUTCMonthResult5).toBe(11);
  });
});

describe('deduplicateTxns', () => {
  it('removes duplicate transactions by date|description|amount', () => {
    const t1 = makeTxn();
    const t2 = makeTxn();
    const result = deduplicateTxns([t1, t2], 0);
    expect(result).toHaveLength(1);
  });

  it('keeps txns at or after startMs', () => {
    const txns = [
      makeTxn({ date: '2026-01-01', description: 'a' }),
      makeTxn({ date: '2026-02-01', description: 'b' }),
    ];
    const startMs = new Date('2026-01-15').getTime();
    const result = deduplicateTxns(txns, startMs);
    expect(result).toHaveLength(1);
    expect(result[0].description).toBe('b');
  });

  it('returns empty array when all txns are before start', () => {
    const txns = [makeTxn({ date: '2025-01-01' })];
    const startMs = new Date('2026-01-01').getTime();
    const result = deduplicateTxns(txns, startMs);
    expect(result).toEqual([]);
  });

  it('distinguishes different descriptions as separate txns', () => {
    // Different identifiers required — Phase F dedup is identifier-first.
    // Two genuinely-different txns must carry distinct bank IDs.
    const a = makeTxn({ description: 'a', identifier: 'id-a' });
    const b = makeTxn({ description: 'b', identifier: 'id-b' });
    const result = deduplicateTxns([a, b], 0);
    expect(result).toHaveLength(2);
  });
});

describe('deduplicateTxns — Phase F: identifier-first dedup + date-desc sort', () => {
  it('deduplicateTxns_WithIdentifierEchoes_ShouldCollapseToOne', () => {
    // Simulates Isracard's cross-cycle echo: same `confirmationNumber`
    // returned by every cycle response. Three echoes must collapse to
    // one — independent of date / description / amount equality.
    const echoOne = makeTxn({
      identifier: '252890416:42',
      date: '2026-05-13',
      description: 'echo-row',
      originalAmount: 240,
      chargedAmount: 0,
    });
    const echoTwo = makeTxn({
      identifier: '252890416:42',
      date: '2026-05-13',
      description: 'echo-row',
      originalAmount: 240,
      chargedAmount: 0,
    });
    const echoThree = makeTxn({
      identifier: '252890416:42',
      date: '2026-05-13',
      description: 'echo-row',
      originalAmount: 240,
      chargedAmount: 0,
    });

    const result = deduplicateTxns([echoOne, echoTwo, echoThree], 0);

    expect(result).toHaveLength(1);
    expect(result[0].identifier).toBe('252890416:42');
  });

  it('deduplicateTxns_DistinctIdsSameAttributes_ShouldKeepBoth', () => {
    // Two genuinely-different txns share date / description / amount
    // (e.g. two coffees at the same shop on the same day for the same
    // price). They MUST survive because bank IDs differ — false-positive
    // collapse on attribute hash alone is the bug Phase F closes.
    const coffeeOne = makeTxn({
      identifier: 'voucher-1001',
      date: '2026-04-15',
      description: 'coffee-shop',
      originalAmount: 12.5,
      chargedAmount: 12.5,
    });
    const coffeeTwo = makeTxn({
      identifier: 'voucher-1002',
      date: '2026-04-15',
      description: 'coffee-shop',
      originalAmount: 12.5,
      chargedAmount: 12.5,
    });

    const result = deduplicateTxns([coffeeOne, coffeeTwo], 0);

    expect(result).toHaveLength(2);
    const ids = result.map((t): string | number | undefined => t.identifier).sort();
    expect(ids).toEqual(['voucher-1001', 'voucher-1002']);
  });

  it('deduplicateTxns_NoIdentifierSameAttributes_ShouldFallBackAndCollapse', () => {
    // When the bank doesn't emit an identifier on a txn (rare — only
    // observed on `outOfStatementChargeDateVouchers` with the
    // placeholder pattern), the legacy `date|description|amount` hash
    // remains the fallback. Two identifier-less rows with identical
    // attributes still collapse to one (cannot distinguish them).
    const noIdOne = makeTxn({
      identifier: undefined,
      date: '2026-04-10',
      description: 'mystery',
      originalAmount: 50,
      chargedAmount: 50,
    });
    const noIdTwo = makeTxn({
      identifier: undefined,
      date: '2026-04-10',
      description: 'mystery',
      originalAmount: 50,
      chargedAmount: 50,
    });

    const result = deduplicateTxns([noIdOne, noIdTwo], 0);

    expect(result).toHaveLength(1);
  });

  it('deduplicateTxns_MixedOrder_ShouldReturnSortedByDateDescending', () => {
    // The matrix-loop concatenates chunks in oldest-cycle-first order,
    // so without an explicit sort the consumer sees interleaved
    // "April / May / February" results. The dedup factory owns the
    // canonical sort: newest date first.
    const oldest = makeTxn({ identifier: 'old', date: '2025-12-01' });
    const middle = makeTxn({ identifier: 'mid', date: '2026-03-15' });
    const newest = makeTxn({ identifier: 'new', date: '2026-05-08' });

    const result = deduplicateTxns([oldest, newest, middle], 0);

    expect(result).toHaveLength(3);
    expect(result[0].identifier).toBe('new');
    expect(result[1].identifier).toBe('mid');
    expect(result[2].identifier).toBe('old');
  });

  it('deduplicateTxns_RunTwice_ShouldBeIdempotent', () => {
    // R-DEDUP-IDEMPOTENT — the 3 sister strategies already call dedup
    // before `buildAccountResult`; Phase F adds the call to the 4
    // strategies that skip it. A double-pass (existing + new) must be
    // a no-op.
    const raw = [
      makeTxn({ identifier: 'a', date: '2026-05-01' }),
      makeTxn({ identifier: 'a', date: '2026-05-01' }), // duplicate by identifier
      makeTxn({ identifier: 'b', date: '2026-04-01' }),
    ];

    const onePass = deduplicateTxns(raw, 0);
    const twoPass = deduplicateTxns(onePass, 0);

    expect(twoPass).toEqual(onePass);
    expect(twoPass).toHaveLength(2);
  });
});

describe('buildFilterDataUrl', () => {
  it('appends filterData with encoded JSON', () => {
    const url = buildFilterDataUrl('https://example.com/api', 2026, 3);
    expect(url).toContain('filterData=');
    expect(url).toContain('firstCallCardIndex=-1');
  });

  it('embeds year and month in the date placeholder', () => {
    const url = buildFilterDataUrl('https://x/', 2026, 6);
    const decoded = decodeURIComponent(url);
    expect(decoded).toContain('2026-6-01');
  });

  it('merges into an existing query string without producing a double "?"', () => {
    const captured = 'https://acc.bank.example/api/transactions?filterData=&v=V4.211';
    const url = buildFilterDataUrl(captured, 2026, 4);
    const questionMatches = url.match(/\?/g) ?? [];
    const questionCount = questionMatches.length;
    expect(questionCount).toBe(1);
    expect(url).toContain('v=V4.211');
    expect(url).toContain('firstCallCardIndex=-1');
  });

  it('overwrites a stale filterData value rather than appending a duplicate', () => {
    const captured = 'https://acc.bank.example/api/transactions?filterData=stale';
    const url = buildFilterDataUrl(captured, 2026, 4);
    const occurrences = url.match(/filterData=/g) ?? [];
    expect(occurrences).toHaveLength(1);
    expect(url).not.toContain('filterData=stale');
  });

  it('falls back to plain concatenation when baseUrl is not a parseable URL', () => {
    const url = buildFilterDataUrl('not-a-url', 2026, 4);
    const hasRawPrefix = url.startsWith('not-a-url?filterData=');
    expect(hasRawPrefix).toBe(true);
    expect(url).toContain('firstCallCardIndex=-1');
  });
});

describe('templatePostBody', () => {
  it('returns parsed object when record has no template keys', () => {
    const body = templatePostBody('{"foo":"bar"}', {});
    expect(body).toEqual({ foo: 'bar' });
  });

  it('handles empty postData by using {}', () => {
    const body = templatePostBody('', {});
    expect(body).toEqual({});
  });

  it('filters plural cards array to the iteration card via WK last4Digits', () => {
    const captured = JSON.stringify({
      cards: [
        { last4digits: '7641', companyCode: 11 },
        { last4digits: '3852', companyCode: 11 },
        { last4digits: '6109', companyCode: 11 },
      ],
    });
    const body = templatePostBody(captured, { last4Digits: '3852' }, '3852');
    expect(body).toEqual({
      cards: [{ last4digits: '3852', companyCode: 11 }],
    });
  });

  it('filters plural cards array via the cardNumber WK alias', () => {
    const captured = JSON.stringify({
      cards: [{ cardNumber: '8503' }, { cardNumber: '2974' }],
    });
    const body = templatePostBody(captured, { cardNumber: '2974' }, '2974');
    expect(body).toEqual({ cards: [{ cardNumber: '2974' }] });
  });

  it('leaves the plural array untouched when no entry matches the accountId', () => {
    const captured = JSON.stringify({
      cards: [{ last4digits: '7641' }, { last4digits: '3852' }],
    });
    const body = templatePostBody(captured, {}, '9999');
    expect(body).toEqual({
      cards: [{ last4digits: '7641' }, { last4digits: '3852' }],
    });
  });

  it('does not filter when accountId is empty (single-account banks)', () => {
    const captured = JSON.stringify({
      cards: [{ last4digits: '7641' }, { last4digits: '3852' }],
    });
    const body = templatePostBody(captured, {});
    expect(body).toEqual({
      cards: [{ last4digits: '7641' }, { last4digits: '3852' }],
    });
  });

  it('skips non-object entries inside the plural array (defensive)', () => {
    const captured = JSON.stringify({
      cards: ['7641', null, { last4digits: '7641' }, [1, 2]],
    });
    const body = templatePostBody(captured, {}, '7641');
    // Only the plain-object entry can match WK fields; others ignored.
    expect(body).toEqual({ cards: [{ last4digits: '7641' }] });
  });

  it('no-ops when the body has no plural cards key', () => {
    const captured = JSON.stringify({ cardUniqueId: 'x', billingMonth: '01/05/2026' });
    const body = templatePostBody(captured, {}, '7641');
    expect(body).toEqual({ cardUniqueId: 'x', billingMonth: '01/05/2026' });
  });

  it('no-ops when the plural array is already a single entry that matches', () => {
    const captured = JSON.stringify({ cards: [{ last4digits: '7641' }] });
    const body = templatePostBody(captured, {}, '7641');
    // Already 1-element with match → no narrowing.
    expect(body).toEqual({ cards: [{ last4digits: '7641' }] });
  });

  it('still substitutes scalar WK fields after filtering the plural array', () => {
    const captured = JSON.stringify({
      cards: [{ last4digits: '7641' }, { last4digits: '3852' }],
      cardUniqueId: 'old-id',
    });
    const body = templatePostBody(
      captured,
      { cardUniqueId: 'new-id', last4Digits: '7641' },
      '7641',
    );
    expect(body).toEqual({
      cards: [{ last4digits: '7641' }],
      cardUniqueId: 'new-id',
    });
  });
});

describe('rateLimitPause', () => {
  it('resolves with true after the requested delay', async () => {
    const didResolve = await rateLimitPause(1);
    expect(didResolve).toBe(true);
  });
});

describe('lookupBalance', () => {
  it('returns 0 when no balance URL buildable', async () => {
    const api = makeApi();
    const network = makeNetwork({
      /**
       * Test helper.
       *
       * @returns Result.
       */
      buildBalanceUrl: () => false,
    });
    const result = await lookupBalance(api, network, 'a');
    expect(result).toBe(0);
  });

  it('returns 0 when fetchGet fails', async () => {
    const api = makeApi({ fetchGet: stubFetchGetFail() });
    const network = makeNetwork({
      /**
       * Test helper.
       *
       * @returns Result.
       */
      buildBalanceUrl: () => 'https://bank.example/bal',
    });
    const result = await lookupBalance(api, network, 'a');
    expect(result).toBe(0);
  });

  it('returns 0 when balance field missing in response', async () => {
    const api = makeApi({ fetchGet: stubFetchGetOk({ foo: 'bar' }) });
    const network = makeNetwork({
      /**
       * Test helper.
       *
       * @returns Result.
       */
      buildBalanceUrl: () => 'https://bank.example/bal',
    });
    const result = await lookupBalance(api, network, 'a');
    expect(result).toBe(0);
  });

  it('returns the number when balance field is numeric', async () => {
    const api = makeApi({ fetchGet: stubFetchGetOk({ balance: 123.45 }) });
    const network = makeNetwork({
      /**
       * Test helper.
       *
       * @returns Result.
       */
      buildBalanceUrl: () => 'https://bank.example/bal',
    });
    const result = await lookupBalance(api, network, 'a');
    expect(result).toBe(123.45);
  });
});

describe('resolveTxnUrl', () => {
  it('returns configTransactionsUrl when set', () => {
    const api = makeApi({ configTransactionsUrl: 'https://config.example/txn' });
    const network = makeNetwork();
    const url = resolveTxnUrl({ api, network, accountId: 'a', startDate: '20260101' });
    expect(url).toBe('https://config.example/txn');
  });

  it('falls back to network.buildTransactionUrl when no config URL', () => {
    const api = makeApi();
    const network = makeNetwork({
      /**
       * Test helper.
       *
       * @returns Result.
       */
      buildTransactionUrl: () => 'https://disc.example/txn',
    });
    const url = resolveTxnUrl({ api, network, accountId: 'a', startDate: '20260101' });
    expect(url).toBe('https://disc.example/txn');
  });

  it('falls back to api.transactionsUrl when neither available', () => {
    const api = makeApi({ transactionsUrl: 'https://api.example/txn' });
    const network = makeNetwork({
      /**
       * Test helper.
       *
       * @returns Result.
       */
      buildTransactionUrl: () => false,
    });
    const url = resolveTxnUrl({ api, network, accountId: 'a', startDate: '20260101' });
    expect(url).toBe('https://api.example/txn');
  });

  it('returns false when no source provides a URL', () => {
    const api = makeApi();
    const network = makeNetwork({
      /**
       * Test helper.
       *
       * @returns Result.
       */
      buildTransactionUrl: () => false,
    });
    const url = resolveTxnUrl({ api, network, accountId: 'a', startDate: '20260101' });
    expect(url).toBe(false);
  });
});

describe('buildAccountResult', () => {
  it('builds account with balance from raw record', async () => {
    const api = makeApi();
    const network = makeNetwork();
    // Phase 7f follow-up: the SCRAPE-side balance scan consumes
    // `fc.txnEndpoint.fieldMap.balance` (the alias DASHBOARD.FINAL
    // resolved). The test supplies a slim ITxnEndpoint with the
    // matching alias so the balance value lands in the result.
    const fc = makeFc(api, network, {
      txnEndpoint: {
        url: '',
        method: 'GET',
        templatePostData: false,
        fieldMap: {
          date: '',
          amount: '',
          description: '',
          currency: '',
          identifier: '',
          originalAmount: false,
          processedDate: false,
          balance: 'balance',
        },
        pendingUrl: false,
        billingUrl: false,
      },
    });
    const ctx: IAccountAssemblyCtx = {
      fc,
      accountId: 'a',
      displayId: '1234',
      rawRecord: { balance: 500 },
    };
    const result = await buildAccountResult(ctx, []);
    const isOkResult6 = isOk(result);
    expect(isOkResult6).toBe(true);
    if (isOk(result)) {
      expect(result.value.accountNumber).toBe('1234');
      expect(result.value.balance).toBe(500);
    }
  });

  it('falls back to accountId when displayId missing', async () => {
    const api = makeApi();
    const network = makeNetwork();
    const fc = makeFc(api, network);
    const ctx: IAccountAssemblyCtx = {
      fc,
      accountId: 'acc-only',
      displayId: '',
    };
    const result = await buildAccountResult(ctx, []);
    const isOkResult7 = isOk(result);
    expect(isOkResult7).toBe(true);
    if (isOk(result)) expect(result.value.accountNumber).toBe('acc-only');
  });

  it('uses "default" when ids empty and no stored record yields them', async () => {
    const api = makeApi();
    const network = makeNetwork({
      /**
       * Test helper.
       *
       * @returns Result.
       */
      getAllEndpoints: () => [],
    });
    const fc = makeFc(api, network);
    const ctx: IAccountAssemblyCtx = { fc, accountId: '', displayId: '' };
    const result = await buildAccountResult(ctx, []);
    const isOkResult8 = isOk(result);
    expect(isOkResult8).toBe(true);
    if (isOk(result)) expect(result.value.accountNumber).toBe('default');
  });

  it('scans captured endpoints for display id when ids are empty', async () => {
    const api = makeApi();
    const network = makeNetwork({
      /**
       * Test helper.
       *
       * @returns Result.
       */
      getAllEndpoints: () => [makeEndpoint({ responseBody: { accountNumber: '5555' } })],
    });
    const fc = makeFc(api, network);
    const ctx: IAccountAssemblyCtx = { fc, accountId: '', displayId: '' };
    const result = await buildAccountResult(ctx, []);
    const isOkResult9 = isOk(result);
    expect(isOkResult9).toBe(true);
  });

  it('treats displayId="default" as a placeholder and prefers a captured account number', async () => {
    const api = makeApi();
    const network = makeNetwork({
      /**
       * Returns endpoints with a real captured account number.
       * @returns Captured endpoint list.
       */
      getAllEndpoints: () => [makeEndpoint({ responseBody: { accountNumber: '7777' } })],
    });
    const fc = makeFc(api, network);
    const ctx: IAccountAssemblyCtx = { fc, accountId: '', displayId: 'default' };
    const result = await buildAccountResult(ctx, []);
    const isOkResult10 = isOk(result);
    expect(isOkResult10).toBe(true);
    if (isOk(result)) expect(result.value.accountNumber).toBe('7777');
  });
});

describe('templatePostBody (additional)', () => {
  it('substitutes WK account id field from record into body', () => {
    const body = templatePostBody('{"accountId":"old"}', { accountId: 'new-1' });
    expect(body).toEqual({ accountId: 'new-1' });
  });

  it('skips non-scalar values in account record', () => {
    const body = templatePostBody('{}', { accountId: { nested: true } });
    expect(body).toEqual({});
  });
});
