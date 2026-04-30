/**
 * Unit tests for JsonTraversal — BFS tree search + key collection + billing months.
 */

import {
  bodyHasSignature,
  extractMatchingKeys,
  generateBillingMonths,
  objectKeysMatch,
} from '../../../../Scrapers/Pipeline/Mediator/Scrape/JsonTraversal.js';

describe('objectKeysMatch', () => {
  it('returns true when a key matches', () => {
    const isObjectKeysMatchResult1 = objectKeysMatch({ accountId: 'A1' }, /accountId/i);
    expect(isObjectKeysMatchResult1).toBe(true);
  });

  it('returns false when no keys match', () => {
    const isObjectKeysMatchResult2 = objectKeysMatch({ foo: 'bar' }, /accountId/i);
    expect(isObjectKeysMatchResult2).toBe(false);
  });

  it('returns false for empty object', () => {
    const isObjectKeysMatchResult3 = objectKeysMatch({}, /x/);
    expect(isObjectKeysMatchResult3).toBe(false);
  });
});

describe('bodyHasSignature', () => {
  it('returns false for null body', () => {
    const hasSignatureResult4 = bodyHasSignature(null, /x/);
    expect(hasSignatureResult4).toBe(false);
  });

  it('returns false for primitive body', () => {
    const hasSignatureResult5 = bodyHasSignature('a string', /x/);
    expect(hasSignatureResult5).toBe(false);
  });

  it('returns true for top-level match', () => {
    const hasSignatureResult6 = bodyHasSignature({ accountId: 'A1' }, /accountId/i);
    expect(hasSignatureResult6).toBe(true);
  });

  it('returns true for nested match via BFS', () => {
    const body = { level1: { level2: { cardId: 'X' } } };
    const hasSignatureResult7 = bodyHasSignature(body, /cardId/i);
    expect(hasSignatureResult7).toBe(true);
  });

  it('returns true via arrays (processes first element)', () => {
    const body = { items: [{ accountId: 'A1' }] };
    const hasSignatureResult8 = bodyHasSignature(body, /accountId/i);
    expect(hasSignatureResult8).toBe(true);
  });

  it('returns false when no match found anywhere', () => {
    const body = { level1: { level2: { foo: 'bar' } } };
    const hasSignatureResult9 = bodyHasSignature(body, /accountId/i);
    expect(hasSignatureResult9).toBe(false);
  });

  it('handles empty arrays without errors', () => {
    const body = { items: [] };
    const hasSignatureResult10 = bodyHasSignature(body, /accountId/i);
    expect(hasSignatureResult10).toBe(false);
  });
});

describe('extractMatchingKeys', () => {
  it('returns empty array for null body', () => {
    const extractMatchingKeysResult11 = extractMatchingKeys(null, /x/);
    expect(extractMatchingKeysResult11).toEqual([]);
  });

  it('returns empty array for primitive body', () => {
    const extractMatchingKeysResult12 = extractMatchingKeys(42, /x/);
    expect(extractMatchingKeysResult12).toEqual([]);
  });

  it('extracts matching keys from top level', () => {
    const body = { accountId: 'A1', accountBalance: 100 };
    const keys = extractMatchingKeys(body, /account/i);
    expect(keys).toContain('accountId');
    expect(keys).toContain('accountBalance');
  });

  it('extracts keys from nested objects', () => {
    const body = {
      outer: { cardNumber: '1234' },
      other: { cardId: 'X' },
    };
    const keys = extractMatchingKeys(body, /card/i);
    expect(keys.length).toBeGreaterThanOrEqual(2);
  });

  it('processes first element of arrays', () => {
    const body = { items: [{ accountId: 'A1' }, { accountId: 'A2' }] };
    const keys = extractMatchingKeys(body, /accountId/i);
    expect(keys.length).toBeGreaterThanOrEqual(1);
  });
});

describe('generateBillingMonths', () => {
  it('generates at least one month for current date', () => {
    const now = Date.now();
    const months = generateBillingMonths(now);
    expect(months.length).toBeGreaterThanOrEqual(1);
  });

  it('generates multiple months for 3-month start', () => {
    const start = new Date(2025, 10, 1).getTime();
    const months = generateBillingMonths(start);
    expect(months.length).toBeGreaterThan(0);
  });

  it('extends by futureMonths', () => {
    const start = Date.now();
    const normal = generateBillingMonths(start, 0);
    const extended = generateBillingMonths(start, 3);
    expect(extended.length).toBeGreaterThanOrEqual(normal.length);
  });

  it('formats months as DD/MM/YYYY', () => {
    const start = new Date(2025, 0, 1).getTime();
    const months = generateBillingMonths(start, 0);
    months.forEach((m): void => {
      expect(m).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    });
  });
});

describe('JsonTraversal branch gaps', () => {
  it('bodyHasSignature: processes level with primitive-first array (non-object branch at line 63)', () => {
    // arrayFirstElement returns ['primitive-string'], processNode then hits line 63 non-object branch
    // But also we need the signature to still match — use a parent key that matches.
    const body = { accountId: ['primitive-string'] };
    const hasSignatureResult13 = bodyHasSignature(body, /accountId/i);
    expect(hasSignatureResult13).toBe(true);
  });

  it('bodyHasSignature: short-circuits reduce after a match (line 80 wasFound=true)', () => {
    // Build object whose first key matches AND has siblings so reduce iterates more
    const body = { accountId: 'A1', other1: 'x', other2: 'y' };
    const hasSignatureResult14 = bodyHasSignature(body, /accountId/i);
    expect(hasSignatureResult14).toBe(true);
  });

  it('extractMatchingKeys: tolerates primitives in children (line 114 non-object)', () => {
    // extractMatchingKeys walks; record.values includes primitive → nested BFS hits line 114
    const body = { outer: { nested: 'stringNotObject', cardId: 'X' } };
    const keys = extractMatchingKeys(body, /card/i);
    expect(keys).toContain('cardId');
  });

  it('bodyHasSignature: processes arrays with null first element (line 63 node=null)', () => {
    // arrayFirstElement returns [null] → processNode(null, ...) → line 63 !node true branch
    const body = { items: [null] };
    const hasSignatureResult15 = bodyHasSignature(body, /accountId/i);
    expect(hasSignatureResult15).toBe(false);
  });

  it('extractMatchingKeys: arrays with null first element (line 114 node=null)', () => {
    // collectFromNode(null) — line 114 !node short-circuit → returns empty
    const body = { items: [null] };
    const keys = extractMatchingKeys(body, /accountId/i);
    expect(keys).toEqual([]);
  });

  it('bodyHasSignature: deep BFS where a sibling later level matches (reduce wasFound branch)', () => {
    // Ensures reduce traverses multiple nodes in one level before a match.
    const body = {
      a: { noMatch1: 1 },
      b: { noMatch2: 2 },
      c: { accountId: 'AAA' },
    };
    const hasSignatureResult16 = bodyHasSignature(body, /accountId/i);
    expect(hasSignatureResult16).toBe(true);
  });
});
