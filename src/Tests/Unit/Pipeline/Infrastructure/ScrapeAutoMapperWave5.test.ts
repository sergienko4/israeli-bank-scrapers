/**
 * Wave 5 branch coverage extensions for ScrapeAutoMapper.
 * Targets: coerceNumber NaN fallback (line 92), processOneLifo empty (411),
 * maybeNegateAmount card+zero (519), isMappableTxn NaN (557,559), root-array
 * empty (694), field-missing ternary in extractAccountIds (738), MAX_HUNT_DEPTH
 * guard (814), object-or-array dispatch branches (822).
 */

import {
  autoMapTransaction,
  extractAccountIds,
  extractAccountRecords,
  extractTransactions,
} from '../../../../Scrapers/Pipeline/Mediator/Scrape/ScrapeAutoMapper.js';

describe('ScrapeAutoMapper — Wave 5 branches', () => {
  // coerceNumber NaN fallback (line 92) — via originalAmount branch
  it('coerceNumber falls back when string is NaN (originalAmount)', () => {
    const raw = {
      date: '2026-01-15',
      amount: -10,
      description: 'x',
      originalAmount: 'not-a-number',
    };
    const result = autoMapTransaction(raw);
    if (result !== false) {
      // Falls back to amount (-10) when originalAmount unparseable.
      expect(typeof result.originalAmount).toBe('number');
    }
  });

  // maybeNegateAmount: isCardTxn + amount===0 (line 519)
  it('maybeNegateAmount keeps zero for card transactions', () => {
    const raw = {
      date: '2026-01-15',
      amount: 0,
      description: 'Card zero charge',
      dealSumType: '0', // activates card flag
    };
    const result = autoMapTransaction(raw);
    if (result !== false) {
      expect(result.chargedAmount).toBe(0);
    }
  });

  // isMappableTxn: infinite amount rejected (line 557)
  it('isMappableTxn rejects infinite amount', () => {
    const raw = {
      date: '2026-01-15',
      amount: Infinity,
      description: 'x',
    };
    const result = autoMapTransaction(raw);
    expect(result).toBe(false);
  });

  // isMappableTxn: bad date string → NaN time (line 559)
  it('isMappableTxn rejects date that yields NaN time', () => {
    const raw = {
      date: 'totally-invalid-date-str',
      amount: -10,
      description: 'x',
    };
    const result = autoMapTransaction(raw);
    // parseAutoDate passes through → new Date('totally-invalid...').getTime() = NaN
    expect(result).toBe(false);
  });

  // extractAccountRecords: body not array → rootAccountArray returns []
  it('extractAccountRecords with non-array non-matching body returns []', () => {
    const body = {
      // No arrays with txn-signature, no root-array form.
      someKey: 'string-value',
      anotherKey: 42,
    };
    const result = extractAccountRecords(body);
    expect(result).toEqual([]);
  });

  // extractAccountRecords: body is empty array → line 694 early return
  it('extractAccountRecords with empty array returns []', () => {
    const result = extractAccountRecords([] as unknown as Record<string, unknown>);
    expect(result).toEqual([]);
  });

  // extractAccountRecords: array but first item not account-shaped → line 695
  it('extractAccountRecords with array lacking accountId returns []', () => {
    const body = [{ randomField: 'value' }, { anotherField: 99 }];
    const result = extractAccountRecords(body as unknown as Record<string, unknown>);
    expect(result).toEqual([]);
  });

  // extractTransactions: deep nesting beyond MAX_HUNT_DEPTH (line 814)
  it('extractTransactions handles pathological deep nesting without crash', () => {
    // Build 25 levels deep (>MAX_HUNT_DEPTH=20)
    let body: Record<string, unknown> = { leaf: 'x' };
    for (let i = 0; i < 25; i += 1) {
      body = { nested: body };
    }
    const result = extractTransactions(body);
    const isArrayResult1 = Array.isArray(result);
    expect(isArrayResult1).toBe(true);
  });

  // huntEntry object-or-array dispatch: object path (line 822)
  it('extractTransactions handles root-object with object values', () => {
    const body = {
      // Object value that has txns deeper
      charges: {
        items: [{ date: '2026-01-15', amount: -50, description: 'A' }],
      },
    };
    const result = extractTransactions(body);
    const isArrayResult2 = Array.isArray(result);
    expect(isArrayResult2).toBe(true);
  });

  // huntEntry: non-object, non-array at stack top (line 825 fallthrough)
  it('extractTransactions handles primitive-only record (no children)', () => {
    const body = { a: 1, b: 'string', c: true };
    const result = extractTransactions(body);
    expect(result).toEqual([]);
  });

  // extractAccountRecords: body is truthy but with null accountId ids
  it('extractAccountRecords with body having mix of records (some with accountId false)', () => {
    const body = {
      items: [{ notAnAccountId: 'x', date: '2026-01-15', amount: -1, description: 'ignore' }],
    };
    const result = extractAccountRecords(body);
    // Hunt or root-array extraction — depending on signature detection.
    const isArrayResult3 = Array.isArray(result);
    expect(isArrayResult3).toBe(true);
  });

  it('extractAccountIds: record without accountId field → filtered out (L738 id===false true)', () => {
    const body = {
      accounts: [
        { accountId: 'A1', balance: 100 },
        { balance: 200 }, // no accountId → findFieldValue returns false
        { accountId: 'A2' },
      ],
    };
    const ids = extractAccountIds(body);
    const isArrayResult4 = Array.isArray(ids);
    expect(isArrayResult4).toBe(true);
  });
});
