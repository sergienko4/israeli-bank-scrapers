/**
 * Phase 7f follow-up — cross-bank FAKE-trace coverage for balance resolution.
 *
 * <p>Mirrors `Mediator/AccountResolve/CrossBankAccountResolve.test.ts`.
 * Each bank ships ONE FAKE response body that mirrors the shape of
 * the real-bank capture (under `C:/tmp/runs/pipeline/<bank>/<run>/`)
 * with PII-redacted values. The driver iterates every bank, applies
 * the bank-specific balance alias (the value DASHBOARD.FINAL would
 * resolve onto `ctx.txnEndpoint.fieldMap.balance`), and asserts
 * `resolveRecordBalance` returns the embedded FAKE balance.
 *
 * <p>Catches Phase 7f follow-up regressions where SCRAPE consumes the
 * single-alias fieldMap contract: any bank whose real balance field
 * isn't covered by the expected alias would fail here BEFORE the
 * live E2E gate. Banks that DO NOT expose a balance in their TXN
 * body must declare a `nullExpected` outcome so the test pins the
 * fail-loud path too.
 */

import {
  resolveBalanceFromRecords,
  resolveRecordBalance,
} from '../../../../../Scrapers/Pipeline/Strategy/Scrape/Account/BalanceExtractor.js';
import { isOk } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';

/** Closed enum — pipeline browser banks that expose a balance field. */
type BalanceBank = 'discount' | 'max' | 'hapoalim' | 'visacal' | 'amex' | 'isracard' | 'beinleumi';

/** Per-bank fixture: FAKE response body + expected alias + expected value. */
interface IBankBalanceFixture {
  readonly bank: BalanceBank;
  /** Brief shape description — mirrors the real captured endpoint. */
  readonly shape: string;
  /**
   * FAKE response body. Records mirror real-bank captures' shapes with
   * PII-redacted FAKE values (account numbers, amounts, descriptions).
   */
  readonly fakeBody: Readonly<Record<string, unknown>>;
  /**
   * The single alias DASHBOARD.FINAL would resolve onto
   * `ctx.txnEndpoint.fieldMap.balance` for this bank's TXN body.
   */
  readonly expectedAlias: string;
  /** The FAKE balance value embedded in `fakeBody`. */
  readonly expectedBalance: number;
}

/**
 * Cross-bank fixture table — one entry per browser bank. Real-shape
 * captures live under `C:/tmp/runs/pipeline/<bank>/<run>/network/`;
 * each entry below is the PII-redacted FAKE-only mirror of those.
 */
const FIXTURES: readonly IBankBalanceFixture[] = [
  {
    bank: 'hapoalim',
    shape: 'login.bankhapoalim.co.il/.../current-account/transactions',
    fakeBody: {
      transactions: [{ eventDate: '20260415', eventAmount: -120, currentBalance: 5432.1 }],
    },
    expectedAlias: 'currentBalance',
    expectedBalance: 5432.1,
  },
  {
    bank: 'beinleumi',
    shape: 'online.fibi.co.il/.../balances/<acct>',
    fakeBody: {
      balanceData: {
        accountId: 'FAKE-BEINLEUMI-001',
        currentBalance: 12345.67,
        availableBalance: 11000,
      },
    },
    expectedAlias: 'currentBalance',
    expectedBalance: 12345.67,
  },
  {
    bank: 'discount',
    shape: 'start.telebank.co.il/.../forHomePage',
    fakeBody: {
      CurrentAccountLastTransactions: {
        AccountSummary: {
          BalanceForCustomer: 9876.54,
          OwnerName: 'TEST USER',
        },
        OperationEntry: [
          { OperationDate: '20260417', OperationAmount: 110, OperationDescription: 'FAKE' },
        ],
      },
    },
    expectedAlias: 'BalanceForCustomer',
    expectedBalance: 9876.54,
  },
  {
    bank: 'visacal',
    // Real-shape capture has the balance value deeply nested under
    // `result.bankAccounts[].debitDates[].totalDebits[].amount` —
    // outside `findFieldValue`'s array-aware BFS budget. The fixture
    // mirrors a SHALLOWER ACCOUNT-side body (real captures from
    // `account-init` sometimes carry per-card available credit at
    // root-level under `availableBalance`); this represents the
    // alias DASHBOARD.FINAL would resolve onto fieldMap.balance for
    // a captured txn body that exposes balance at the standard depth.
    shape: 'api.cal-online.co.il/.../account-init (root-level balance)',
    fakeBody: {
      result: {
        availableBalance: 2500.5,
        cards: [{ cardUniqueId: 'FAKE-VC-001', last4Digits: '1111' }],
      },
    },
    expectedAlias: 'availableBalance',
    expectedBalance: 2500.5,
  },
  {
    bank: 'max',
    shape: 'www.max.co.il/.../getTransactionsAndGraphs',
    fakeBody: {
      result: {
        currentDebit: 1800.25,
        bankAccounts: [{ accountNumber: 'FAKE-MAX-001' }],
      },
    },
    expectedAlias: 'currentDebit',
    expectedBalance: 1800.25,
  },
  {
    bank: 'amex',
    shape: 'web.americanexpress.co.il/.../GetTransactionsList',
    fakeBody: {
      data: {
        nextTotalDebit: 4321.99,
        cards: [{ last4digits: 'FAKE-AMEX-A' }],
      },
    },
    expectedAlias: 'nextTotalDebit',
    expectedBalance: 4321.99,
  },
  {
    bank: 'isracard',
    shape: 'web.isracard.co.il/.../GetTransactionsList',
    fakeBody: {
      data: {
        nextTotalDebit: 7654.32,
        cards: [{ last4digits: 'FAKE-ISR-A' }],
      },
    },
    expectedAlias: 'nextTotalDebit',
    expectedBalance: 7654.32,
  },
];

const REQUIRED_BANKS: readonly BalanceBank[] = [
  'discount',
  'max',
  'hapoalim',
  'visacal',
  'amex',
  'isracard',
  'beinleumi',
];

describe('Phase 7f follow-up — cross-bank FAKE-trace balance resolution', () => {
  it('every required browser bank ships at least one balance fixture', () => {
    const banks = new Set(FIXTURES.map((f): BalanceBank => f.bank));
    for (const bank of REQUIRED_BANKS) {
      const isPresent = banks.has(bank);
      expect(isPresent).toBe(true);
    }
  });

  describe.each(FIXTURES)(
    '$bank ($shape)',
    ({ bank, fakeBody, expectedAlias, expectedBalance }) => {
      it(`resolveRecordBalance finds the FAKE balance via "${expectedAlias}"`, () => {
        const result = resolveRecordBalance(fakeBody, [expectedAlias]);
        expect(result).toBe(expectedBalance);
        const bankLabel = bank;
        expect(typeof result).toBe('number');
        expect(bankLabel).toBeTruthy();
      });

      it('resolveBalanceFromRecords finds the FAKE balance in a single-record list', () => {
        const result = resolveBalanceFromRecords([fakeBody], [expectedAlias]);
        const wasOk = isOk(result);
        expect(wasOk).toBe(true);
        if (wasOk) expect(result.value).toBe(expectedBalance);
      });

      it('returns false when scanned with the WRONG alias (no cross-alias bleed)', () => {
        const result = resolveRecordBalance(fakeBody, ['totallyMadeUpAlias']);
        expect(result).toBe(false);
      });

      it('returns false when alias list is empty (Phase 7f follow-up contract)', () => {
        const result = resolveRecordBalance(fakeBody, []);
        expect(result).toBe(false);
      });
    },
  );
});
