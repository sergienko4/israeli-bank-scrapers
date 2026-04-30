/**
 * Branch coverage for PepperShapeTxns helpers — exercises every `??` and
 * optional-chaining fallback that the GraphQL response shape may trigger
 * (missing `oshTransactionsNew`, missing `transactions`, etc.).
 */

import {
  isLastPage,
  pageNumberOf,
  txnsExtractPage,
} from '../../../../../Scrapers/Pipeline/Banks/Pepper/scrape/PepperShapeTxns.js';

describe('PepperShapeTxns.pageNumberOf', () => {
  it('returns FIRST_PAGE when cursor is false (initial call)', () => {
    const result = pageNumberOf(false);
    expect(result).toBe(1);
  });

  it('returns the cursor value when present', () => {
    const result = pageNumberOf(7);
    expect(result).toBe(7);
  });
});

describe('PepperShapeTxns.isLastPage', () => {
  it('terminates on empty rows', () => {
    const isDone = isLastPage(0, 1, 100);
    expect(isDone).toBe(true);
  });

  it('terminates on under-page (rows < PAGE_SIZE)', () => {
    // PAGE_SIZE is the bank's chosen page width; under-page = last page.
    const isDone = isLastPage(5, 1, 999);
    expect(isDone).toBe(true);
  });

  it('terminates when cumulative coverage meets totalCount', () => {
    // Full page (rows == PAGE_SIZE) AND page * PAGE_SIZE >= total.
    // PAGE_SIZE is hard-coded; using a large rows value triggers the path.
    const isDone = isLastPage(100, 1, 50);
    expect(isDone).toBe(true);
  });

  it('does NOT terminate on a full page when more results remain', () => {
    const isDone = isLastPage(100, 1, 9999);
    expect(isDone).toBe(false);
  });
});

describe('PepperShapeTxns.txnsExtractPage', () => {
  it('returns empty rows + cursor=false when oshTransactionsNew is missing', () => {
    const body = { accounts: {} };
    const page = txnsExtractPage(body, false);
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBe(false);
  });

  it('handles missing transactions[] gracefully (osh.transactions undefined)', () => {
    const body = {
      accounts: { oshTransactionsNew: { pendingTransactions: [{ id: 'p1' }], totalCount: 1 } },
    };
    const page = txnsExtractPage(body, false);
    expect(page.items.length).toBe(1);
  });

  it('handles missing pendingTransactions[] gracefully', () => {
    const body = {
      accounts: { oshTransactionsNew: { transactions: [{ id: 't1' }], totalCount: 1 } },
    };
    const page = txnsExtractPage(body, false);
    expect(page.items.length).toBe(1);
  });

  it('falls back to totalCount=0 when missing on the response', () => {
    const body = { accounts: { oshTransactionsNew: { transactions: [] } } };
    const page = txnsExtractPage(body, false);
    expect(page.items).toEqual([]);
    // Empty rows → isLastPage true → nextCursor false.
    expect(page.nextCursor).toBe(false);
  });

  it('returns nextCursor = page+1 when more results remain', () => {
    // Build a "full page" worth of rows so under-page exit does not fire.
    const transactions = Array.from({ length: 100 }, (_v, i): { id: string } => ({
      id: `t${String(i)}`,
    }));
    const body = {
      accounts: { oshTransactionsNew: { transactions, totalCount: 9999 } },
    };
    const page = txnsExtractPage(body, false);
    expect(page.items.length).toBe(100);
    // First page processed → nextCursor = 2.
    expect(page.nextCursor).toBe(2);
  });
});
