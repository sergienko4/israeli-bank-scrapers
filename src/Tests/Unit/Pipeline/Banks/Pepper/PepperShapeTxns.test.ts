/**
 * Branch coverage for PepperShapeTxns helpers — exercises every `??` and
 * optional-chaining fallback that the GraphQL response shape may trigger
 * (missing `oshTransactionsNew`, missing `transactions`, etc.).
 */

import {
  txnsExtractPage,
  txnsVars,
} from '../../../../../Scrapers/Pipeline/Banks/Pepper/scrape/PepperShapeTxns.js';
import { some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type { IActionContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { AMBIENT_ZONE_CASES, underZone } from '../../../../Helpers/AmbientZone.js';

/**
 * Builds a context whose two request bounds name the same instant.
 * @param instant - Shared lower and upper bound.
 * @returns Action context carrying an explicit one-day window.
 */
function ctxWithBoundedDay(instant: Date): IActionContext {
  const options = { startDate: instant };
  return { options, windowEnd: some(instant) } as unknown as IActionContext;
}

/**
 * Wrap a raw body + cursor in the unified IExtractPageArgs bundle.
 * @param body - Raw response body fragment.
 * @param cursor - Page cursor.
 * @returns Fully-typed args bundle.
 */
function pageArgs(
  body: Record<string, unknown>,
  cursor: number | false,
): Parameters<typeof txnsExtractPage>[0] {
  return { body, cursor, acct: { accountId: 'a' }, ctx: {} as IActionContext };
}

describe('PepperShapeTxns page variables', () => {
  it('uses page 1 for the initial cursor', () => {
    const ctx = ctxWithBoundedDay(new Date('2026-02-28T22:30:00.000Z'));
    const vars = txnsVars({ accountId: 'a' }, false, ctx);
    expect(vars.pageNumber).toBe(1);
  });

  it('uses the cursor page when present', () => {
    const ctx = ctxWithBoundedDay(new Date('2026-02-28T22:30:00.000Z'));
    const vars = txnsVars({ accountId: 'a' }, 7, ctx);
    expect(vars.pageNumber).toBe(7);
  });

  it.each(AMBIENT_ZONE_CASES)('renders both bank bounds under %s', zone => {
    const ctx = ctxWithBoundedDay(new Date('2026-02-28T22:30:00.000Z'));
    const vars = underZone(zone, () => txnsVars({ accountId: 'a' }, false, ctx));
    expect({ from: vars.from, to: vars.to }).toEqual({
      from: '2026-03-01',
      to: '2026-03-01',
    });
  });
});

describe('PepperShapeTxns.txnsExtractPage', () => {
  it('returns empty rows + cursor=false when oshTransactionsNew is missing', () => {
    const body = { accounts: {} };
    const args = pageArgs(body, false);
    const page = txnsExtractPage(args);
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBe(false);
  });

  it('handles missing transactions[] gracefully (osh.transactions undefined)', () => {
    const body = {
      accounts: { oshTransactionsNew: { pendingTransactions: [{ id: 'p1' }], totalCount: 1 } },
    };
    const args = pageArgs(body, false);
    const page = txnsExtractPage(args);
    expect(page.items.length).toBe(1);
  });

  it('handles missing pendingTransactions[] gracefully', () => {
    const body = {
      accounts: { oshTransactionsNew: { transactions: [{ id: 't1' }], totalCount: 1 } },
    };
    const args = pageArgs(body, false);
    const page = txnsExtractPage(args);
    expect(page.items.length).toBe(1);
  });

  it('falls back to totalCount=0 when missing on the response', () => {
    const body = { accounts: { oshTransactionsNew: { transactions: [] } } };
    const args = pageArgs(body, false);
    const page = txnsExtractPage(args);
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
    const args = pageArgs(body, false);
    const page = txnsExtractPage(args);
    expect(page.items.length).toBe(100);
    // First page processed → nextCursor = 2.
    expect(page.nextCursor).toBe(2);
  });

  it('terminates when a full page meets totalCount', () => {
    const transactions = Array.from({ length: 100 }, (_v, i): { id: string } => ({
      id: `t${String(i)}`,
    }));
    const body = {
      accounts: { oshTransactionsNew: { transactions, totalCount: 50 } },
    };
    const args = pageArgs(body, false);
    const page = txnsExtractPage(args);
    expect(page.items.length).toBe(100);
    expect(page.nextCursor).toBe(false);
  });
});
