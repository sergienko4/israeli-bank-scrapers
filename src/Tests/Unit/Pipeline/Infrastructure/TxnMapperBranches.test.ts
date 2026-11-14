/**
 * Branch coverage extensions for TxnMapper.
 * Targets coerceString/Number, maybeNegateAmount, resolveAmount split and
 * isMappableTxn malformed txn rejection.
 */

import { parseAutoDate } from '../../../../Scrapers/Pipeline/Mediator/Scrape/Coercion/Coercion.js';
import { autoMapTransaction } from '../../../../Scrapers/Pipeline/Mediator/Scrape/TxnMapper/TxnMapper.js';
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

describe('TxnMapper — branch completion', () => {
  it('parseAutoDate returns original string when no format matches', () => {
    const raw = 'not-a-date';
    const result = parseAutoDate(raw);
    expect(result).toBe(raw);
  });

  it('parseAutoDate parses a known YYYY-MM-DD format', () => {
    const result = parseAutoDate('2026-01-15');
    // Moment converts to UTC ISO, so day may shift depending on TZ
    expect(result).toMatch(/2026-01-1\d/);
  });

  it('autoMapTransaction rejects record with empty date', () => {
    const raw = { amount: -10, description: 'x' };
    const result = autoMapTransaction(raw);
    expect(result).toBe(false);
  });

  it('coerces a non-numeric amount to zero', () => {
    const raw = { date: '2026-01-15', amount: 'garbage', description: 'x' };
    const txn = mapOne(raw);
    expect(txn.chargedAmount).toBe(0);
  });

  it('coerces a numeric YYYYMMDD date', () => {
    const raw = { date: 20260115, amount: -10, description: 'x' };
    const txn = mapOne(raw);
    expect(txn.originalAmount).toBe(-10);
    expect(txn.date).toContain('2026-01');
  });

  it('negates amount when card-company signature (dealSumType present + positive amount)', () => {
    const raw = {
      date: '2026-01-15',
      amount: 250,
      description: 'Card Charge',
      dealSumType: '0',
    };
    const txn = mapOne(raw);
    expect(txn.chargedAmount).toBe(-250);
  });

  it('resolves split debit/credit amount when amount is false', () => {
    const raw = {
      date: '2026-01-15',
      description: 'x',
      debitAmount: 100,
      creditAmount: 40,
    };
    const txn = mapOne(raw);
    // credit - debit = -60
    expect(txn.chargedAmount).toBe(-60);
  });

  it('normalizeCurrency converts shekel alias to ILS', () => {
    const raw = {
      date: '2026-01-15',
      amount: -50,
      description: 'x',
      currency: '₪',
    };
    const txn = mapOne(raw);
    expect(txn.originalCurrency).toBe('ILS');
  });
});
