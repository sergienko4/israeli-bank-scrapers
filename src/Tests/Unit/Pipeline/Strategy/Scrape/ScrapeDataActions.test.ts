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
    const a = makeTxn({ description: 'a' });
    const b = makeTxn({ description: 'b' });
    const result = deduplicateTxns([a, b], 0);
    expect(result).toHaveLength(2);
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
    const fc = makeFc(api, network);
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
