/**
 * Unit tests for GenericScrapeStrategy — WellKnown field auto-mapping.
 * Tests findFieldValue, findFirstArray, autoMapTransaction.
 */

import {
  autoMapTransaction,
  buildMonthBody,
  extractAccountIds,
  findFieldValue,
  findFirstArray,
  isMonthlyEndpoint,
  parseAutoDate,
} from '../../../../Scrapers/Pipeline/Mediator/Network/GenericScrapeStrategy.js';

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

describe('extractAccountIds — nested structures', () => {
  it('extracts from Discount-style nested response', () => {
    const response = {
      UserAccountsData: {
        UserAccounts: [
          { NewAccountInfo: { AccountID: '0152228812' } },
          { NewAccountInfo: { AccountID: '0987654321' } },
        ],
      },
    };
    const ids = extractAccountIds(response);
    expect(ids).toContain('0152228812');
    expect(ids).toContain('0987654321');
  });

  it('extracts from VisaCal-style flat response', () => {
    const response = {
      result: {
        cards: [
          { cardUniqueId: 'c1', last4Digits: '1234' },
          { cardUniqueId: 'c2', last4Digits: '5678' },
        ],
      },
    };
    const ids = extractAccountIds(response);
    expect(ids.length).toBe(2);
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

describe('isMonthlyEndpoint', () => {
  it('returns true for VisaCal-style body with month + year', () => {
    const body = JSON.stringify({ cardUniqueId: 'c1', month: '3', year: '2026' });
    const isMonthly = isMonthlyEndpoint(body);
    expect(isMonthly).toBe(true);
  });

  it('returns false for Discount-style (no month/year in body)', () => {
    const isMonthly = isMonthlyEndpoint('');
    expect(isMonthly).toBe(false);
  });

  it('returns false for invalid JSON', () => {
    const isMonthly = isMonthlyEndpoint('not-json');
    expect(isMonthly).toBe(false);
  });

  it('returns false when only month present (no year)', () => {
    const body = JSON.stringify({ month: '3' });
    const isMonthly = isMonthlyEndpoint(body);
    expect(isMonthly).toBe(false);
  });
});

describe('buildMonthBody', () => {
  it('replaces cardUniqueId + month + year in template', () => {
    const template = JSON.stringify({ cardUniqueId: 'old', month: '1', year: '2025' });
    const body = buildMonthBody({ template, accountId: 'new-card', month: 3, year: 2026 });
    expect(body.cardUniqueId).toBe('new-card');
    expect(body.month).toBe('3');
    expect(body.year).toBe('2026');
  });

  it('preserves other fields in template', () => {
    const template = JSON.stringify({
      cardUniqueId: 'c1',
      month: '1',
      year: '2025',
      extra: 'keep',
    });
    const body = buildMonthBody({ template, accountId: 'c2', month: 6, year: 2026 });
    expect(body.extra).toBe('keep');
  });
});
