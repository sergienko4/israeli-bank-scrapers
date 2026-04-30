/**
 * Unit tests for the Pepper shape helpers — exercise the pure extractors
 * (customer / balance / transactions) via synthetic response payloads.
 */

import { PEPPER_SHAPE } from '../../../../../Scrapers/Pipeline/Banks/Pepper/scrape/PepperShape.js';
import { isLastPage } from '../../../../../Scrapers/Pipeline/Banks/Pepper/scrape/PepperShapeTxns.js';
import type { IActionContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { makeMockContext, makeMockOptions } from '../../Infrastructure/MockFactories.js';

describe('PEPPER_SHAPE customer extractor', () => {
  it('returns accounts when userDataV2 is present', () => {
    const body = {
      userDataV2: {
        getUserDataV2: {
          customerAndAccounts: [{ accounts: [{ accountId: 'a', accountNumber: '1' }] }],
        },
      },
    };
    const accts = PEPPER_SHAPE.customer.extractAccounts(body);
    expect(accts).toHaveLength(1);
    expect(accts[0].accountId).toBe('a');
  });

  it('returns empty list when userDataV2 branch is absent', () => {
    const accts = PEPPER_SHAPE.customer.extractAccounts({});
    expect(accts).toHaveLength(0);
  });
});

describe('PEPPER_SHAPE balance extractor', () => {
  it('returns currentBalance when present', () => {
    const body = { accounts: { balance: { currentBalance: 42.5 } } };
    const got = PEPPER_SHAPE.balance.extract(body);
    expect(got).toBe(42.5);
  });

  it('falls back to 0 when currentBalance absent', () => {
    const got = PEPPER_SHAPE.balance.extract({});
    expect(got).toBe(0);
  });
});

describe('PEPPER_SHAPE transactions extractor', () => {
  it('merges posted + pending rows; nextCursor=false when under-page', () => {
    const body = {
      accounts: {
        oshTransactionsNew: {
          totalCount: 2,
          transactions: [{ transactionId: 't1' }],
          pendingTransactions: [{ transactionId: 't2' }],
        },
      },
    };
    const page = PEPPER_SHAPE.transactions.extractPage(body, false);
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBe(false);
  });

  it('emits nextCursor=2 when page is full and totalCount allows more', () => {
    /**
     * Fabricate a full page of rows.
     * @param _ - Placeholder (unused).
     * @param i - Row index.
     * @returns Synthetic transaction object.
     */
    function rowOf(_: unknown, i: number): object {
      return { transactionId: `t${String(i)}` };
    }
    const rows = Array.from({ length: 100 }, rowOf);
    const body = {
      accounts: {
        oshTransactionsNew: {
          totalCount: 250,
          transactions: rows,
          pendingTransactions: [],
        },
      },
    };
    const page = PEPPER_SHAPE.transactions.extractPage(body, false);
    expect(page.nextCursor).toBe(2);
  });
});

describe('PEPPER_SHAPE accessors', () => {
  it('accountNumberOf returns accountNumber when present', () => {
    const acct = { accountId: 'a', accountNumber: '12345' };
    const got = PEPPER_SHAPE.accountNumberOf(acct);
    expect(got).toBe('12345');
  });

  it('accountNumberOf falls back to accountId', () => {
    const got = PEPPER_SHAPE.accountNumberOf({ accountId: 'only' });
    expect(got).toBe('only');
  });

  it('customer.buildVars returns empty map', () => {
    const ctx = makeMockContext() as unknown as IActionContext;
    const vars = PEPPER_SHAPE.customer.buildVars(ctx);
    const got = Object.keys(vars);
    expect(got).toHaveLength(0);
  });

  it('balance.buildVars carries accountId', () => {
    const vars = PEPPER_SHAPE.balance.buildVars({ accountId: 'a' });
    expect(vars).toEqual({ accountId: 'a' });
  });

  it('transactions.buildVars carries accountId + from + to + page + size', () => {
    const opts = makeMockOptions({ startDate: new Date('2026-01-01') });
    const ctx = makeMockContext({ options: opts }) as unknown as IActionContext;
    const vars = PEPPER_SHAPE.transactions.buildVars({ accountId: 'a' }, false, ctx);
    expect(vars.accountId).toBe('a');
    expect(vars.pageNumber).toBe(1);
    expect(vars.pageCount).toBe(100);
  });
});

describe('PEPPER isLastPage termination', () => {
  it('returns true on empty page', () => {
    const isLast = isLastPage(0, 1, 100);
    expect(isLast).toBe(true);
  });
  it('returns true on under-page', () => {
    const isLast = isLastPage(50, 1, 200);
    expect(isLast).toBe(true);
  });
  it('returns true when coverage reaches totalCount', () => {
    const isLast = isLastPage(100, 2, 200);
    expect(isLast).toBe(true);
  });
  it('returns false mid-stream', () => {
    const isLast = isLastPage(100, 1, 500);
    expect(isLast).toBe(false);
  });
});
