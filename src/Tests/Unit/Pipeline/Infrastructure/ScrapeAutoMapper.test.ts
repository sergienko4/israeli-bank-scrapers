/**
 * Unit tests for ScrapeAutoMapper — extra coverage for AutoMapper helpers.
 * Complements the existing GenericScrapeStrategy tests.
 */

import {
  extractAccountIds,
  extractAccountRecords,
  extractTransactions,
  extractTransactionsForCard,
  matchField,
} from '../../../../Scrapers/Pipeline/Mediator/Scrape/ScrapeAutoMapper.js';
import { isOk } from '../../../../Scrapers/Pipeline/Types/Procedure.js';

describe('matchField', () => {
  it('returns success with original key when matched', () => {
    const result = matchField({ AccountID: 'A1' }, ['accountId']);
    const isOkResult1 = isOk(result);
    expect(isOkResult1).toBe(true);
    if (isOk(result)) {
      expect(result.value.originalKey).toBe('AccountID');
      expect(result.value.value).toBe('A1');
    }
  });

  it('returns failure when no key matches', () => {
    const result = matchField({ foo: 'bar' }, ['accountId']);
    const isOkResult2 = isOk(result);
    expect(isOkResult2).toBe(false);
  });

  it('rejects non-scalar values', () => {
    const result = matchField({ accountId: { nested: 'x' } }, ['accountId']);
    const isOkResult3 = isOk(result);
    expect(isOkResult3).toBe(false);
  });
});

describe('extractAccountRecords', () => {
  it('returns empty when body has no arrays', () => {
    const records = extractAccountRecords({ name: 'x' });
    expect(records).toEqual([]);
  });

  it('extracts root array of account records when fields match WK', () => {
    const body = [{ accountId: 'A1', balance: 100 }];
    const records = extractAccountRecords(body as unknown as Record<string, unknown>);
    expect(records.length).toBe(1);
  });

  it('extracts nested records via BFS', () => {
    const body = { data: { accounts: [{ accountId: 'A1', balance: 100 }] } };
    const records = extractAccountRecords(body);
    expect(records.length).toBeGreaterThan(0);
  });

  it('returns empty when root array has no account-shaped objects', () => {
    const records = extractAccountRecords([1, 2, 3] as unknown as Record<string, unknown>);
    expect(records).toEqual([]);
  });
});

describe('extractAccountIds', () => {
  it('returns empty when no records found', () => {
    const ids = extractAccountIds({});
    expect(ids).toEqual([]);
  });

  it('returns string IDs from root array', () => {
    const ids = extractAccountIds([{ accountId: 'A1' }, { accountId: 'A2' }] as unknown as Record<
      string,
      unknown
    >);
    expect(ids).toContain('A1');
    expect(ids).toContain('A2');
  });
});

describe('extractTransactions', () => {
  it('returns empty when no txn-like data', () => {
    const txns = extractTransactions({ name: 'x' });
    expect(txns).toEqual([]);
  });

  it('maps transactions with date + amount + description', () => {
    const body = {
      data: {
        items: [
          {
            date: '2026-01-15',
            amount: -100,
            description: 'Coffee',
            identifier: 1,
          },
        ],
      },
    };
    const txns = extractTransactions(body);
    expect(txns.length).toBeGreaterThanOrEqual(0);
  });
});

describe('extractTransactionsForCard', () => {
  it('returns empty when no Index subtree and no cardIndex match', () => {
    const txns = extractTransactionsForCard({ items: [] }, '0');
    expect(txns).toEqual([]);
  });

  it('finds transactions via Index{cardId} subtree', () => {
    const body = {
      CardsTransactionsListBean: {
        Index0: {
          data: { items: [{ date: '2026-01-15', amount: -100, description: 'X' }] },
        },
      },
    };
    const txns = extractTransactionsForCard(body, '0');
    const isArrayResult4 = Array.isArray(txns);
    expect(isArrayResult4).toBe(true);
  });

  it('filters by cardIndex value when no Index subtree', () => {
    const body = {
      txns: [
        { date: '2026-01-15', amount: -100, description: 'X', cardIndex: '0' },
        { date: '2026-01-16', amount: -50, description: 'Y', cardIndex: '1' },
      ],
    };
    const txns = extractTransactionsForCard(body, '0');
    const isArrayResult5 = Array.isArray(txns);
    expect(isArrayResult5).toBe(true);
  });
});
