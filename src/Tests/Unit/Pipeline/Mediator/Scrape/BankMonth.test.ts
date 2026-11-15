/**
 * BankMonth keeps a bank-calendar month distinct from a JavaScript instant.
 */

import { bankDayOfInstant } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/BankCalendar.js';
import {
  bankMonthBounds,
  bankMonthOfInstant,
  shiftBankInstant,
  shiftBankMonth,
} from '../../../../../Scrapers/Pipeline/Mediator/Scrape/BankMonth.js';

describe('BankMonth', () => {
  it('projects an instant into its bank month and day', () => {
    const instant = '2026-02-28T22:30:00.000Z';
    const month = bankMonthOfInstant(instant);
    const day = bankDayOfInstant(instant);
    expect(month).toEqual({ year: 2026, month: 3 });
    expect(day).toBe('2026-03-01');
  });

  it('projects an instant into the bank month', () => {
    const instant = new Date('2026-02-28T22:30:00.000Z');
    const month = bankMonthOfInstant(instant);
    expect(month).toEqual({ year: 2026, month: 3 });
  });

  it('rejects invalid instants when projecting a month', () => {
    const month = bankMonthOfInstant(new Date(Number.NaN));
    expect(month).toBe(false);
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
