/**
 * BankMonth keeps a bank-calendar month distinct from a JavaScript instant.
 */

import { bankDayOfInstant } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/BankCalendar.js';
import {
  bankDatePartsOfInstant,
  bankDatePartsOfLabel,
  bankInstantOfLabel,
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

  it('reads a month-only bank label', () => {
    const month = bankMonthOfLabel('2026-03');
    expect(month).toEqual({ year: 2026, month: 3 });
  });

  it.each(['2024-02-29', '2000-02-29'])('accepts Gregorian leap day %s', label => {
    const parts = bankDatePartsOfLabel(label);
    expect(parts).not.toBe(false);
  });

  it.each(['2026-02-29', '1900-02-29'])('rejects non-leap February day %s', label => {
    const parts = bankDatePartsOfLabel(label);
    expect(parts).toBe(false);
  });

  it.each(['not-a-date', '2026-00-01', '2026-13-01', '2026-02-31', '2026-03-garbage'])(
    'rejects malformed or out-of-range label %s',
    label => {
      const month = bankMonthOfLabel(label);
      expect(month).toBe(false);
    },
  );

  it.each(['not-a-date', '2026-13-01', '2026-03'])(
    'rejects incomplete or invalid date-parts label %s',
    label => {
      const parts = bankDatePartsOfLabel(label);
      expect(parts).toBe(false);
    },
  );

  it('reads a Backbase MM/YYYY billing label', () => {
    const month = bankMonthOfSlashedLabel('03/2026');
    expect(month).toEqual({ year: 2026, month: 3 });
  });

  it.each(['not-a-month', '13/2026'])('rejects invalid Backbase month label %s', label => {
    const month = bankMonthOfSlashedLabel(label);
    expect(month).toBe(false);
  });

  it('projects an instant into the bank month', () => {
    const instant = new Date('2026-02-28T22:30:00.000Z');
    const month = bankMonthOfInstant(instant);
    expect(month).toEqual({ year: 2026, month: 3 });
  });

  it('rejects invalid instants when projecting date parts', () => {
    const parts = bankDatePartsOfInstant(new Date(Number.NaN));
    expect(parts).toBe(false);
  });

  it('rejects invalid instants when projecting a month', () => {
    const month = bankMonthOfInstant(new Date(Number.NaN));
    expect(month).toBe(false);
  });

  it('rejects an invalid generated timestamp label', () => {
    const instant = bankInstantOfLabel('2026-02-31T00:00:00.000Z');
    expect(instant).toBe(false);
  });

  it('rejects a generated label without the required timestamp', () => {
    const instant = bankInstantOfLabel('2026-03-01');
    expect(instant).toBe(false);
  });

  it('shifts across a year boundary without a host Date', () => {
    const shifted = shiftBankMonth({ year: 2026, month: 12 }, 1);
    expect(shifted).toEqual({ year: 2027, month: 1 });
  });

  it('shifts backwards across a year boundary', () => {
    const shifted = shiftBankMonth({ year: 2026, month: 1 }, -1);
    expect(shifted).toEqual({ year: 2025, month: 12 });
  });

  it('shifts an instant by bank months while preserving its bank-calendar day', () => {
    const source = new Date('2026-01-31T22:30:00.000Z');
    const shifted = shiftBankInstant(source, 1);
    const shiftedDay = shifted === false ? false : bankDayOfInstant(shifted);
    expect(shiftedDay).toBe('2026-03-01');
  });

  it('rejects an invalid instant before shifting it', () => {
    const shifted = shiftBankInstant(new Date(Number.NaN), 1);
    expect(shifted).toBe(false);
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
