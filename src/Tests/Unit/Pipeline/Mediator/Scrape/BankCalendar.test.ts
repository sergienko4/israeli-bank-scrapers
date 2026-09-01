/**
 * Bank-calendar determinism — the contract behind issue #545.
 *
 * Every calendar decision in the Scrape cluster must resolve in the *bank's*
 * zone. Before this contract existed they resolved in whatever zone the Node
 * process happened to sit in, so the same provider row produced a different
 * public `ITransaction.date` on different machines.
 *
 * <p>The ambient zone is moved with `moment.tz.setDefault`. That is not a test
 * convenience — it is the actual leak vector. `BaseScraper.initialize()`
 * (`BaseScraper.ts:109`) calls it on the same moment singleton the Pipeline
 * reads, so a Legacy scrape running first used to change what the Pipeline
 * emitted for identical input, in the same process.
 *
 * <p>Without moving the zone these cases would pass vacuously: `jest.config.js`
 * pins `TZ='Asia/Jerusalem'`, which is the one zone in which the old ambient
 * behaviour and the correct behaviour agree.
 */

import moment from 'moment-timezone';

import {
  BANK_CALENDAR_TIMEZONE,
  bankDayOfInstant,
} from '../../../../../Scrapers/Pipeline/Mediator/Scrape/BankCalendar.js';
import { parseAutoDate } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/Coercion/Coercion.js';
import { assessWindowCoverage } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/CoverageAudit/WindowCoverage.js';
import { applyStartWindow } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/StartWindow.js';
import { planBackfill } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/WindowBackfill.js';
import { isSome, none } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type { ITransaction } from '../../../../../Transactions.js';

/**
 * Israel, UTC, and one zone either side of it — the four cases that used to
 * disagree. `Asia/Tokyo` matters on its own: it is east of Israel, so a bound
 * built in the bank calendar and read back ambiently lands on the *next* day
 * there. Only an east-of-Israel zone can catch that direction.
 */
const ZONES = ['Asia/Jerusalem', 'UTC', 'America/Los_Angeles', 'Asia/Tokyo'] as const;

/**
 * Run one probe with the global moment default moved, then put back exactly
 * the default that was in force before — `setDefault()` with no argument
 * resets to the process zone, which is not necessarily what we displaced.
 * `moment().tz()` reports the default a bare moment inherits, and is
 * `undefined` when none is set, which is precisely the reset argument.
 * @param zone - Ambient zone to impersonate.
 * @param run - Probe to evaluate.
 * @returns Whatever the probe returned.
 */
function underZone<T>(zone: string, run: () => T): T {
  const previous = moment().tz();
  moment.tz.setDefault(zone);
  try {
    return run();
  } finally {
    moment.tz.setDefault(previous);
  }
}

/**
 * Evaluate one probe once per ambient zone.
 * @param run - Probe to evaluate.
 * @returns One result per entry in {@link ZONES}.
 */
function acrossZones<T>(run: () => T): T[] {
  return ZONES.map((zone): T => underZone(zone, run));
}

/**
 * A mapped transaction carrying only the field under test.
 * @param raw - Provider date string.
 * @returns Transaction with a Pipeline-parsed date.
 */
function txnOn(raw: string): ITransaction {
  const date = parseAutoDate(raw);
  return { date, processedDate: date } as unknown as ITransaction;
}

describe('parseAutoDate/is host-independent', () => {
  it('emits one instant for a date-only value whatever zone the process is in', () => {
    const emitted = acrossZones((): string => parseAutoDate('29/06/2026'));
    expect(new Set(emitted).size).toBe(1);
  });

  it('keeps the stated calendar day recoverable in the bank zone', () => {
    const days = acrossZones((): string | false => {
      const emitted = parseAutoDate('29/06/2026');
      return bankDayOfInstant(emitted);
    });
    const expected = ZONES.map((): string => '2026-06-29');
    expect(days).toEqual(expected);
  });

  it('is unaffected by the global default a Legacy scraper sets', () => {
    // BaseScraper.initialize() does exactly this on the shared moment singleton.
    const before = parseAutoDate('29/06/2026');
    const after = underZone('UTC', (): string => parseAutoDate('29/06/2026'));
    expect(after).toBe(before);
  });

  it('reads a naive datetime as bank wall-clock rather than shifting it', () => {
    const emitted = acrossZones((): string => parseAutoDate('2026-06-29T14:30:00'));
    const inBankZone = moment(emitted[0]).tz(BANK_CALENDAR_TIMEZONE).format('YYYY-MM-DD HH:mm');
    expect(new Set(emitted).size).toBe(1);
    expect(inBankZone).toBe('2026-06-29 14:30');
  });
});

