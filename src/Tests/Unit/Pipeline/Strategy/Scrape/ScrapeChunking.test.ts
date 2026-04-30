/**
 * Unit tests for Strategy/Scrape/ScrapeChunking — applyGlobalDateFilter + scrapeWithMonthlyChunking.
 */

import {
  applyGlobalDateFilter,
  scrapeWithMonthlyChunking,
} from '../../../../../Scrapers/Pipeline/Strategy/Scrape/ScrapeChunking.js';
import type { IChunkingCtx } from '../../../../../Scrapers/Pipeline/Strategy/Scrape/ScrapeTypes.js';
import { isOk } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import type { ITransaction, ITransactionsAccount } from '../../../../../Transactions.js';
import { TransactionStatuses, TransactionTypes } from '../../../../../Transactions.js';
import {
  makeApi,
  makeNetwork,
  stubFetchPostFail,
  stubFetchPostOk,
} from '../StrategyTestHelpers.js';

/**
 * Build a transaction with date override.
 * @param date - ISO date string.
 * @returns ITransaction.
 */
function makeTxn(date: string): ITransaction {
  return {
    type: TransactionTypes.Normal,
    date,
    processedDate: date,
    originalAmount: -100,
    originalCurrency: 'ILS',
    chargedAmount: -100,
    description: 'shop',
    status: TransactionStatuses.Completed,
    identifier: date,
  };
}

/**
 * Build a transactions account from a list.
 * @param txns - Transactions.
 * @returns Account.
 */
function makeAccount(txns: ITransaction[]): ITransactionsAccount {
  return { accountNumber: '111', balance: 0, txns };
}

describe('applyGlobalDateFilter', () => {
  it('keeps transactions at or after startMs', () => {
    const account = makeAccount([makeTxn('2026-01-01'), makeTxn('2026-03-01')]);
    const startMs = new Date('2026-02-01').getTime();
    applyGlobalDateFilter([account], startMs);
    expect(account.txns).toHaveLength(1);
    expect(account.txns[0].date).toBe('2026-03-01');
  });

  it('discards invalid date strings', () => {
    const account = makeAccount([makeTxn('not-a-date'), makeTxn('2026-03-01')]);
    const startMs = new Date('2026-01-01').getTime();
    applyGlobalDateFilter([account], startMs);
    expect(account.txns).toHaveLength(1);
  });

  it('handles empty accounts array without throwing', () => {
    const result = applyGlobalDateFilter([], 0);
    expect(result).toEqual([]);
  });

  it('filters per-account independently', () => {
    const a = makeAccount([makeTxn('2026-03-01')]);
    const b = makeAccount([makeTxn('2025-01-01')]);
    const startMs = new Date('2026-02-01').getTime();
    applyGlobalDateFilter([a, b], startMs);
    expect(a.txns).toHaveLength(1);
    expect(b.txns).toHaveLength(0);
  });
});

describe('scrapeWithMonthlyChunking', () => {
  it('succeeds even when all chunks fail', async () => {
    const ctx: IChunkingCtx = {
      fc: {
        api: makeApi({ fetchPost: stubFetchPostFail() }),
        network: makeNetwork(),
        startDate: '20260101',
        futureMonths: 0,
      },
      baseBody: { accountId: 'a' },
      url: 'https://bank.example/api/txn',
      displayId: '1',
      accountId: 'a',
    };
    const result = await scrapeWithMonthlyChunking(ctx);
    const isOkResult1 = isOk(result);
    expect(isOkResult1).toBe(true);
  });

  it('succeeds with empty txn response', async () => {
    const ctx: IChunkingCtx = {
      fc: {
        api: makeApi({ fetchPost: stubFetchPostOk({}) }),
        network: makeNetwork(),
        startDate: '20260101',
        futureMonths: 0,
      },
      baseBody: { accountId: 'a' },
      url: 'https://bank.example/api/txn',
      displayId: '1',
      accountId: 'a',
    };
    const result = await scrapeWithMonthlyChunking(ctx);
    const isOkResult2 = isOk(result);
    expect(isOkResult2).toBe(true);
  });
});
