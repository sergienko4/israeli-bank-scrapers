/**
 * BankMonth keeps a bank-calendar month distinct from a JavaScript instant.
 */

import { bankDayOfInstant } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/BankCalendar.js';
import {
  bankDatePartsOfInstant,
  bankDatePartsOfLabel,
  bankMonthBounds,
  bankMonthOfInstant,
  bankMonthOfLabel,
  bankMonthOfSlashedLabel,
  shiftBankInstant,
  shiftBankMonth,
} from '../../../../../Scrapers/Pipeline/Mediator/Scrape/BankMonth.js';

describe('BankMonth', () => {
  it('reads complete date parts from a strict bank label', () => {
    const parts = bankDatePartsOfLabel('2026-03-15T10:30:00.000Z');
    expect(parts).toEqual({ year: 2026, month: 3, day: 15 });
  });

  it('projects an instant into complete bank date parts', () => {
    const parts = bankDatePartsOfInstant('2026-02-28T22:30:00.000Z');
    expect(parts).toEqual({ year: 2026, month: 3, day: 1 });
  });

  it('reads the month named by a chunk label', () => {
    const month = bankMonthOfLabel('2026-03-01T00:00:00.000Z');
    expect(month).toEqual({ year: 2026, month: 3 });
  });

  it.each(['not-a-date', '2026-00-01', '2026-13-01', '2026-02-31', '2026-03-garbage'])(
    'rejects malformed or out-of-range label %s',
    label => {
      const month = bankMonthOfLabel(label);
      expect(month).toBe(false);
    },
  );

  it('reads a Backbase MM/YYYY billing label', () => {
    const month = bankMonthOfSlashedLabel('03/2026');
    expect(month).toEqual({ year: 2026, month: 3 });
  });

  it('projects an instant into the bank month', () => {
    const instant = new Date('2026-02-28T22:30:00.000Z');
    const month = bankMonthOfInstant(instant);
    expect(month).toEqual({ year: 2026, month: 3 });
  });

  it('shifts across a year boundary without a host Date', () => {
    const shifted = shiftBankMonth({ year: 2026, month: 12 }, 1);
    expect(shifted).toEqual({ year: 2027, month: 1 });
  });

  it('shifts an instant by bank months while preserving its bank-calendar day', () => {
    const source = new Date('2026-01-31T22:30:00.000Z');
    const shifted = shiftBankInstant(source, 1);
    const shiftedDay = shifted === false ? false : bankDayOfInstant(shifted);
    expect(shiftedDay).toBe('2026-03-01');
  });

  it('builds bounds whose instants name the requested bank month', () => {
    const bounds = bankMonthBounds({ year: 2026, month: 3 });
    const startDay = bankDayOfInstant(bounds.start);
    const endDay = bankDayOfInstant(bounds.end);
    expect(startDay).toBe('2026-03-01');
    expect(endDay).toBe('2026-03-31');
  });

  it('preserves an accepted four-digit year when building bounds', () => {
    const bounds = bankMonthBounds({ year: 42, month: 3 });
    const startDay = bankDayOfInstant(bounds.start);
    const endDay = bankDayOfInstant(bounds.end);
    expect(startDay).toBe('0042-03-01');
    expect(endDay).toBe('0042-03-31');
  });
});
