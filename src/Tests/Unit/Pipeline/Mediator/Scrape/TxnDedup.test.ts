/**
 * Opt-in duplicate collapse — the guard that keeps a mis-declared key from
 * deleting real transactions.
 *
 * The cases below pin the two properties the measured data made non-obvious: a
 * row is removed only when its key **and** its whole content repeat, and a key
 * that repeats over *different* rows keeps every row and reports itself instead.
 * That second case is not hypothetical — Beinleumi repeats `identifier` across
 * 33 distinct rows in captured traffic. No PII: synthetic rows.
 */

import { collapseDuplicates } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/TxnDedup.js';
import type { ITransaction } from '../../../../../Transactions.js';

/** Canonical key most banks would reach for first. */
const BY_ID = ['identifier'] as const;

/**
 * Build a synthetic transaction carrying only the fields the dedup reads.
 * @param identifier - Provider row key.
 * @param amount - Charged amount, used to make rows differ.
 * @returns Transaction shaped enough for the collapse.
 */
function txn(identifier: string, amount: number): ITransaction {
  return { identifier, date: '2026-03-01', chargedAmount: amount } as unknown as ITransaction;
}

/**
 * Collapse duplicates with a fixed label.
 * @param txns - Rows under test, in arrival order.
 * @param keyFields - Canonical field names to key on.
 * @returns Dedup outcome.
 */
function dedupOf(
  txns: readonly ITransaction[],
  keyFields: readonly string[],
): ReturnType<typeof collapseDuplicates> {
  return collapseDuplicates({ txns, keyFields, label: 'test/txns' });
}

describe('Scrape/collapseDuplicates', () => {
  it('leaves rows untouched when the shape declares no key', () => {
    const txns = [txn('a', -1), txn('a', -1)];
    const result = dedupOf(txns, []);
    expect(result).toStrictEqual({ kept: txns, collapsed: 0, collisions: 0 });
  });

  it('removes a row whose key and content both repeat', () => {
    const result = dedupOf([txn('a', -1), txn('b', -2), txn('a', -1)], BY_ID);
    expect(result.kept).toStrictEqual([txn('a', -1), txn('b', -2)]);
  });

  it('counts every row it removed', () => {
    const result = dedupOf([txn('a', -1), txn('a', -1), txn('a', -1)], BY_ID);
    expect(result.collapsed).toBe(2);
  });

  it('keeps distinct rows that merely share a declared key', () => {
    const result = dedupOf([txn('a', -1), txn('a', -2)], BY_ID);
    expect(result.kept).toStrictEqual([txn('a', -1), txn('a', -2)]);
  });

  it('reports a key that covers more than one distinct row', () => {
    const result = dedupOf([txn('a', -1), txn('a', -2)], BY_ID);
    expect(result.collisions).toBe(1);
  });

  it('stays silent about collisions when the key holds', () => {
    const result = dedupOf([txn('a', -1), txn('b', -2)], BY_ID);
    expect(result.collisions).toBe(0);
  });

  it('recognises a repeat that returns after a colliding row', () => {
    const result = dedupOf([txn('a', -1), txn('a', -2), txn('a', -1)], BY_ID);
    expect(result.collapsed).toBe(1);
  });

  it('keeps rows apart on a composite key', () => {
    const fields = ['identifier', 'chargedAmount'];
    const result = dedupOf([txn('a', -1), txn('a', -2)], fields);
    expect(result).toStrictEqual({
      kept: [txn('a', -1), txn('a', -2)],
      collapsed: 0,
      collisions: 0,
    });
  });

  it('treats an absent key field as empty rather than throwing', () => {
    const result = dedupOf([txn('a', -1), txn('b', -2)], ['noSuchField']);
    expect(result.collisions).toBe(1);
  });

  it('reports nothing for an account with no transactions', () => {
    const result = dedupOf([], BY_ID);
    expect(result).toStrictEqual({ kept: [], collapsed: 0, collisions: 0 });
  });
});
