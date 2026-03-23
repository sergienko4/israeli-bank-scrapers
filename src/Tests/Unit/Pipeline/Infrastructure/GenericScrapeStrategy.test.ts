/**
 * Unit tests for GenericScrapeStrategy — WellKnown field auto-mapping.
 * Tests findFieldValue, findFirstArray, autoMapTransaction.
 */

import {
  autoMapTransaction,
  findFieldValue,
  findFirstArray,
} from '../../../../Scrapers/Pipeline/Mediator/GenericScrapeStrategy.js';

describe('findFieldValue', () => {
  it('finds a direct field match', () => {
    const obj = { OperationDate: '20260115', other: 'x' };
    const result = findFieldValue(obj, ['OperationDate', 'date']);
    expect(result).toBe('20260115');
  });

  it('tries fields in order, returns first match', () => {
    const obj = { date: '2026-01-15', OperationDate: '20260115' };
    const result = findFieldValue(obj, ['OperationDate', 'date']);
    expect(result).toBe('20260115');
  });

  it('returns false when no field matches', () => {
    const obj = { foo: 'bar' };
    const result = findFieldValue(obj, ['OperationDate', 'date']);
    expect(result).toBe(false);
  });

  it('skips null/undefined values', () => {
    const obj = { OperationDate: null, date: '2026-01-15' };
    const result = findFieldValue(obj, ['OperationDate', 'date']);
    expect(result).toBe('2026-01-15');
  });
});

describe('findFirstArray', () => {
  it('finds top-level array', () => {
    const obj = { items: [1, 2, 3], name: 'test' };
    const result = findFirstArray(obj);
    expect(result).toEqual([1, 2, 3]);
  });

  it('finds nested array (1 level deep)', () => {
    const obj = { data: { accounts: [{ id: '1' }] } };
    const result = findFirstArray(obj);
    expect(result).toEqual([{ id: '1' }]);
  });

  it('finds deeply nested array (2 levels)', () => {
    const obj = { UserAccountsData: { UserAccounts: [{ AccountID: 'A1' }] } };
    const result = findFirstArray(obj);
    expect(result).toEqual([{ AccountID: 'A1' }]);
  });

  it('returns empty array when no array found', () => {
    const obj = { name: 'test', value: 42 };
    const result = findFirstArray(obj);
    expect(result).toEqual([]);
  });
});

describe('autoMapTransaction', () => {
  it('maps Discount-style transaction', () => {
    const raw = {
      OperationNumber: 1001,
      OperationDate: '20260115',
      ValueDate: '20260201',
      OperationAmount: -250,
      OperationDescriptionToDisplay: 'Supermarket',
    };
    const txn = autoMapTransaction(raw);
    expect(txn.identifier).toBe(1001);
    expect(txn.originalAmount).toBe(-250);
    expect(txn.description).toBe('Supermarket');
  });

  it('maps VisaCal-style transaction', () => {
    const raw = {
      trnIntId: 'T1',
      trnPurchaseDate: '2026-03-01',
      debCrdDate: '2026-04-01',
      trnAmt: 100,
      merchantName: 'Test Shop',
      trnCurrencySymbol: 'ILS',
    };
    const txn = autoMapTransaction(raw);
    expect(txn.description).toBe('Test Shop');
    expect(txn.originalAmount).toBe(100);
  });

  it('handles missing fields gracefully', () => {
    const raw = { someField: 'value' };
    const txn = autoMapTransaction(raw);
    expect(txn.description).toBe('');
    expect(txn.originalAmount).toBe(0);
  });
});
