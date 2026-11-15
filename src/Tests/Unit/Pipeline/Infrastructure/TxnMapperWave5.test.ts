/**
 * Wave 5 branch coverage extensions for TxnMapper.
 * Targets: coerceNumber NaN fallback, maybeNegateAmount card+zero and
 * isMappableTxn malformed txn rejection.
 */

import autoMapTransaction from '../../../../Scrapers/Pipeline/Mediator/Scrape/TxnMapper/TxnMapper.js';
import type { ITransaction } from '../../../../Transactions.js';

/**
 * Map one raw record and assert the mapper accepted it.
 * @param raw - Raw transaction record.
 * @returns The mapped transaction.
 */
function mapOne(raw: Record<string, unknown>): ITransaction {
  const mapped = autoMapTransaction(raw);
  expect(mapped).not.toBe(false);
  return mapped as ITransaction;
}

describe('TxnMapper — Wave 5 branches', () => {
  // coerceNumber NaN fallback (line 92) — via originalAmount branch
  it('coerceNumber falls back when string is NaN (originalAmount)', () => {
    const raw = {
      date: '2026-01-15',
      amount: -10,
      description: 'x',
      originalAmount: 'not-a-number',
    };
    const txn = mapOne(raw);
    // Falls back to amount (-10) when originalAmount unparseable.
    expect(txn.originalAmount).toBe(-10);
  });

  // maybeNegateAmount: isCardTxn + amount===0 (line 519)
  it('maybeNegateAmount keeps zero for card transactions', () => {
    const raw = {
      date: '2026-01-15',
      amount: 0,
      description: 'Card zero charge',
      dealSumType: '0', // activates card flag
    };
    const txn = mapOne(raw);
    expect(txn.chargedAmount).toBe(0);
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
});
