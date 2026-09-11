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
  bankMomentOfInstant,
} from '../../../../../Scrapers/Pipeline/Mediator/Scrape/BankCalendar.js';
import { parseAutoDate } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/Coercion/Coercion.js';
import { applyStartWindow } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/StartWindow.js';
import type { ITransaction } from '../../../../../Transactions.js';
import { AMBIENT_ZONE_CASES as ZONES, underZone } from '../../../../Helpers/AmbientZone.js';

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

/**
 * Render a zone-less calendar day through the bank calendar.
 * @returns The day and time it resolves to in the bank's zone.
 */
function renderBare(): string {
  return bankMomentOfInstant('2026-02-09').format('YYYY-MM-DD HH:mm');
}

/**
 * Render the same instant expressed with an explicit offset.
 * @returns The day and time it resolves to in the bank's zone.
 */
function renderInstant(): string {
  return bankMomentOfInstant('2026-02-08T22:00:00.000Z').format('YYYY-MM-DD HH:mm');
}

/**
 * US DST starts at this instant and Israel's has not yet — the two zones'
 * transitions do not coincide, so this is one of the two days a year on which
 * an ambiently-computed lookback disagreed across hosts.
 */
const DST_INSTANT = '2026-03-08T21:00:00.000Z';

/**
 * The lookback fallback as `computeStartDate` composes it: anchor "now" in the
 * bank calendar first, then subtract. Subtracting a year is calendar
 * arithmetic, so it resolves against whatever zone the moment carries.
 * @returns The bank day the fallback bound lands on.
 */
function renderLookback(): string {
  const anchored = bankMomentOfInstant(DST_INSTANT);
  return anchored.subtract(1, 'years').format('YYYY-MM-DD');
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

  /**
   * ISO-8601 allows a value to carry no offset, and a zone-less value has to be
   * resolved against *some* zone. Resolving it against the host's made the same
   * argument name different calendar days on different machines: read from
   * UTC+14 a bare `2026-02-09` landed on `2026-02-08`, which inflated a window
   * gap by a day and turned a covered window into a spurious backfill ask.
   */
  it('reads a zone-less calendar day in the bank zone, not the host zone', () => {
    const seen = ZONES.map((z): string => underZone(z, (): string => renderBare()));
    const expected = ZONES.map((): string => '2026-02-09 00:00');
    expect(seen).toEqual(expected);
  });

  /**
   * The guard above must not be bought by re-interpreting values that were
   * already unambiguous — everything `toISOString()` emits carries `Z`, and the
   * offset has to keep winning.
   */
  it('leaves an offset-bearing instant untouched on every host', () => {
    const seen = ZONES.map((z): string => underZone(z, (): string => renderInstant()));
    const expected = ZONES.map((): string => '2026-02-09 00:00');
    expect(seen).toEqual(expected);
  });

  it('reports the same calendar day for a zone-less start on every host', () => {
    const seen = ZONES.map((z): unknown =>
      underZone(z, (): unknown => bankDayOfInstant('2026-02-09')),
    );
    const expected = ZONES.map((): unknown => '2026-02-09');
    expect(seen).toEqual(expected);
  });
  /**
   * `computeStartDate` falls back to a one-year lookback when the caller's
   * start is older than the cap. Computed ambiently, a host on US Pacific
   * named a different bank day than UTC at this instant — the request went to
   * the bank asking for the wrong day, on nothing but the host's location.
   */
  it('lands the lookback fallback on one bank day for every host', () => {
    const seen = ZONES.map((z): string => underZone(z, renderLookback));
    const expected = ZONES.map((): string => seen[0]);
    expect(seen).toEqual(expected);
  });
});
