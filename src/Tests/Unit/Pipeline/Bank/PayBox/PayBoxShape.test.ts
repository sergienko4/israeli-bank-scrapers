/**
 * Unit tests for PAYBOX_SHAPE — dual-account synthesis + cursor
 * logic + mapping helpers. Covers UC-PBS-1..UC-PBS-6 per test.txt §1.
 */

import type { IPayBoxAcct } from '../../../../../Scrapers/Pipeline/Banks/PayBox/scrape/PayBoxShape.js';
import { PAYBOX_SHAPE } from '../../../../../Scrapers/Pipeline/Banks/PayBox/scrape/PayBoxShape.js';
import type { IActionContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { TransactionStatuses } from '../../../../../Transactions.js';
import { makeMockContext, makeMockOptions } from '../../Infrastructure/MockFactories.js';

describe('PAYBOX_SHAPE.customer.extractAccounts (UC-PBS-1)', () => {
  it('returns exactly 2 discriminated accts', () => {
    const body = { uId: 'abcd1234ef567890abcd1234' };
    const accts = PAYBOX_SHAPE.customer.extractAccounts(body);
    expect(accts).toHaveLength(2);
  });

  it('wallet account carries kind:wallet + uId as accountNumber', () => {
    const body = { uId: 'fixt-uid-pb-0001' };
    const accts = PAYBOX_SHAPE.customer.extractAccounts(body);
    const wallet = accts[0];
    expect(wallet.kind).toBe('wallet');
    expect(wallet.accountNumber).toBe('fixt-uid-pb-0001');
  });

  it('debit account carries kind:debit + uId+"-d" as accountNumber', () => {
    const body = { uId: 'fixt-uid-pb-0001' };
    const accts = PAYBOX_SHAPE.customer.extractAccounts(body);
    const debit = accts[1];
    expect(debit.kind).toBe('debit');
    expect(debit.accountNumber).toBe('fixt-uid-pb-0001-d');
  });

  it('handles missing uId by emitting empty accountNumber', () => {
    const accts = PAYBOX_SHAPE.customer.extractAccounts({});
    expect(accts).toHaveLength(2);
    expect(accts[0].accountNumber).toBe('');
    expect(accts[1].accountNumber).toBe('-d');
  });
});

describe('PAYBOX_SHAPE wallet transactions pagination (UC-PBS-2..4)', () => {
  const walletAcct: IPayBoxAcct = { kind: 'wallet', accountNumber: 'wallet-1' };

  it('stops on empty page (UC-PBS-2)', () => {
    const body = { code: 200, content: { nc: [] } };
    const page = PAYBOX_SHAPE.transactions.extractPage(body, false);
    expect(page.nextCursor).toBe(false);
  });

  it('stops on stall — oldest ts unchanged from prior page (UC-PBS-3)', () => {
    const body = { code: 200, content: { nc: [{ ts: '100', amount: 1 }] } };
    const cursor = { kind: 'wallet' as const, ts: '100', page: 1 };
    const page = PAYBOX_SHAPE.transactions.extractPage(body, cursor);
    expect(page.nextCursor).toBe(false);
  });

  it('stops on cap-24 — page cap reached (UC-PBS-4)', () => {
    const body = { code: 200, content: { nc: [{ ts: '50', amount: 1 }] } };
    const cursor = { kind: 'wallet' as const, ts: '100', page: 23 };
    const page = PAYBOX_SHAPE.transactions.extractPage(body, cursor);
    expect(page.nextCursor).toBe(false);
  });

  it('advances cursor mid-stream when ts strictly decreases', () => {
    const body = { code: 200, content: { nc: [{ ts: '50', amount: 1 }] } };
    const cursor = { kind: 'wallet' as const, ts: '100', page: 0 };
    const page = PAYBOX_SHAPE.transactions.extractPage(body, cursor);
    expect(page.nextCursor).not.toBe(false);
    if (page.nextCursor !== false) {
      expect(page.nextCursor.kind).toBe('wallet');
    }
  });

  it('builds vars with ts="0" on first call', () => {
    const opts = makeMockOptions();
    const ctx = makeMockContext({ options: opts }) as unknown as IActionContext;
    const vars = PAYBOX_SHAPE.transactions.buildVars(walletAcct, false, ctx);
    expect(vars.ts).toBe('0');
  });

  it('builds vars with cursor.ts on subsequent calls', () => {
    const opts = makeMockOptions();
    const ctx = makeMockContext({ options: opts }) as unknown as IActionContext;
    const cursor = { kind: 'wallet' as const, ts: '5050', page: 2 };
    const vars = PAYBOX_SHAPE.transactions.buildVars(walletAcct, cursor, ctx);
    expect(vars.ts).toBe('5050');
  });
});

describe('PAYBOX_SHAPE debit transactions chunking (UC-PBS-5)', () => {
  const debitAcct: IPayBoxAcct = { kind: 'debit', accountNumber: 'debit-1' };

  it('debit chunking covers date range — first call uses ctx.startDate', () => {
    const startDate = new Date('2025-01-01T00:00:00Z');
    const opts = makeMockOptions({ startDate });
    const ctx = makeMockContext({ options: opts }) as unknown as IActionContext;
    const vars = PAYBOX_SHAPE.transactions.buildVars(debitAcct, false, ctx);
    expect(typeof vars.startDate).toBe('string');
    expect(typeof vars.endDate).toBe('string');
  });

  it('debit extractPage returns nextCursor=false on first call', () => {
    const body = { code: 200, content: { filteredTransactions: [] } };
    const page = PAYBOX_SHAPE.transactions.extractPage(body, false);
    expect(page.nextCursor).toBe(false);
  });

  it('debit buildVars with an explicit cursor reuses cursor dates', () => {
    const opts = makeMockOptions();
    const ctx = makeMockContext({ options: opts }) as unknown as IActionContext;
    const cursor = {
      kind: 'debit' as const,
      startDate: new Date('2025-03-01T00:00:00Z'),
      endDate: new Date('2025-08-28T00:00:00Z'),
    };
    const vars = PAYBOX_SHAPE.transactions.buildVars(debitAcct, cursor, ctx);
    expect(vars.startDate).toBe('2025-03-01');
    expect(vars.endDate).toBe('2025-08-28');
  });

  it('debit extractPage with mid-stream cursor advances when end is in past', () => {
    const body = { code: 200, content: { filteredTransactions: [] } };
    const longAgoStart = new Date('2020-01-01T00:00:00Z');
    const longAgoEnd = new Date('2020-06-29T00:00:00Z');
    const cursor = { kind: 'debit' as const, startDate: longAgoStart, endDate: longAgoEnd };
    const page = PAYBOX_SHAPE.transactions.extractPage(body, cursor);
    expect(page.nextCursor).not.toBe(false);
    if (page.nextCursor !== false) {
      expect(page.nextCursor.kind).toBe('debit');
    }
  });

  it('debit extractPage with cursor whose end is at-or-after now stops', () => {
    const body = { code: 200, content: { filteredTransactions: [] } };
    const future = new Date(Date.now() + 86_400_000);
    const cursor = { kind: 'debit' as const, startDate: new Date(), endDate: future };
    const page = PAYBOX_SHAPE.transactions.extractPage(body, cursor);
    expect(page.nextCursor).toBe(false);
  });

  it('debit extractPage handles missing content gracefully', () => {
    const page = PAYBOX_SHAPE.transactions.extractPage({}, false);
    expect(page.items).toHaveLength(0);
    expect(page.nextCursor).toBe(false);
  });

  it('debit row mapping falls back to "ILS" + empty fields on missing optionals', () => {
    const body = {
      code: 200,
      content: {
        filteredTransactions: [{ id: 42, date: '2025-05-01', amount: -10 }],
      },
    };
    const cursor = {
      kind: 'debit' as const,
      startDate: new Date('2025-01-01'),
      endDate: new Date('2025-06-30'),
    };
    const page = PAYBOX_SHAPE.transactions.extractPage(body, cursor);
    const rows = page.items as {
      identifier: string;
      originalCurrency: string;
      description: string;
      memo: string;
    }[];
    expect(rows[0].identifier).toBe('42');
    expect(rows[0].originalCurrency).toBe('ILS');
    expect(rows[0].description).toBe('');
    expect(rows[0].memo).toBe('');
  });
});

describe('PAYBOX_SHAPE wallet row mapping fallbacks', () => {
  it('falls back to _id, text, ILS, and empty memo when optionals missing', () => {
    const body = {
      code: 200,
      content: {
        nc: [{ ts: '99', amount: 7, type: 'unknown', _id: 'fallback-id', text: 'fallback-text' }],
      },
    };
    const page = PAYBOX_SHAPE.transactions.extractPage(body, false);
    const rows = page.items as {
      identifier: string;
      description: string;
      memo: string;
      originalCurrency: string;
      chargedAmount: number;
    }[];
    expect(rows[0].identifier).toBe('fallback-id');
    expect(rows[0].description).toBe('fallback-text');
    expect(rows[0].memo).toBe('');
    expect(rows[0].originalCurrency).toBe('ILS');
    expect(rows[0].chargedAmount).toBe(-7);
  });

  it('falls back to empty identifier and description when both candidates absent', () => {
    const body = { code: 200, content: { nc: [{ ts: '88', amount: 5, type: 'credit' }] } };
    const page = PAYBOX_SHAPE.transactions.extractPage(body, false);
    const rows = page.items as { identifier: string; description: string }[];
    expect(rows[0].identifier).toBe('');
    expect(rows[0].description).toBe('');
  });
});

describe('PAYBOX_SHAPE_HELPERS status maps coverage', () => {
  it('mapDebitStatus covers known + unknown + absent strings', async () => {
    const helpers =
      await import('../../../../../Scrapers/Pipeline/Banks/PayBox/scrape/PayBoxShapeHelpers.js');
    const completedStatus = helpers.mapDebitStatus('completed');
    const pendingStatus = helpers.mapDebitStatus('pending');
    const garbageStatus = helpers.mapDebitStatus('garbage-string');
    const absentStatus = helpers.mapDebitStatus();
    expect(completedStatus).toBe(TransactionStatuses.Completed);
    expect(pendingStatus).toBe(TransactionStatuses.Pending);
    expect(garbageStatus).toBe(TransactionStatuses.Completed);
    expect(absentStatus).toBe(TransactionStatuses.Completed);
  });

  it('mapPbStat falls back to Completed on unknown strings', async () => {
    const helpers =
      await import('../../../../../Scrapers/Pipeline/Banks/PayBox/scrape/PayBoxShapeHelpers.js');
    const garbageStatus = helpers.mapPbStat('garbage-string');
    expect(garbageStatus).toBe(TransactionStatuses.Completed);
  });
});

describe('PAYBOX_SHAPE accessors', () => {
  it('accountNumberOf returns accountNumber field', () => {
    const acct: IPayBoxAcct = { kind: 'wallet', accountNumber: 'foo' };
    const accountNum = PAYBOX_SHAPE.accountNumberOf(acct);
    expect(accountNum).toBe('foo');
  });

  it('balance.extract defaults to 0', () => {
    const bal = PAYBOX_SHAPE.balance.extract({});
    expect(bal).toBe(0);
  });

  it('customer.buildVars + balance.buildVars return empty maps', () => {
    const opts = makeMockOptions();
    const ctx = makeMockContext({ options: opts }) as unknown as IActionContext;
    const customerVars = PAYBOX_SHAPE.customer.buildVars(ctx);
    const acct: IPayBoxAcct = { kind: 'wallet', accountNumber: 'a' };
    const balanceVars = PAYBOX_SHAPE.balance.buildVars(acct);
    const customerKeys = Object.keys(customerVars);
    const balanceKeys = Object.keys(balanceVars);
    expect(customerKeys).toHaveLength(0);
    expect(balanceKeys).toHaveLength(0);
  });
});

describe('PAYBOX_SHAPE wallet row mapping (UC-PBS-6)', () => {
  it('maps PbNotification status variants to canonical TransactionStatuses', () => {
    const body = {
      code: 200,
      content: {
        nc: [
          { ts: '100', amount: 50, type: 'credit', stat: 'completed', merchantName: 'Shop A' },
          { ts: '90', amount: 30, type: 'debit', stat: 'pending', merchantName: 'Shop B' },
          { ts: '80', amount: 20, type: 'debit', stat: 'rejected', merchantName: 'Shop C' },
        ],
      },
    };
    const page = PAYBOX_SHAPE.transactions.extractPage(body, false);
    const rows = page.items as { status: TransactionStatuses; chargedAmount: number }[];
    expect(rows).toHaveLength(3);
    expect(rows[0].status).toBe(TransactionStatuses.Completed);
    expect(rows[0].chargedAmount).toBe(50);
    expect(rows[1].status).toBe(TransactionStatuses.Pending);
    expect(rows[1].chargedAmount).toBe(-30);
    expect(rows[2].status).toBe(TransactionStatuses.Completed);
  });

  it('maps debit filteredTransactions to canonical shape', () => {
    const body = {
      code: 200,
      content: {
        filteredTransactions: [
          {
            id: 1,
            date: '2025-01-15',
            amount: -75,
            merchantName: 'Card Merchant',
            status: 'completed',
            currency: 'ILS',
          },
        ],
      },
    };
    const debitCursor = {
      kind: 'debit' as const,
      startDate: new Date('2025-01-01'),
      endDate: new Date('2025-06-30'),
    };
    const page = PAYBOX_SHAPE.transactions.extractPage(body, debitCursor);
    const rows = page.items as {
      identifier: string;
      chargedAmount: number;
      originalCurrency: string;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].identifier).toBe('1');
    expect(rows[0].chargedAmount).toBe(-75);
    expect(rows[0].originalCurrency).toBe('ILS');
  });
});
