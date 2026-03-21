/**
 * Unit tests for VisaCalMappers — pure transaction mapping functions.
 * Covers: mapCompleted (type codes, amounts, installments), mapPending, mapPendingResults.
 */

import { ScraperErrorTypes } from '../../../../../../Scrapers/Base/ErrorTypes.js';
import {
  type IRawPendingTxn,
  type IRawTxn,
  mapCompleted,
  mapPending,
  mapPendingResults,
} from '../../../../../../Scrapers/Pipeline/Banks/VisaCal/VisaCalMappers.js';
import { fail, succeed } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { TransactionStatuses, TransactionTypes } from '../../../../../../Transactions.js';

/** Default raw completed transaction — override fields per test case. */
const BASE_TXN: IRawTxn = {
  trnIntId: 'TXN-001',
  trnPurchaseDate: '2026-01-15',
  debCrdDate: '2026-02-01',
  trnAmt: 100,
  amtBeforeConvAndIndex: 100,
  trnCurrencySymbol: 'ILS',
  debCrdCurrencySymbol: 'ILS',
  merchantName: 'Test Store',
  transTypeCommentDetails: 'Test memo',
  branchCodeDesc: 'Shopping',
  trnTypeCode: 5,
  numOfPayments: 0,
  curPaymentNum: 0,
};

/**
 * Create a raw transaction with overrides.
 * @param overrides - Fields to override from BASE_TXN.
 * @returns Merged IRawTxn.
 */
function makeRawTxn(overrides: Partial<IRawTxn>): IRawTxn {
  return { ...BASE_TXN, ...overrides };
}

/** Default raw pending transaction. */
const BASE_PENDING: IRawPendingTxn = {
  trnPurchaseDate: '2026-01-15',
  trnAmt: 50,
  trnCurrencySymbol: 'ILS',
  merchantName: 'Pending Store',
  transTypeCommentDetails: 'Pending memo',
  branchCodeDesc: 'Food',
  trnTypeCode: 5,
  numberOfPayments: 0,
};

describe('mapCompleted', () => {
  it.each([
    {
      label: 'regular (5) → Normal, sign -1',
      typeCode: 5,
      expectedType: TransactionTypes.Normal,
      expectedSign: -1,
    },
    {
      label: 'credit (6) → Installments, sign +1',
      typeCode: 6,
      expectedType: TransactionTypes.Installments,
      expectedSign: 1,
    },
    {
      label: 'standing (9) → Normal, sign -1',
      typeCode: 9,
      expectedType: TransactionTypes.Normal,
      expectedSign: -1,
    },
    {
      label: 'unknown (99) → Installments, sign -1',
      typeCode: 99,
      expectedType: TransactionTypes.Installments,
      expectedSign: -1,
    },
  ] as const)(
    /**
     * Verify type code mapping and amount sign.
     * @param label - Test case description.
     * @param typeCode - Transaction type code.
     * @param expectedType - Expected TransactionType.
     * @param expectedSign - Expected sign multiplier for originalAmount.
     */
    '$label',
    ({ typeCode, expectedType, expectedSign }) => {
      const txn = makeRawTxn({ trnTypeCode: typeCode, trnAmt: 200 });
      const result = mapCompleted(txn);
      expect(result.type).toBe(expectedType);
      expect(result.originalAmount).toBe(200 * expectedSign);
      expect(result.chargedAmount).toBe(txn.amtBeforeConvAndIndex * -1);
      expect(result.status).toBe(TransactionStatuses.Completed);
    },
  );

  it('includes installments when numOfPayments is truthy', () => {
    const txn = makeRawTxn({ numOfPayments: 3, curPaymentNum: 1 });
    const result = mapCompleted(txn);
    expect(result.installments).toEqual({ number: 1, total: 3 });
  });

  it('excludes installments when numOfPayments is 0', () => {
    const txn = makeRawTxn({ numOfPayments: 0, curPaymentNum: 0 });
    const result = mapCompleted(txn);
    expect(result.installments).toBeUndefined();
  });

  it('maps all metadata fields correctly', () => {
    const txn = makeRawTxn({});
    const result = mapCompleted(txn);
    expect(result.identifier).toBe('TXN-001');
    expect(result.description).toBe('Test Store');
    expect(result.memo).toBe('Test memo');
    expect(result.category).toBe('Shopping');
    expect(result.originalCurrency).toBe('ILS');
    expect(result.chargedCurrency).toBe('ILS');
  });
});

describe('mapPending', () => {
  it('maps pending transaction with negative amounts', () => {
    const result = mapPending(BASE_PENDING);
    expect(result.type).toBe(TransactionTypes.Normal);
    expect(result.status).toBe(TransactionStatuses.Pending);
    expect(result.originalAmount).toBe(-50);
    expect(result.chargedAmount).toBe(-50);
    expect(result.description).toBe('Pending Store');
    expect(result.memo).toBe('Pending memo');
    expect(result.category).toBe('Food');
    expect(result.originalCurrency).toBe('ILS');
  });

  it('uses same date for date and processedDate', () => {
    const result = mapPending(BASE_PENDING);
    expect(result.date).toBe(result.processedDate);
  });
});

describe('mapPendingResults', () => {
  it('propagates failure as Procedure failure', () => {
    const failure = fail(ScraperErrorTypes.Generic, 'test error');
    const result = mapPendingResults(failure);
    expect(result.success).toBe(false);
  });

  it('maps all pending transactions on success', () => {
    const txns = [BASE_PENDING, { ...BASE_PENDING, trnAmt: 75 }];
    const input = succeed(txns);
    const result = mapPendingResults(input);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.value).toHaveLength(2);
    expect(result.value[0].originalAmount).toBe(-50);
    expect(result.value[1].originalAmount).toBe(-75);
  });
});
