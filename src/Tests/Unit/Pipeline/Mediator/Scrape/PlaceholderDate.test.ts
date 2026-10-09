/**
 * Placeholder dates — the invariant that a "not set" date never passes for a
 * real one.
 *
 * .NET providers send `DateTime.MinValue` (`0001-01-01T00:00:00`) for an
 * empty date, e.g. Mizrahi's value date `MC02ErehTaaEZ` on a movement that
 * has none. Every consumer of `parseAutoDate` must treat such a year as
 * missing: the mapper falls back from the processed date to the transaction
 * date, rejects a row dated only by a placeholder, and window coverage never
 * lets a placeholder certify the window's old end. Bodies are synthetic.
 */

import { parseAutoDate } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/Coercion/Coercion.js';
import { assessWindowCoverage } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/CoverageAudit/WindowCoverage.js';
import { autoMapTransaction } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/ScrapeAutoMapper.js';

/** Placeholder forms a provider may send for an empty date. */
const PLACEHOLDERS = ['0001-01-01T00:00:00', '0001-01-01', '1899-12-31T00:00:00'] as const;

/** A real transaction day. */
const REAL_DAY = '2026-10-08';

describe('placeholder dates', () => {
  it.each(PLACEHOLDERS)('parseAutoDate reads %s as missing', placeholder => {
    const parsed = parseAutoDate(placeholder);
    expect(parsed).toBe('');
  });

  it('parseAutoDate keeps the earliest plausible year', () => {
    const parsed = parseAutoDate('1900-01-01');
    expect(parsed).not.toBe('');
  });

  it.each(PLACEHOLDERS)('a %s processed date falls back to the transaction date', placeholder => {
    const raw = { date: REAL_DAY, processedDate: placeholder, amount: -10, description: 'x' };
    const txn = autoMapTransaction(raw);
    if (txn === false) throw new TypeError('row was rejected by the mapper');
    expect(txn.processedDate).toBe(txn.date);
  });

  it.each(PLACEHOLDERS)('a row dated only %s is rejected', placeholder => {
    const raw = { date: placeholder, amount: -10, description: 'x' };
    const txn = autoMapTransaction(raw);
    expect(txn).toBe(false);
  });

  it.each(PLACEHOLDERS)('a %s row never certifies window coverage', placeholder => {
    const rows = [{ transactionDate: placeholder, amount: 1 }];
    const result = assessWindowCoverage({ requestedStart: REAL_DAY, rows, label: 'test/txns' });
    expect(result.verdict).toBe('unproven');
    expect(result.oldest).toBe('');
  });
});
