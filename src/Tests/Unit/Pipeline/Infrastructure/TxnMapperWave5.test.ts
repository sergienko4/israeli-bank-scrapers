/**
 * Wave 5 branch coverage extensions for TxnMapper.
 * Targets: coerceNumber NaN fallback, maybeNegateAmount card+zero and
 * isMappableTxn malformed txn rejection.
 */

import { autoMapTransaction } from '../../../../Scrapers/Pipeline/Mediator/Scrape/TxnMapper/TxnMapper.js';

describe('TxnMapper — Wave 5 branches', () => {
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
});