describe('applyStartWindow/bounds in the bank calendar', () => {
  /**
   * Window one row against a fixed start, in the given ambient zone.
   * @param raw - Provider date string for the single row.
   * @returns Rows dropped by the window.
   */
  function droppedFor(raw: string): number[] {
    const startDate = new Date('2026-02-20');
    const txns = [txnOn(raw)];
    return acrossZones((): number => applyStartWindow({ txns, startDate, label: 'demo' }).dropped);
  }

  it('drops a row dated the day before the caller start, in every zone', () => {
    const dropped = droppedFor('19/02/2026');
    const expected = ZONES.map((): number => 1);
    expect(dropped).toEqual(expected);
  });

  it('keeps a row dated on the caller start day, in every zone', () => {
    const dropped = droppedFor('20/02/2026');
    const expected = ZONES.map((): number => 0);
    expect(dropped).toEqual(expected);
  });
});

describe('assessWindowCoverage/measures in the bank calendar', () => {
  /**
   * Assess a single row against a start expressed the way the phase expresses it.
   * @returns One verdict per ambient zone.
   */
  function verdicts(): string[] {
    const requestedStart = new Date('2026-06-01').toISOString();
    const rows = [{ date: '01/06/2026' }];
    return acrossZones(
      (): string => assessWindowCoverage({ requestedStart, rows, label: 'demo' }).verdict,
    );
  }

  it('calls a fully served window covered in every zone', () => {
    // ApiDirectScrapeBackfill passes startDate.toISOString(), a UTC instant.
    // Reduced in a zone west of UTC it names the previous day and invents a gap.
    const seen = verdicts();
    const expected = ZONES.map((): string => 'covered');
    expect(seen).toEqual(expected);
  });
});

describe('planBackfill/derives the re-ask bound in the bank calendar', () => {
  /**
   * The bound `planBackfill` hands the shapes for one oldest day.
   * @param oldestDay - Oldest collected day.
   * @returns One `nextEnd` per ambient zone.
   */
  function boundsFor(oldestDay: string): Date[] {
    const coverage = { verdict: 'unproven', oldest: oldestDay, gapDays: 30 } as const;
    return acrossZones((): Date => {
      const plan = planBackfill({
        stance: 'windowEnd',
        coverage,
        attempt: 0,
        previousEnd: none(),
        label: 'demo',
      });
      return isSome(plan.nextEnd) ? plan.nextEnd.value : new Date(Number.NaN);
    });
  }

  it.each(['2026-04-01', '2026-04-30', '2026-12-31'])(
    'round-trips %s back to the same day through the wire serializers',
    oldestDay => {
      // The shapes serialise the bound with ambient `moment(d).format(...)`
      // (HapoalimShapeTxns.endOf, FibiGroupShapeTxns.endOf, PepperShapeTxns).
      // Label -> instant -> label must be lossless or the re-ask names the
      // wrong day and the backfill asks for a slice the caller never lost.
      const bounds = boundsFor(oldestDay);
      const onWire = bounds.map((bound, i): string =>
        underZone(ZONES[i], (): string => moment(bound).format('YYYY-MM-DD')),
      );
      const expected = ZONES.map((): string => oldestDay);
      expect(onWire).toEqual(expected);
    },
  );

  it('still covers the whole oldest day rather than stopping at midnight', () => {
    const bounds = boundsFor('2026-04-01');
    const hours = bounds.map((bound, i): number =>
      underZone(ZONES[i], (): number => moment(bound).hours()),
    );
    const expected = ZONES.map((): number => 23);
    expect(hours).toEqual(expected);
  });
});

describe('bankDayOfInstant/refuses to invent a day', () => {
  // `moment(...).format()` answers the *string* 'Invalid date' for an
  // unreadable input. That is not a day, but it is a string, so an
  // unconditional `BankDay` return let it flow into the lexicographic day
  // comparisons this module exists to enable — and 'Invalid date' sorts
  // after every real YYYY-MM-DD label.
  it.each(['', 'not-a-date', '2026-13-45'])('answers false for %p', raw => {
    const day = bankDayOfInstant(raw);
    expect(day).toBe(false);
  });

  it('answers false for an unreadable Date rather than a day-shaped string', () => {
    const day = bankDayOfInstant(new Date('nope'));
    expect(day).toBe(false);
  });

  it('still answers the day for a readable instant', () => {
    const day = bankDayOfInstant('2026-06-29T05:00:00.000Z');
    expect(day).toBe('2026-06-29');
  });

  it('never lets an unreadable start certify coverage or log a NaN gap', () => {
    // gapOf() fed 'Invalid date' produced NaN, so the audit reported
    // `gapDays=NaN` and drove a re-ask with a meaningless bound.
    const rows = [{ date: '01/06/2026' }];
    const seen = assessWindowCoverage({ requestedStart: 'garbage', rows, label: 'demo' });
    const isNaNGap = Number.isNaN(seen.gapDays);
    expect(seen.verdict).toBe('unproven');
    expect(isNaNGap).toBe(false);
  });
});
