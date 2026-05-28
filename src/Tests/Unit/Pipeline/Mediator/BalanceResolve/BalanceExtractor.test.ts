/**
 * BALANCE-RESOLVE BalanceExtractor — v4 unit coverage.
 *
 * Covers the four sub-fixes that the v4 phase relies on:
 *   F2 — bounded BFS to depth 4 (VisaCal-shape + Amex-per-card-shape)
 *   F3 — widened WK alias list (totalAmount, billingSumSekel,
 *        totalIlsBillingDate)
 *   F4 — string coercion via Number.parseFloat + Number.isFinite
 *   F5 — ILS-first per-currency selection
 *
 * Test data shapes mirror the capture-validated bodies under
 * C:\tmp\runs\pipeline\<bank>\ (2026-05-26) — see
 * c:\tmp\plans\israeli-bank-scrapers-fork\fix-and-docs\evidence-captures.md.
 */

import {
  coerceToFiniteNumber,
  resolveRecordBalance,
  runBalanceExtractor,
} from '../../../../../Scrapers/Pipeline/Mediator/BalanceResolve/BalanceExtractor.js';
import type { JsonValue } from '../../../../../Scrapers/Pipeline/Types/JsonValue.js';

describe('BalanceExtractor — coerceToFiniteNumber (F4)', () => {
  it('accepts finite positive number', () => {
    const got = coerceToFiniteNumber(1058.61);
    expect(got).toBe(1058.61);
  });

  it('accepts zero', () => {
    const got = coerceToFiniteNumber(0);
    expect(got).toBe(0);
  });

  it('accepts negative numbers', () => {
    const got = coerceToFiniteNumber(-247.5);
    expect(got).toBe(-247.5);
  });

  it('rejects NaN', () => {
    const got = coerceToFiniteNumber(Number.NaN);
    expect(got).toBe(false);
  });

  it('rejects positive Infinity', () => {
    const got = coerceToFiniteNumber(Number.POSITIVE_INFINITY);
    expect(got).toBe(false);
  });

  it('rejects negative Infinity', () => {
    const got = coerceToFiniteNumber(Number.NEGATIVE_INFINITY);
    expect(got).toBe(false);
  });

  it('parses string-shaped Amex billingSumSekel pattern', () => {
    const got = coerceToFiniteNumber('1058.61');
    expect(got).toBe(1058.61);
  });

  it('parses padded string with whitespace', () => {
    const got = coerceToFiniteNumber('  1058.61  ');
    expect(got).toBe(1058.61);
  });

  it('parses negative string number', () => {
    const got = coerceToFiniteNumber('-247.5');
    expect(got).toBe(-247.5);
  });

  it('parses zero string', () => {
    const got = coerceToFiniteNumber('0');
    expect(got).toBe(0);
  });

  it('rejects "N/A" string', () => {
    const got = coerceToFiniteNumber('N/A');
    expect(got).toBe(false);
  });

  it('rejects empty string', () => {
    const got = coerceToFiniteNumber('');
    expect(got).toBe(false);
  });

  it('rejects whitespace-only string', () => {
    const got = coerceToFiniteNumber('   ');
    expect(got).toBe(false);
  });

  it('rejects null', () => {
    const got = coerceToFiniteNumber(null);
    expect(got).toBe(false);
  });

  it('rejects an empty object', () => {
    const got = coerceToFiniteNumber({});
    expect(got).toBe(false);
  });

  it('rejects an empty array', () => {
    const got = coerceToFiniteNumber([]);
    expect(got).toBe(false);
  });

  it('rejects boolean true', () => {
    const got = coerceToFiniteNumber(true);
    expect(got).toBe(false);
  });
});

