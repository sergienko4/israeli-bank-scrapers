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
import { assessWindowCoverage } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/CoverageAudit/WindowCoverage.js';
import { applyStartWindow } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/StartWindow.js';
import { planBackfill } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/WindowBackfill.js';
import { isSome, none } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type { ITransaction } from '../../../../../Transactions.js';
import { underZone } from '../../../../Helpers/AmbientZone.js';

/**
 * Israel, UTC, and one zone either side of it — the four cases that used to
 * disagree. `Asia/Tokyo` matters on its own: it is east of Israel, so a bound
 * built in the bank calendar and read back ambiently lands on the *next* day
 * there. Only an east-of-Israel zone can catch that direction.
 */
const ZONES = ['Asia/Jerusalem', 'UTC', 'America/Los_Angeles', 'Asia/Tokyo'] as const;

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
      // The shapes serialise the bound with `bankMomentOfInstant(d).format(...)`
      // (HapoalimShapeTxns.endOf, FibiGroupShapeTxns.endOf, PepperShapeTxns,
      // and YahavShapeTxns.chunkEnd via bankDayOfInstant). Label -> instant ->
      // label must be lossless or the re-ask names the wrong day and the
      // backfill asks for a slice the caller never lost.
      const bounds = boundsFor(oldestDay);
      const onWire = bounds.map((bound, i): string =>
        underZone(ZONES[i], (): string => bankMomentOfInstant(bound).format('YYYY-MM-DD')),
      );
      const expected = ZONES.map((): string => oldestDay);
      expect(onWire).toEqual(expected);
    },
  );

  it('names the same instant on every host, not the same wall clock', () => {
    // Leumi is the reason this matters. It puts the bound on the wire as an
    // absolute instant (`toUTCString()`), so an ambient end-of-day means a
    // different real moment per host: from Los Angeles it lands after the
    // rows already held, the provider re-serves the same set, `oldest` does
    // not move, and the very next round refuses with `boundDidNotMove`. The
    // backfill dies on the first retry and the caller is told the window is
    // unproven — on a west-of-Israel host only.
    const bounds = boundsFor('2026-04-01');
    const instants = bounds.map((bound): string => bound.toISOString());
    const endOfDayInIsrael = '2026-04-01T20:59:59.999Z';
    const expected = ZONES.map((): string => endOfDayInIsrael);
    expect(instants).toEqual(expected);
  });

  it('still covers the whole oldest day rather than stopping at midnight', () => {
    // Read in the bank's zone, because that is the calendar the day belongs
    // to. Ambiently the same instant is 23:00 or 01:00 depending on the host.
    const bounds = boundsFor('2026-04-01');
    const hours = bounds.map((bound, i): number =>
      underZone(ZONES[i], (): number => bankMomentOfInstant(bound).hours()),
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
