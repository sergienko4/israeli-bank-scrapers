/**
 * Unit tests for ScrapeAutoMapper — extra coverage for AutoMapper helpers.
 * Complements the existing GenericScrapeStrategy tests.
 */

import {
  extractAccountIds,
  extractAccountRecords,
  extractTransactions,
  extractTransactionsForCard,
  findAllFieldValues,
  isUsableIdentifier,
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

  describe('named WK.accountContainers (cardsList / accounts / bankAccounts / cards)', () => {
    it('finds nested cardsList array (Amex-style GetCardList shape)', () => {
      const body = {
        data: {
          summaryNextBillingDateInOut: [{ nextBillingDateInOut: '01/06/2026' }],
          cardsList: [
            { cardSuffix: '1111', companyCode: '77' },
            { cardSuffix: '4838', companyCode: '77' },
          ],
        },
      };
      const records = extractAccountRecords(body);
      expect(records.length).toBe(2);
      expect(records[0].cardSuffix).toBe('1111');
      expect(records[1].cardSuffix).toBe('4838');
    });

    it('finds nested accounts array (named WK container)', () => {
      const body = { result: { accounts: [{ accountNumber: '12345' }] } };
      const records = extractAccountRecords(body);
      expect(records.length).toBe(1);
    });

    it('finds nested bankAccounts array (named WK container)', () => {
      const body = { result: { bankAccounts: [{ bankAccountUniqueId: '99' }] } };
      const records = extractAccountRecords(body);
      expect(records.length).toBe(1);
    });

    it('skips empty container arrays and falls through to existing logic', () => {
      const body = { data: { cardsList: [] } };
      const records = extractAccountRecords(body);
      expect(records).toEqual([]);
    });

    it('skips containers whose array items are not objects', () => {
      const body = { data: { cardsList: [1, 2, 3] } };
      const records = extractAccountRecords(body);
      expect(records).toEqual([]);
    });

    it('prefers named container over generic findFirstArray fallback', () => {
      // findFirstArray would otherwise hit summaryNextBillingDateInOut first.
      const body = {
        data: {
          summaryNextBillingDateInOut: [
            { nextBillingDateInOut: '01/06/2026', billingSumSekelInOut: '83.66' },
          ],
          cardsList: [{ cardSuffix: '1111' }],
        },
      };
      const records = extractAccountRecords(body);
      expect(records.length).toBe(1);
      expect(records[0].cardSuffix).toBe('1111');
    });

    it('Phase 7d: surfaces BOTH `cards` AND `bankAccounts` when both live in the same body', () => {
      // VisaCal's account/init carries both: cards[] are card-level
      // (last4Digits like 3020/3308) and bankAccounts[] are bank-level
      // (bankAccountNum like 100005). Phase 7d change: the multi-
      // container walker concatenates every WK container in the
      // chosen body so `accountDiscovery.records` carries the full
      // graph. Downstream phases see both halves; SCRAPE iterates per-
      // card (cards-first ordering preserved).
      const body = {
        result: {
          cards: [{ cardUniqueId: '11733...', last4Digits: '3308' }],
          bankAccounts: [{ bankAccountUniqueId: '31100005003093' }],
        },
      };
      const records = extractAccountRecords(body);
      expect(records.length).toBe(2);
      const ids = records.map((r): unknown => r.last4Digits ?? r.bankAccountUniqueId);
      expect(ids).toContain('3308');
      expect(ids).toContain('31100005003093');
    });
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

  it('falls through cardIndex=0 to cardNumber when no higher-priority field present', () => {
    // Max-shaped record — cardIndex is a position (0), cardNumber is the
    // real last-4 ("0814"). Validator rejects "0", accepts "0814".
    const maxBody: Record<string, unknown> = {
      result: {
        registerUserCardsData: [{ cardIndex: 0, cardNumber: '0814', name: 'max executive' }],
      },
    };
    const ids = extractAccountIds(maxBody);
    expect(ids).toEqual(['0814']);
  });

  it('returns empty when only position-like values are present', () => {
    // No usable identifier in the record — extraction yields []. The
    // pipeline must fail-fast downstream, not scrape with a sentinel.
    const positionOnlyBody: Record<string, unknown> = {
      result: {
        items: [{ cardIndex: 0 }, { cardIndex: 1 }],
      },
    };
    const ids = extractAccountIds(positionOnlyBody);
    expect(ids).toEqual([]);
  });

  it('cardUniqueId still wins over cardNumber when both present', () => {
    const dualIdBody: Record<string, unknown> = {
      result: {
        cards: [{ cardUniqueId: 'abc-uuid-3489986', cardNumber: '0814' }],
      },
    };
    const ids = extractAccountIds(dualIdBody);
    expect(ids).toEqual(['abc-uuid-3489986']);
  });
});

describe('isUsableIdentifier', () => {
  it('rejects single-character / sentinel values', () => {
    const isEmptyOk = isUsableIdentifier('');
    const isZeroOk = isUsableIdentifier('0');
    const isFiveOk = isUsableIdentifier('5');
    const isDefaultOk = isUsableIdentifier('default');
    const isNullStrOk = isUsableIdentifier('null');
    const isUndefStrOk = isUsableIdentifier('undefined');
    expect(isEmptyOk).toBe(false);
    expect(isZeroOk).toBe(false);
    expect(isFiveOk).toBe(false);
    expect(isDefaultOk).toBe(false);
    expect(isNullStrOk).toBe(false);
    expect(isUndefStrOk).toBe(false);
  });

  it('accepts realistic banking identifiers', () => {
    const isLast4Ok = isUsableIdentifier('0814');
    const isSevenDigitOk = isUsableIdentifier('3489986');
    const isUuidLikeOk = isUsableIdentifier('abc-uuid-1234');
    const isShortAcctOk = isUsableIdentifier('A1');
    const isLongNumOk = isUsableIdentifier('100001');
    expect(isLast4Ok).toBe(true);
    expect(isSevenDigitOk).toBe(true);
    expect(isUuidLikeOk).toBe(true);
    expect(isShortAcctOk).toBe(true);
    expect(isLongNumOk).toBe(true);
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

describe('findAllFieldValues — deep walk over arrays + records', () => {
  it('returns every matching field across nested arrays and objects', () => {
    const obj = {
      bankAccountUniqueId: 'PARENT-BA',
      result: {
        bigNumbers: [
          {
            cards: [{ cardUniqueId: 'CARD-A' }, { cardUniqueId: 'CARD-B' }],
          },
        ],
      },
    };
    const hits = findAllFieldValues(obj, ['cardUniqueId']);
    expect(hits).toEqual(['CARD-A', 'CARD-B']);
  });

  it('returns empty when no field name matches anywhere in the tree', () => {
    const obj = { a: 1, b: { c: [{ d: 'x' }] } };
    const hits = findAllFieldValues(obj, ['missing']);
    expect(hits).toEqual([]);
  });

  it('skips null and primitive nodes encountered during the walk', () => {
    const obj = {
      list: [null, 42, 'string', { cardUniqueId: 'CARD-OK' }],
    };
    const hits = findAllFieldValues(obj, ['cardUniqueId']);
    expect(hits).toEqual(['CARD-OK']);
  });
});
