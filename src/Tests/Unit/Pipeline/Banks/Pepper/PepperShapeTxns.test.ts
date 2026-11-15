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

  it.each<{
    title: string;
    cursor: number | false;
    rows: number;
    total: number;
    nextCursor: number | false;
  }>([
    {
      title: 'continues on a full page with more results',
      cursor: false,
      rows: 100,
      total: 9999,
      nextCursor: 2,
    },
    {
      title: 'terminates on a full page at the total',
      cursor: false,
      rows: 100,
      total: 50,
      nextCursor: false,
    },
    {
      title: 'terminates on a short page with a large total',
      cursor: false,
      rows: 5,
      total: 9999,
      nextCursor: false,
    },
    {
      title: 'terminates when a later full page exactly reaches the total',
      cursor: 2,
      rows: 100,
      total: 200,
      nextCursor: false,
    },
    {
      title: 'advances the incoming cursor',
      cursor: 2,
      rows: 100,
      total: 9999,
      nextCursor: 3,
    },
  ])('$title', ({ cursor, rows, total, nextCursor }) => {
    const transactions = Array.from({ length: rows }, (_v, i): { id: string } => ({
      id: `t${String(i)}`,
    }));
    const body = {
      accounts: { oshTransactionsNew: { transactions, totalCount: total } },
    };
    const args = pageArgs(body, cursor);
    const page = txnsExtractPage(args);
    expect(page.items).toHaveLength(rows);
    expect(page.nextCursor).toBe(nextCursor);
  });
});