describe('BalanceExtractor — runBalanceExtractor (F2 + F3 deep BFS)', () => {
  it('depth-1: finds root-level currentBalance (Hapoalim shape)', () => {
    const body: JsonValue = {
      metadata: { messages: [] },
      currentAccountLimitsAmount: 0,
      withdrawalBalance: 150,
      currentBalance: 150,
      creditLimitAmount: 0,
    };
    const got = runBalanceExtractor(body);
    expect(got).toBe(150);
  });

  it('depth-2: descends into nested object (Discount infoAndBalance)', () => {
    const body: JsonValue = {
      AccountInfoAndBalance: {
        AccountName: 'TEST',
        AccountBalance: 16615.16,
        AccountWithheldBalance: 0,
      },
    };
    const got = runBalanceExtractor(body);
    expect(got).toBe(16615.16);
  });

  it('depth-2 array: Max totalCycle ILS row totalAmount', () => {
    const body: JsonValue = {
      result: {
        transactions: [],
        totalCycle: [
          { currency: 376, totalAmount: 13.84, pastDebit: 0, futureDebit: 13.84 },
          { currency: 840, totalAmount: 0, pastDebit: 0, futureDebit: 0 },
        ],
      },
    };
    const got = runBalanceExtractor(body);
    expect(got).toBe(13.84);
  });

  it('depth-3 array-array: VisaCal bigNumbers[].totalDebits[].totalDebit', () => {
    const body: JsonValue = {
      result: {
        bigNumbers: [
          {
            debitDate: '2026-06-15',
            totalDebits: [{ currencyCode: 3, currencySymbol: '₪', totalDebit: 247.5 }],
            prevTotalDebits: [{ currencyCode: 3, currencySymbol: '₪', totalDebit: 0 }],
          },
        ],
        debitCards: [],
      },
    };
    const got = runBalanceExtractor(body);
    expect(got).toBe(247.5);
  });

  it('depth-4: Amex per-card totalForStatement.totalIlsBillingDate', () => {
    const body: JsonValue = {
      data: {
        approvals: null,
        israelAbroadVouchers: {
          vouchers: {
            israelAbroadVouchersList: [],
            totalForStatement: {
              totalIlsBillingDate: 479.4,
              totalUsdBillingDate: 0,
              totalEurBillingDate: 0,
            },
          },
        },
        currentTransactionsList: null,
      },
    };
    const got = runBalanceExtractor(body);
    expect(got).toBe(479.4);
  });

  it('Amex aggregate billingSumSekel as string (F3 + F4)', () => {
    const body: JsonValue = {
      data: {
        errorNumber: '',
        billingSumSekel: '1058.61',
        billingSumDollar: '0.00',
        billingSumEuro: '0.00',
      },
    };
    const got = runBalanceExtractor(body);
    expect(got).toBe(1058.61);
  });

  it('returns false when no balance alias matches', () => {
    const body: JsonValue = {
      meta: { ok: true },
      data: { foo: 'bar', count: 5 },
    };
    const got = runBalanceExtractor(body);
    expect(got).toBe(false);
  });

  it('returns false on null input', () => {
    const got = runBalanceExtractor(null);
    expect(got).toBe(false);
  });

  it('returns false on string input', () => {
    const got = runBalanceExtractor('not an object');
    expect(got).toBe(false);
  });

  it('returns false on number input', () => {
    const got = runBalanceExtractor(42);
    expect(got).toBe(false);
  });
});

describe('BalanceExtractor — resolveRecordBalance defensive branches', () => {
  it('rejects null record', () => {
    const got = resolveRecordBalance(null, ['balance']);
    expect(got).toBe(false);
  });

  it('rejects undefined record', () => {
    const got = resolveRecordBalance(undefined, ['balance']);
    expect(got).toBe(false);
  });

  it('rejects non-record record (numeric primitive coerced)', () => {
    // L230: the `record === null/undefined` guard passes, then
    // `!isRecord(record)` triggers — a primitive sneaking through the
    // typed seam. Cast forces the seam open for the edge.
    const got = resolveRecordBalance(42 as unknown as Record<string, JsonValue>, ['balance']);
    expect(got).toBe(false);
  });

  it('returns false on empty alias list', () => {
    const got = resolveRecordBalance({ balance: 100 }, []);
    expect(got).toBe(false);
  });

  it('returns false past MAX_BFS_DEPTH via array-of-array nesting (L162 branch)', () => {
    // descendNode bounds the recursion via depth > maxDepth (=4). The
    // record path uses findFieldValue which does its own unbounded BFS
    // inside one record, so depth only matters for nested ARRAYS where
    // each descendArray descends one level into each child via
    // descendNode. 6 levels of array wrapping a record exceeds the
    // bound and forces the guard to fire on the deepest descendNode.
    const deep: JsonValue = [[[[[[{ balance: 999 }]]]]]];
    const got = runBalanceExtractor(deep);
    expect(got).toBe(false);
  });
});

describe('BalanceExtractor — F5 ILS-first per-currency selection', () => {
  it('prefers ILS row (currencyCode 376) over USD when ILS has a value', () => {
    const body: JsonValue = {
      result: {
        bigNumbers: [
          {
            totalDebits: [
              { currencyCode: 840, totalDebit: 100 },
              { currencyCode: 376, totalDebit: 250 },
            ],
          },
        ],
      },
    };
    const got = runBalanceExtractor(body);
    expect(got).toBe(250);
  });

  it('prefers ILS row by symbol ₪ when no currencyCode present', () => {
    const body: JsonValue = {
      totalCycle: [
        { currency: 'EUR', totalAmount: 50 },
        { currency: '₪', totalAmount: 175 },
      ],
    };
    const got = runBalanceExtractor(body);
    expect(got).toBe(175);
  });

  it('falls back to first non-zero entry when no ILS row exists', () => {
    const body: JsonValue = {
      totalCycle: [
        { currency: 'USD', totalAmount: 0 },
        { currency: 'EUR', totalAmount: 75 },
      ],
    };
    const got = runBalanceExtractor(body);
    expect(got).toBe(75);
  });

  it('falls back to any (zero) entry when all rows are zero', () => {
    const body: JsonValue = {
      totalCycle: [
        { currency: 'USD', totalAmount: 0 },
        { currency: 'EUR', totalAmount: 0 },
      ],
    };
    const got = runBalanceExtractor(body);
    expect(got).toBe(0);
  });
});
