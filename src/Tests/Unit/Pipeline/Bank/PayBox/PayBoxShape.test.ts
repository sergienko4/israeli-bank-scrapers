/**
 * Unit tests for PAYBOX_SHAPE — dual-account synthesis + cursor
 * logic + mapping helpers. Covers UC-PBS-1..UC-PBS-6 per test.txt §1.
 */

import type { IPayBoxAcct } from '../../../../../Scrapers/Pipeline/Banks/PayBox/scrape/PayBoxShape.js';
import { PAYBOX_SHAPE } from '../../../../../Scrapers/Pipeline/Banks/PayBox/scrape/PayBoxShape.js';
import type { IActionContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { TransactionStatuses } from '../../../../../Transactions.js';
import { makeMockContext, makeMockOptions } from '../../Infrastructure/MockFactories.js';

const WALLET_ACCT: IPayBoxAcct = { kind: 'wallet', accountNumber: 'wallet-1' };
const DEBIT_ACCT: IPayBoxAcct = { kind: 'debit', accountNumber: 'debit-1' };

/**
 * Build a default IActionContext for unit-level extractPage assertions.
 * @returns Mock context with the project's default options.
 */
function defaultCtx(): IActionContext {
  const opts = makeMockOptions();
  return makeMockContext({ options: opts }) as unknown as IActionContext;
}

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

/** Expected nextCursor outcome for the parameterised pagination tests. */
type ExpectedNextCursor = 'wallet' | 'debit' | 'stop';

/** One row in {@link WALLET_PAGINATION_CASES}. */
interface IWalletPaginationCase {
  readonly name: string;
  readonly body: Record<string, unknown>;
  readonly cursor: { kind: 'wallet'; ts: string; page: number } | false;
  readonly expected: ExpectedNextCursor;
}

const WALLET_PAGINATION_CASES: readonly IWalletPaginationCase[] = [
  {
    name: 'stops on empty page (UC-PBS-2)',
    body: { code: 200, content: { nc: [] } },
    cursor: false,
    expected: 'stop',
  },
  {
    name: 'stops on stall — oldest ts unchanged from prior page (UC-PBS-3)',
    body: { code: 200, content: { nc: [{ ts: '100', amount: 1 }] } },
    cursor: { kind: 'wallet', ts: '100', page: 1 },
    expected: 'stop',
  },
  {
    name: 'stops on cap-24 — page cap reached (UC-PBS-4)',
    body: { code: 200, content: { nc: [{ ts: '50', amount: 1 }] } },
    cursor: { kind: 'wallet', ts: '100', page: 23 },
    expected: 'stop',
  },
  {
    name: 'advances cursor mid-stream when ts strictly decreases',
    body: { code: 200, content: { nc: [{ ts: '50', amount: 1 }] } },
    cursor: { kind: 'wallet', ts: '100', page: 0 },
    expected: 'wallet',
  },
];

/**
 * Verify a page's `nextCursor` matches the table-driven expectation —
 * `'stop'` ⇒ false; `'wallet'`/`'debit'` ⇒ matching cursor kind.
 * @param page Page returned by {@link PAYBOX_SHAPE.transactions.extractPage}.
 * @param page.nextCursor Cursor for the next iteration, or `false`.
 * @param expected Expected outcome (stop / wallet / debit).
 * @returns Always `true` so callers can chain.
 */
function assertNextCursor(
  page: { readonly nextCursor: { readonly kind: string } | false },
  expected: ExpectedNextCursor,
): boolean {
  if (expected === 'stop') {
    expect(page.nextCursor).toBe(false);
    return true;
  }
  expect(page.nextCursor).not.toBe(false);
  if (page.nextCursor !== false) expect(page.nextCursor.kind).toBe(expected);
  return true;
}

describe('PAYBOX_SHAPE wallet transactions pagination (UC-PBS-2..4)', () => {
  WALLET_PAGINATION_CASES.map(({ name, body, cursor, expected }) => {
    it(name, () => {
      const ctx = defaultCtx();
      const page = PAYBOX_SHAPE.transactions.extractPage({
        body,
        cursor,
        acct: WALLET_ACCT,
        ctx,
      });
      assertNextCursor(page, expected);
    });
    return true;
  });

  it('builds vars with ts="0" on first call', () => {
    const ctx = defaultCtx();
    const vars = PAYBOX_SHAPE.transactions.buildVars(WALLET_ACCT, false, ctx);
    expect(vars.ts).toBe('0');
  });

  it('builds vars with cursor.ts on subsequent calls', () => {
    const cursor = { kind: 'wallet' as const, ts: '5050', page: 2 };
    const ctx = defaultCtx();
    const vars = PAYBOX_SHAPE.transactions.buildVars(WALLET_ACCT, cursor, ctx);
    expect(vars.ts).toBe('5050');
  });
});

/**
 * Builder for a context with a fixed `options.startDate`.
 * @param startDate Start-date threshold seeded into ScraperOptions.
 * @returns Action context.
 */
function ctxWithStartDate(startDate: Date): IActionContext {
  const opts = makeMockOptions({ startDate });
  return makeMockContext({ options: opts }) as unknown as IActionContext;
}

/**
 * Convenience constructor for a parameterised debit cursor.
 * @param startDate Start of the chunk window.
 * @param endDate End of the chunk window.
 * @returns Debit cursor.
 */
function debitCursor(
  startDate: Date,
  endDate: Date,
): {
  readonly kind: 'debit';
  readonly startDate: Date;
  readonly endDate: Date;
} {
  return { kind: 'debit', startDate, endDate };
}

/** One row in {@link DEBIT_PAGINATION_CASES}. */
interface IDebitPaginationCase {
  readonly name: string;
  readonly body: Record<string, unknown>;
  readonly cursor:
    | false
    | { readonly kind: 'debit'; readonly startDate: Date; readonly endDate: Date };
  readonly ctx: IActionContext;
  readonly expected: ExpectedNextCursor;
}

const DEBIT_PAGINATION_CASES: readonly IDebitPaginationCase[] = [
  {
    name: 'debit extractPage advances cursor after the first chunk (CR 4 fix)',
    body: { code: 200, content: { filteredTransactions: [] } },
    cursor: false,
    ctx: ctxWithStartDate(new Date('2020-01-01T00:00:00Z')),
    expected: 'debit',
  },
  {
    name: 'debit extractPage with mid-stream cursor advances when end is in past',
    body: { code: 200, content: { filteredTransactions: [] } },
    cursor: debitCursor(new Date('2020-01-01T00:00:00Z'), new Date('2020-06-29T00:00:00Z')),
    ctx: ctxWithStartDate(new Date('2020-01-01T00:00:00Z')),
    expected: 'debit',
  },
  {
    name: 'debit extractPage with cursor whose end is at-or-after now stops',
    body: { code: 200, content: { filteredTransactions: [] } },
    cursor: debitCursor(new Date(), new Date(Date.now() + 86_400_000)),
    ctx: ctxWithStartDate(new Date()),
    expected: 'stop',
  },
];

describe('PAYBOX_SHAPE debit transactions chunking (UC-PBS-5)', () => {
  it('debit chunking covers date range — first call uses ctx.startDate', () => {
    const ctx = ctxWithStartDate(new Date('2025-01-01T00:00:00Z'));
    const vars = PAYBOX_SHAPE.transactions.buildVars(DEBIT_ACCT, false, ctx);
    expect(typeof vars.startDate).toBe('string');
    expect(typeof vars.endDate).toBe('string');
  });

  DEBIT_PAGINATION_CASES.map(({ name, body, cursor, ctx, expected }) => {
    it(name, () => {
      const page = PAYBOX_SHAPE.transactions.extractPage({
        body,
        cursor,
        acct: DEBIT_ACCT,
        ctx,
      });
      assertNextCursor(page, expected);
    });
    return true;
  });

  it('debit buildVars with an explicit cursor reuses cursor dates', () => {
    const cursor = debitCursor(new Date('2025-03-01T00:00:00Z'), new Date('2025-08-28T00:00:00Z'));
    const ctx = defaultCtx();
    const vars = PAYBOX_SHAPE.transactions.buildVars(DEBIT_ACCT, cursor, ctx);
    expect(vars.startDate).toBe('2025-03-01');
    expect(vars.endDate).toBe('2025-08-28');
  });

  it('debit extractPage handles missing body content gracefully', () => {
    // Body-level fallback: `content` itself is absent.
    const page = PAYBOX_SHAPE.transactions.extractPage({
      body: {},
      cursor: false,
      acct: DEBIT_ACCT,
      ctx: defaultCtx(),
    });
    expect(page.items).toHaveLength(0);
  });

  it('debit extractPage handles missing filteredTransactions gracefully (CR R3)', () => {
    // Per CR Round-3 finding: cover the `content` present but
    // `filteredTransactions` missing branch — distinct from `body: {}`.
    const page = PAYBOX_SHAPE.transactions.extractPage({
      body: { content: {} },
      cursor: false,
      acct: DEBIT_ACCT,
      ctx: defaultCtx(),
    });
    expect(page.items).toHaveLength(0);
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
    const page = PAYBOX_SHAPE.transactions.extractPage({
      body,
      cursor,
      acct: DEBIT_ACCT,
      ctx: defaultCtx(),
    });
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

  it('debit row mapping survives malformed date upstream (CR 5 guard)', () => {
    const body = {
      code: 200,
      content: {
        filteredTransactions: [{ id: 99, date: 'not-a-real-date', amount: 1 }],
      },
    };
    const cursor = {
      kind: 'debit' as const,
      startDate: new Date('2025-01-01'),
      endDate: new Date('2025-06-30'),
    };
    const page = PAYBOX_SHAPE.transactions.extractPage({
      body,
      cursor,
      acct: DEBIT_ACCT,
      ctx: defaultCtx(),
    });
    const rows = page.items as { date: string }[];
    const epochIso = new Date(0).toISOString();
    expect(rows[0].date).toBe(epochIso);
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
    const page = PAYBOX_SHAPE.transactions.extractPage({
      body,
      cursor: false,
      acct: WALLET_ACCT,
      ctx: defaultCtx(),
    });
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
    const page = PAYBOX_SHAPE.transactions.extractPage({
      body,
      cursor: false,
      acct: WALLET_ACCT,
      ctx: defaultCtx(),
    });
    const rows = page.items as { identifier: string; description: string }[];
    expect(rows[0].identifier).toBe('');
    expect(rows[0].description).toBe('');
  });

  it('survives malformed wallet ts upstream (CR 7 guard)', () => {
    const body = { code: 200, content: { nc: [{ ts: 'not-numeric', amount: 5, type: 'credit' }] } };
    const page = PAYBOX_SHAPE.transactions.extractPage({
      body,
      cursor: false,
      acct: WALLET_ACCT,
      ctx: defaultCtx(),
    });
    const rows = page.items as { date: string }[];
    const epochIso = new Date(0).toISOString();
    expect(rows[0].date).toBe(epochIso);
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

  it('mapDebitStatus normalises case + whitespace (CR 6 fix)', async () => {
    const helpers =
      await import('../../../../../Scrapers/Pipeline/Banks/PayBox/scrape/PayBoxShapeHelpers.js');
    const pendingStatus = helpers.mapDebitStatus('Pending');
    const completedStatus = helpers.mapDebitStatus('  COMPLETED  ');
    expect(pendingStatus).toBe(TransactionStatuses.Pending);
    expect(completedStatus).toBe(TransactionStatuses.Completed);
  });

  it('mapPbStat falls back to Completed on unknown strings', async () => {
    const helpers =
      await import('../../../../../Scrapers/Pipeline/Banks/PayBox/scrape/PayBoxShapeHelpers.js');
    const garbageStatus = helpers.mapPbStat('garbage-string');
    expect(garbageStatus).toBe(TransactionStatuses.Completed);
  });

  it('mapPbStat normalises case + whitespace (CR 6 fix)', async () => {
    const helpers =
      await import('../../../../../Scrapers/Pipeline/Banks/PayBox/scrape/PayBoxShapeHelpers.js');
    const titleStatus = helpers.mapPbStat('Pending');
    const paddedStatus = helpers.mapPbStat('  PENDING  ');
    expect(titleStatus).toBe(TransactionStatuses.Pending);
    expect(paddedStatus).toBe(TransactionStatuses.Pending);
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
    const ctx = defaultCtx();
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
    const page = PAYBOX_SHAPE.transactions.extractPage({
      body,
      cursor: false,
      acct: WALLET_ACCT,
      ctx: defaultCtx(),
    });
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
    const page = PAYBOX_SHAPE.transactions.extractPage({
      body,
      cursor: debitCursor,
      acct: DEBIT_ACCT,
      ctx: defaultCtx(),
    });
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
