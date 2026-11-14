/**
 * Unit tests for the generic scrape helpers — WellKnown field lookup,
 * transaction mapping and provider date parsing.
 */

import { findFieldValue } from '../../../../Scrapers/Pipeline/Mediator/Scrape/BfsFieldSearch/BfsFieldSearch.js';
import { parseAutoDate } from '../../../../Scrapers/Pipeline/Mediator/Scrape/Coercion/Coercion.js';
import { autoMapTransaction } from '../../../../Scrapers/Pipeline/Mediator/Scrape/TxnMapper/TxnMapper.js';

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
    expect(txn).not.toBe(false);
    const good = txn as Exclude<typeof txn, false>;
    expect(good.identifier).toBe(1001);
    expect(good.originalAmount).toBe(-250);
    expect(good.description).toBe('Supermarket');
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
    expect(txn).not.toBe(false);
    const good = txn as Exclude<typeof txn, false>;
    expect(good.description).toBe('Test Shop');
    expect(good.originalAmount).toBe(100);
  });

  it('rejects record with missing required fields (GUARD)', () => {
    const raw = { someField: 'value' };
    const txn = autoMapTransaction(raw);
    expect(txn).toBe(false);
  });

  it('accepts numeric YYYYMMDD date (Hapoalim shape)', () => {
    const raw = { eventDate: 20260414, eventAmount: 150, activityDescription: 'Salary' };
    const txn = autoMapTransaction(raw);
    expect(txn).not.toBe(false);
    const good = txn as Exclude<typeof txn, false>;
    expect(good.description).toBe('Salary');
    expect(good.chargedAmount).toBe(150);
    const parsed = new Date(good.date);
    const year = parsed.getUTCFullYear();
    expect(year).toBe(2026);
  });
});

describe('findFieldValue — deep BFS', () => {
  it('finds field nested 2 levels deep', () => {
    const obj = { NewAccountInfo: { AccountID: 'A123' } };
    const result = findFieldValue(obj, ['AccountID']);
    expect(result).toBe('A123');
  });

  it('finds field nested 3 levels deep', () => {
    const obj = { level1: { level2: { OperationAmount: -500 } } };
    const result = findFieldValue(obj, ['OperationAmount']);
    expect(result).toBe(-500);
  });

  it('prefers shallower match over deeper one', () => {
    const obj = { amount: 100, deep: { amount: 200 } };
    const result = findFieldValue(obj, ['amount']);
    expect(result).toBe(100);
  });
});

describe('parseAutoDate', () => {
  it('parses YYYYMMDD format', () => {
    const result = parseAutoDate('20260115');
    expect(result).toContain('2026');
  });

  it('parses YYYY-MM-DD format', () => {
    const result = parseAutoDate('2026-01-15');
    expect(result).toContain('2026');
  });

  it('parses DD/MM/YYYY format', () => {
    const result = parseAutoDate('15/01/2026');
    expect(result).toContain('2026');
  });

  it('returns original string for unknown format', () => {
    const result = parseAutoDate('not-a-date');
    expect(result).toBe('not-a-date');
  });
});
